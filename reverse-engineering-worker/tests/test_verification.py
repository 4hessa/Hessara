"""Contract tests only: fixture reports are explicitly synthetic, never activation proof."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import base_result
from supervisor import Supervisor
from verification import safe_sample, load_verification, assert_sample


class VerificationTests(unittest.TestCase):
    def test_sample_is_reproducible_and_is_not_executed(self):
        self.assertEqual(safe_sample(), safe_sample())
        self.assertIn(b'index.js', safe_sample())

    def test_report_must_bind_image_version_fixture_and_assertion_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            config = dict(image='image@sha256:' + 'a' * 64, verificationReport=str(path))
            proof = dict(passed=True, imageDigest=config['image'], engineVersion='test-version',
                         artifactSha256=hashlib.sha256(safe_sample()).hexdigest(), verifiedAt=int(time.time() * 1000))
            report = dict(schemaVersion=1, kind='real-analysis-sample', engineId='rea', assertionProfile='rea-static-v1',
                          verification=proof, resultSha256='b' * 64)
            def write(value): path.write_text(json.dumps(value), encoding='utf-8')
            write(report)
            self.assertEqual(load_verification(config, 'rea', 'test-version'), proof)
            self.assertIsNone(load_verification(config, 'rea', 'different-version'))
            self.assertIsNone(load_verification({**config, 'image': 'other@sha256:' + 'a' * 64}, 'rea'))
            for change in ({'artifactSha256': 'c' * 64}, {'verifiedAt': int(time.time() * 1000) + 100000}, {'passed': False}):
                write({**report, 'verification': {**proof, **change}})
                self.assertIsNone(load_verification(config, 'rea'))
            for invalid in ({}, [], {**report, 'verification': []}, {**report, 'assertionProfile': 'wrong'}):
                write(invalid)
                self.assertIsNone(load_verification(config, 'rea'))

    def test_real_analysis_assertions_require_expected_evidence(self):
        for engine in ('ghidra', 'mobsf', 'jadx', 'rizin', 'angr', 'radare2'):
            with self.assertRaises(ValueError):
                assert_sample(engine, base_result(engine, 'unit-only'), 'owned-marker')
        with self.assertRaises(ValueError):
            assert_sample('rea', base_result('rea', 'unit-only'), 'index.js')

    def test_manual_approval_and_version_probe_cannot_replace_real_sample(self):
        worker = Supervisor.__new__(Supervisor)
        worker.worker_id, worker.health_cache, worker.health_at = 'unit-only', None, 0
        worker.config = {'rea': dict(enabled=True, benchmarkApproved=True,
            image='image@sha256:' + 'a' * 64, capabilities=['javascript-static-analysis'], reason='unit',
            memoryMb=1024, diskMb=1024)}
        with patch('supervisor.host_capacity', return_value={}), patch('supervisor.docker_command') as docker:
            record = worker.health()[0]
        self.assertTrue(record['enabled'])
        self.assertFalse(record['healthy'])
        self.assertEqual(record['reasonCode'], 'VERIFIED_SAMPLE_REQUIRED')
        docker.assert_not_called()


if __name__ == '__main__':
    unittest.main()
