"""Read-only preflight tests; synthetic reports are never engine activation proof."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from doctor import inspect_worker, valid_origin, ENGINES


class WorkerDoctorTests(unittest.TestCase):
    def test_missing_host_and_configuration_gates_remain_explicit(self):
        report = inspect_worker({}, environment={}, platform='win32', docker_present=False)
        self.assertFalse(report['readyForAnalysis'])
        self.assertEqual(len(report['engines']), 7)
        for engine in report['engines']:
            for code in ['LINUX_HOST_REQUIRED', 'DOCKER_REQUIRED', 'WORKER_TOKEN_REQUIRED', 'IMAGE_UNPINNED', 'VERIFIED_SAMPLE_REQUIRED']:
                self.assertIn(code, engine['blockers'])
            self.assertFalse(engine['readyForAnalysis'])

    def test_even_passing_prerequisites_are_not_an_execution_certificate(self):
        config = {engine: dict(enabled=True, benchmarkApproved=True, image='private/engine@sha256:' + 'a' * 64) for engine in ENGINES}
        env = {'HESSARA_RE_PLATFORM_URL': 'https://private.example', 'HESSARA_RE_WORKER_TOKEN': 'secret-value-' * 8, 'HESSARA_RE_STORAGE_HOSTS': 'private-storage.example'}
        with patch('doctor.load_verification', return_value={'passed': True}):
            report = inspect_worker(config, environment=env, platform='linux', docker_present=True)
        self.assertTrue(all(row['configuredPrerequisitesPresent'] for row in report['engines']))
        self.assertFalse(report['readyForAnalysis'])
        serialized = json.dumps(report)
        for value in ['private.example', 'secret-value-', 'private-storage.example', 'private/engine']:
            self.assertNotIn(value, serialized)

    def test_origin_must_be_an_https_origin_not_an_endpoint_or_credential_url(self):
        self.assertTrue(valid_origin('https://platform.example'))
        self.assertTrue(valid_origin('https://platform.example/'))
        for value in ['http://platform.example', 'https://platform.example/api', 'https://user:password@platform.example', 'https://platform.example?secret=value', 'https://platform.example/#fragment', 'https://platform.example:invalid']:
            self.assertFalse(valid_origin(value), value)

    def test_bad_storage_allowlist_and_short_token_do_not_pass(self):
        env = {'HESSARA_RE_WORKER_TOKEN': 'short', 'HESSARA_RE_STORAGE_HOSTS': 'https://storage.example/path'}
        report = inspect_worker({}, environment=env, platform='linux', docker_present=True)
        self.assertFalse(report['checks']['workerTokenConfigured'])
        self.assertFalse(report['checks']['storageHostAllowlistConfigured'])
        self.assertNotIn('short', json.dumps(report))


if __name__ == '__main__':
    unittest.main()
