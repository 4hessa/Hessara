"""Read-only isolated-worker preflight; never activates engines or runs artifacts."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys
import urllib.parse

from supervisor import IMAGE_DIGEST
from verification import load_verification

ENGINES = ('rea', 'ghidra', 'mobsf', 'jadx', 'rizin', 'angr', 'radare2')
ENVIRONMENT_NAMES = ('HESSARA_RE_PLATFORM_URL', 'HESSARA_RE_WORKER_TOKEN', 'HESSARA_RE_STORAGE_HOSTS')


def valid_origin(value: str) -> bool:
    try:
        origin = urllib.parse.urlsplit(value)
        return bool(origin.scheme == 'https' and origin.hostname and origin.path in ('', '/')
                    and not origin.username and not origin.password and not origin.query and not origin.fragment
                    and (origin.port is None or 1 <= origin.port <= 65535))
    except (ValueError, TypeError):
        return False


def inspect_worker(config: dict, *, environment=None, platform=None, docker_present=None) -> dict:
    env = os.environ if environment is None else environment
    platform = sys.platform if platform is None else platform
    docker_present = shutil.which('docker') is not None if docker_present is None else docker_present
    hosts = env.get('HESSARA_RE_STORAGE_HOSTS', '').split(',')
    checks = {
        'linuxHost': platform == 'linux',
        'dockerBinaryPresent': bool(docker_present),
        'httpsPlatformOriginConfigured': valid_origin(env.get('HESSARA_RE_PLATFORM_URL', '')),
        'workerTokenConfigured': len(env.get('HESSARA_RE_WORKER_TOKEN', '')) >= 32,
        'storageHostAllowlistConfigured': bool(hosts and all(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]*', host.strip()) for host in hosts)),
    }
    host_codes = [('linuxHost', 'LINUX_HOST_REQUIRED'), ('dockerBinaryPresent', 'DOCKER_REQUIRED'),
                  ('httpsPlatformOriginConfigured', 'PLATFORM_ORIGIN_REQUIRED'), ('workerTokenConfigured', 'WORKER_TOKEN_REQUIRED'),
                  ('storageHostAllowlistConfigured', 'STORAGE_ALLOWLIST_REQUIRED')]
    prerequisites = [code for key, code in host_codes if not checks[key]]
    records = []
    for engine in ENGINES:
        entry = config.get(engine)
        blockers = list(prerequisites)
        if not isinstance(entry, dict):
            blockers.append('ENGINE_CONFIGURATION_REQUIRED')
            entry = {}
        if entry.get('enabled') is not True:
            blockers.append('ENGINE_DISABLED')
        if not isinstance(entry.get('image'), str) or not IMAGE_DIGEST.fullmatch(entry['image']):
            blockers.append('IMAGE_UNPINNED')
        if entry.get('benchmarkApproved') is not True:
            blockers.append('BENCHMARK_REQUIRED')
        if not load_verification(entry, engine):
            blockers.append('VERIFIED_SAMPLE_REQUIRED')
        records.append({'engine': engine, 'blockers': blockers,
                        'configuredPrerequisitesPresent': not blockers, 'readyForAnalysis': False})
    return {'schemaVersion': 1, 'kind': 'read-only-worker-preflight', 'checks': checks, 'engines': records,
            'readyForAnalysis': False,
            'notice': 'No containers, daemon calls, downloads, network requests or artifact execution. Prerequisite checks do not certify runtime health, platform connectivity or successful analysis.',
            'environmentSource': 'Current worker process only. Values, URLs, tokens, private image references and verification paths are never emitted. Application database/auth/storage must be verified separately on the server.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('engines.json'))
    args = parser.parse_args()
    try:
        if args.config.stat().st_size > 32768:
            raise ValueError('configuration budget exceeded')
        config = json.loads(args.config.read_text(encoding='utf-8-sig'))
        if not isinstance(config, dict):
            raise ValueError('configuration object required')
        report = inspect_worker(config)
    except (OSError, ValueError, TypeError):
        print(json.dumps({'error': 'CONFIGURATION_UNREADABLE', 'readyForAnalysis': False}))
        return 1
    print(json.dumps(report, indent=2))
    return 0 if all(row['configuredPrerequisitesPresent'] for row in report['engines']) else 1


if __name__ == '__main__':
    sys.exit(main())
