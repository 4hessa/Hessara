"""Run genuine sample analysis only inside the existing hardened Docker boundary.

This command cannot enable a platform flag or approve infrastructure benchmarks.
REA has a bundled harmless source fixture. Other tools require an operator-owned
fixture and an expected symbol/class/package marker; none is silently fabricated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

from common import MAX_RESULT, MAX_UPLOAD, WorkerError, bounded_process
from supervisor import hardening, docker_command, cleanup_container
from verification import safe_sample, assert_sample


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('engines.json'))
    parser.add_argument('--engine', choices=['rea', 'ghidra', 'mobsf', 'jadx', 'rizin', 'angr', 'radare2'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    parser.add_argument('--format', choices=['elf', 'pe', 'macho', 'apk', 'dex', 'jar', 'aab'])
    parser.add_argument('--expect-name')
    parser.add_argument('--authorization-confirmed', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'linux' or shutil.which('docker') is None:
        raise WorkerError('unsupported_host', 'Real verification requires an isolated Linux Docker host.')
    if args.output.exists():
        raise WorkerError('report_exists', 'Choose a new verification report path; existing reports are never overwritten.')
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))[args.engine]
    if args.engine == 'rea':
        fixture, artifact_format, expected_name = safe_sample(), 'zip', 'index.js'
    else:
        if not args.authorization_confirmed or not args.fixture or not args.format or not args.expect_name:
            raise WorkerError('fixture_required', 'An authorized fixture, its format and expected evidence marker are required.')
        if not args.fixture.is_file() or not 0 < args.fixture.stat().st_size <= min(MAX_UPLOAD, 50 * 1024 * 1024):
            raise WorkerError('invalid_fixture', 'Fixture is missing or exceeds policy.')
        if not 1 <= len(args.expect_name) <= 200 or any(ord(char) < 32 for char in args.expect_name):
            raise WorkerError('invalid_fixture', 'Invalid expected evidence marker.')
        if args.format not in config['formats']:
            raise WorkerError('unsupported_format', 'The configured engine does not support this fixture format.')
        fixture, artifact_format, expected_name = args.fixture.read_bytes(), args.format, args.expect_name
    name = 'hessara-re-verify-' + os.urandom(8).hex()
    started = time.monotonic()
    create_attempted = False
    try:
        with tempfile.TemporaryDirectory(prefix='hessara-re-verification-') as directory:
            root = Path(directory)
            root.chmod(0o711)
            artifact = root / 'artifact'
            artifact.write_bytes(fixture)
            artifact.chmod(0o444)
            command = hardening(config, name=name, worker_id='operator-verification', artifact=artifact)
            create_attempted = True
            docker_command(command + [config['image'], '--engine', args.engine, '--format', artifact_format, '--options', '{}',
                                      '--timeout', str(min(config['timeoutSeconds'], 180))])
            output, _, status = bounded_process(['docker', 'start', '--attach', name],
                                                min(config['timeoutSeconds'], 180) + 5, limit=MAX_RESULT)
            if status:
                raise WorkerError('verification_failed', 'The actual analysis container did not complete successfully.')
            result = json.loads(output)
            assert_sample(args.engine, result, expected_name)
    finally:
        if create_attempted:
            # No passed report can be produced unless cleanup succeeds.
            cleanup_container(name)
    report = dict(schemaVersion=1, kind='real-analysis-sample', engineId=args.engine,
                  assertionProfile=args.engine + '-static-v1',
                  verification=dict(passed=True, imageDigest=config['image'], engineVersion=result['engineVersion'],
                                    artifactSha256=hashlib.sha256(fixture).hexdigest(), verifiedAt=int(time.time() * 1000)),
                  resultSha256=hashlib.sha256(output).hexdigest(), durationMs=round((time.monotonic() - started) * 1000),
                  notice='Real safe sample only; does not certify load capacity, other formats, or production readiness.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        os.chmod(args.output, 0o600)
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'engine': args.engine, 'passed': True, 'report': str(args.output)}))


if __name__ == '__main__':
    try:
        main()
    except (WorkerError, ValueError, KeyError, OSError) as error:
        print(json.dumps({'error': error.code if isinstance(error, WorkerError) else 'verification_failed',
                          'passed': False}), file=sys.stderr)
        sys.exit(1)
