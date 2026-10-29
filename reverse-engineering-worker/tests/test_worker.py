"""Unit/contract tests only. These are NOT evidence that any engine is installed."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import WorkerError, bounded_process, inspect_format, validate_archive, base_result, evidence, finish_result, utf8_view, classify_archive_names
from engine import ARTIFACT, validate_options, run_rea, run_rizin, run_jadx, run_ghidra
from supervisor import hardening, secure_url, download, sanitized_log, Supervisor, cleanup_container, classify_failure

TEST_TEMP = Path(__file__).resolve().parents[1] / '.test-tmp'
TEST_TEMP.mkdir(exist_ok=True)
tempfile.tempdir = str(TEST_TEMP)

class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifact = self.root / 'artifact'

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, entries):
        with zipfile.ZipFile(self.artifact, 'w') as archive:
            for name, data in entries:
                archive.writestr(name, data)

    def test_magic_not_extension(self):
        self.artifact.write_bytes(b'\x7fELF\x02\x01\x01' + bytes(57))
        self.assertEqual(inspect_format(self.artifact), 'elf')

    def test_arbitrary_zip_detected_without_execution(self):
        self.archive([('unrelated.txt', 'hello')])
        self.assertEqual(inspect_format(self.artifact), 'zip')

    def test_reject_traversal(self):
        self.archive([('../escape.js', 'bad')])
        with self.assertRaisesRegex(WorkerError, 'Unsafe'):
            validate_archive(self.artifact)
        self.assertFalse((self.root.parent / 'escape.js').exists())

    def test_reject_windows_path(self):
        self.archive([('C:\\escape', 'bad')])
        with self.assertRaises(WorkerError):
            validate_archive(self.artifact)

    def test_reject_duplicate_names(self):
        with zipfile.ZipFile(self.artifact, 'w') as archive:
            archive.writestr('x', 'one')
            with self.assertWarns(UserWarning):
                archive.writestr('x', 'two')
        with self.assertRaises(WorkerError):
            validate_archive(self.artifact)

    def test_reject_symlink(self):
        entry = zipfile.ZipInfo('link')
        entry.create_system = 3
        entry.external_attr = (0o120777 << 16)
        with zipfile.ZipFile(self.artifact, 'w') as archive:
            archive.writestr(entry, '/etc/passwd')
        with self.assertRaises(WorkerError):
            validate_archive(self.artifact)

    def test_reject_expansion_bomb(self):
        with zipfile.ZipFile(self.artifact, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('x', 'a' * 300000)
        with self.assertRaisesRegex(WorkerError, 'expansion'):
            validate_archive(self.artifact)

    def test_android_and_js_content_detection(self):
        self.archive([('AndroidManifest.xml', 'manifest'), ('classes.dex', b'dex\n035\0')])
        self.assertEqual(inspect_format(self.artifact), 'apk')
        self.archive([('package.json', '{}'), ('index.js', 'export const safe = 1;')])
        self.assertEqual(inspect_format(self.artifact), 'zip')

    def test_shared_api_worker_format_contract(self):
        fixtures = Path(__file__).parents[2] / 'tests' / 'fixtures' / 'reverse-format-cases.json'
        for case in json.loads(fixtures.read_text(encoding='utf-8')):
            with self.subTest(names=case['names']):
                self.archive([(name, 'authored-fixture') for name in case['names']])
                self.assertEqual(classify_archive_names(case['names']), case['format'])
                self.assertEqual(inspect_format(self.artifact), case['format'])

    def test_pe_header_validation(self):
        head = bytearray(128)
        head[:2] = b'MZ'
        head[60:64] = (80).to_bytes(4, 'little')
        head[80:84] = b'PE\0\0'
        self.artifact.write_bytes(head)
        self.assertEqual(inspect_format(self.artifact), 'pe')
        head[80:84] = b'bad!'
        self.artifact.write_bytes(head)
        with self.assertRaises(WorkerError):
            inspect_format(self.artifact)


class SecurityTests(unittest.TestCase):
    def test_https_origin_allowlist(self):
        self.assertEqual(secure_url('https://storage.example/object?token=secret', {'storage.example'}), 'https://storage.example/object?token=secret')
        for url in ['http://storage.example/object', 'https://evil.example/object', 'https://storage.example:9000/o',
                    'https://user:pass@storage.example/o', 'https://storage.example/o#fragment', 'http://169.254.169.254/']:
            with self.assertRaises(WorkerError):
                secure_url(url, {'storage.example'})

    def test_download_hash_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'artifact'
            artifact = dict(downloadUrl='https://storage.example/object', sizeBytes=4, sha256='a' * 64)
            fake_opener = unittest.mock.Mock()
            fake_opener.open.return_value = io.BytesIO(b'safe')
            with patch('supervisor.urllib.request.build_opener', return_value=fake_opener):
                with self.assertRaisesRegex(WorkerError, 'digest'):
                    download(artifact, target, {'storage.example'})

    def test_download_oversize_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = dict(downloadUrl='https://storage.example/object', sizeBytes=1, sha256=hashlib.sha256(b'x').hexdigest())
            fake_opener = unittest.mock.Mock()
            fake_opener.open.return_value = io.BytesIO(b'toolong')
            with patch('supervisor.urllib.request.build_opener', return_value=fake_opener):
                with self.assertRaisesRegex(WorkerError, 'length'):
                    download(artifact, Path(directory) / 'artifact', {'storage.example'})

    def test_hardening_no_credentials_or_socket(self):
        config = dict(image='registry.example/engine@sha256:' + 'a' * 64, cpu=.75, memoryMb=768, diskMb=256)
        args = hardening(config, name='hessara-re-test', worker_id='test', artifact=Path('/tmp/artifact'))
        self.assertEqual(args[args.index('--network') + 1], 'none')
        self.assertEqual(args[args.index('--user') + 1], '10001:10001')
        for value in ['--read-only', '--cap-drop', 'ALL', '--pids-limit', '--memory-swap', 'no-new-privileges:true']:
            self.assertIn(value, args)
        serialized = ' '.join(args)
        for value in ['docker.sock', '--privileged', 'WORKER_TOKEN', '--publish', '--device']:
            self.assertNotIn(value, serialized)

    def test_requires_immutable_image(self):
        with self.assertRaises(WorkerError):
            hardening(dict(image='engine:latest'), name='test', worker_id='test')

    def test_default_config_never_advertises_operational(self):
        config = json.loads((Path(__file__).parents[1] / 'engines.json').read_text(encoding='utf-8-sig'))
        self.assertEqual(len(config), 7)
        self.assertTrue(all(not x['enabled'] and not x['benchmarkApproved'] and not x['image'] for x in config.values()))

    def test_reject_arbitrary_options_and_large_paths(self):
        for options in [dict(command='!cat /etc/passwd'), dict(url='https://target'), dict(maxPaths=9), dict(maxSteps=51), dict(decompile='yes')]:
            with self.assertRaises(WorkerError):
                validate_options('angr', options)
        self.assertEqual(validate_options('angr', {'maxPaths': 4})['maxStates'], 4)


class ProcessTests(unittest.TestCase):
    def test_literal_argument_no_shell(self):
        literal = '$(echo injected); & whoami'
        output, _, status = bounded_process([sys.executable, '-c', 'import sys; print(sys.argv[1])', literal], 5)
        self.assertEqual(status, 0)
        self.assertEqual(output.decode().strip(), literal)

    def test_execution_timeout(self):
        with self.assertRaisesRegex(WorkerError, 'deadline'):
            bounded_process([sys.executable, '-c', 'import time; time.sleep(5)'], .1)

    def test_cancellation(self):
        with self.assertRaisesRegex(WorkerError, 'cancelled'):
            bounded_process([sys.executable, '-c', 'import time; time.sleep(5)'], 5, cancel=lambda: True)

    def test_bounded_stdout_and_stderr(self):
        with self.assertRaisesRegex(WorkerError, 'budget|policy'):
            bounded_process([sys.executable, '-c', 'import sys; sys.stdout.write("x"*100000); sys.stderr.write("y"*100000)'], 5, limit=1000)


class ResultTests(unittest.TestCase):
    def test_ghidra_string_publication_respects_option(self):
        # Explicitly mocked exporter output; no Ghidra installation/execution claim.
        exported = dict(metadata={'format': 'ELF'},
                        functions=[{'name': 'main', 'address': '1000'}],
                        strings=[{'value': 'owned fixture string', 'address': '2000'}],
                        dependencies=[{'name': 'libc', 'kind': 'external-library'}],
                        files=[{'path': 'main.c', 'content': 'int main(void) { return 0; }'}],
                        limitations=['fixture coverage is bounded'])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'ghidra.json').write_text(json.dumps(exported), encoding='utf-8')
            for options, expected_count in [({}, 1), ({'strings': True}, 1), ({'strings': False}, 0)]:
                with self.subTest(options=options):
                    result = base_result('ghidra', 'unit-fixture')
                    with patch('engine.ROOT', root), patch('engine.checked', return_value=b''):
                        run_ghidra(result, options, 30)
                    self.assertEqual(len(result['strings']), expected_count)
                    for key in ('functions', 'dependencies', 'files'):
                        self.assertEqual(len(result[key]), 1)
                        self.assertEqual(result[key][0]['evidenceIds'], ['ghidra:metadata'])
                    self.assertEqual(len(result['evidence']), 1)
                    self.assertIn('fixture coverage is bounded', result['limitations'])

    def test_utf8_budget(self):
        result = base_result('rea', 'test')
        evidence(result, 'example', 'Example', {'text': '界' * 50000})
        self.assertLessEqual(len(result['evidence'][0]['content'].encode()), 65536)
        self.assertEqual(result['evidence'][0]['kind'], 'metadata')
        self.assertIn('name', result['evidence'][0])

    def test_result_budget_rejected(self):
        result = base_result('rea', 'test')
        result['files'] = [{'content': 'x' * 64000}] * 40
        with self.assertRaises(WorkerError):
            finish_result(result)

    def test_adapter_uses_fixed_rizin_commands(self):
        result = base_result('rizin', 'unit-fixture')
        responses = [b'{"bin":{"arch":"x86"}}', b'[{"name":"main","offset":4096,"size":2}]', b'[]', b'[{"string":"safe","vaddr":8192}]', b'[{"name":"puts"}]']
        with patch('engine.checked', side_effect=responses) as process:
            run_rizin(result, {}, 20)
        self.assertEqual(result['functions'][0]['name'], 'main')
        self.assertEqual(result['strings'][0]['value'], 'safe')
        self.assertEqual(result['dependencies'][0]['name'], 'puts')
        self.assertEqual([call.args[0][5] for call in process.call_args_list], ['ij', 'aaa;aflj', 'isj', 'izj', 'iij'])
        self.assertTrue(all(call.args[0][-1] == str(ARTIFACT) for call in process.call_args_list))


class SupervisorLifecycleTests(unittest.TestCase):
    def run_job(self, *, error=None, cleanup_error=False, create_error=False, download_error=None):
        worker = Supervisor.__new__(Supervisor)
        worker.worker_id = 'unit-worker'
        worker.storage_hosts = {'storage.example'}
        worker.config = {'rizin': dict(enabled=True, benchmarkApproved=True,
                                     image='image@sha256:' + 'a' * 64, memoryMb=768,
                                     cpu=.75, diskMb=256, timeoutSeconds=60)}
        events = []
        class FakeClient:
            def request(self, action, **payload):
                events.append((action, payload))
                return {'cancelRequested': False}
        worker.client = FakeClient()
        claim = dict(job=dict(id='unit-job', engineId='rizin', artifact={'format': 'elf'},
                              options={}, timeoutSeconds=60, expectedEngineVersion='fixture', expectedImageDigest='image@sha256:' + 'a' * 64), leaseToken='lease')
        def fake_docker(args, **kwargs):
            if 'create' in args and create_error:
                raise WorkerError('timed_out', 'Daemon may have created the container; client timed out')
            if 'inspect' in args:
                return b'{"OOMKilled":false,"ExitCode":0}'
            return b'container-id'
        def fake_cleanup(name):
            events.append(('cleanup', name))
            if cleanup_error:
                raise WorkerError('container_failure', 'simulated cleanup failure')
        with patch('supervisor.load_verification', return_value={'engineVersion': 'fixture', 'imageDigest': 'image@sha256:' + 'a' * 64}), \
             patch('supervisor.host_capacity', return_value={'availableMemoryMb': 10000}), \
             patch('supervisor.download', side_effect=download_error or (lambda a, p, h: p.write_bytes(b'owned unit fixture'))), \
             patch('supervisor.docker_command', side_effect=fake_docker), \
             patch('supervisor.bounded_process', side_effect=error,
                   return_value=(json.dumps(base_result('rizin', 'fixture')).encode(), b'', 0)), \
             patch('supervisor.cleanup_container', side_effect=fake_cleanup), \
             patch('supervisor.STOP', new=__import__('threading').Event()):
            worker.execute(claim)
        return events

    def test_success_publishes_only_after_cleanup(self):
        events = self.run_job()
        names = [event[0] for event in events]
        self.assertLess(names.index('cleanup'), names.index('complete'))

    def test_timeout_releases_container_and_reports_timeout(self):
        events = self.run_job(error=WorkerError('timed_out', 'unit timeout'))
        self.assertEqual(events[-1][0], 'fail')
        self.assertEqual(events[-1][1]['code'], 'TIMEOUT')
        self.assertFalse(events[-1][1]['retryable'])
        self.assertIn('cleanup', [event[0] for event in events])

    def test_unverified_cleanup_cannot_publish_success(self):
        events = self.run_job(cleanup_error=True)
        self.assertEqual(events[-1][0], 'fail')
        self.assertEqual(events[-1][1]['code'], 'CLEANUP_FAILED')
        self.assertNotIn('complete', [event[0] for event in events])

    def test_uncertain_remote_create_is_reconciled_before_reporting_failure(self):
        events = self.run_job(create_error=True)
        self.assertIn('cleanup', [event[0] for event in events])
        self.assertLess([x[0] for x in events].index('cleanup'), [x[0] for x in events].index('fail'))
        self.assertNotIn('complete', [event[0] for event in events])

    def test_failed_download_is_retryable_only_for_classified_transient_infrastructure(self):
        import urllib.error
        events = self.run_job(download_error=urllib.error.URLError('simulated timeout'))
        self.assertEqual(events[-1][1]['code'], 'NETWORK_TEMPORARY')
        self.assertTrue(events[-1][1]['retryable'])
        self.assertNotIn('cleanup', [event[0] for event in events])
        for error in [WorkerError('integrity_mismatch', 'bad digest'), WorkerError('memory_limit', 'limit'), WorkerError('tool_failure', 'bad artifact')]:
            self.assertFalse(classify_failure(error, 'download')[1])
        self.assertFalse(classify_failure(urllib.error.URLError('timeout'), 'running')[1])

    def test_cleanup_can_accept_absence_only_after_a_successful_daemon_query(self):
        with patch('supervisor.docker_command', side_effect=[WorkerError('container_failure','rm uncertain'), b'']) as docker:
            cleanup_container('hessara-re-unit-job')
            self.assertEqual(docker.call_args_list[1].args[0][1], 'ps')
        for remaining in [b'remaining-container', WorkerError('container_failure','daemon unavailable')]:
            with patch('supervisor.docker_command', side_effect=[WorkerError('container_failure','rm uncertain'), remaining]):
                with self.assertRaises(WorkerError):
                    cleanup_container('hessara-re-unit-job')

    def test_logs_strip_control_sequences_and_bound_content(self):
        text = sanitized_log(b'\x00\x1b[31mwarning\x1b[0m' + b'x' * 2000)
        self.assertNotIn('\x00', text)
        self.assertNotIn('\x1b', text)
        self.assertLessEqual(len(text), 1000)


if __name__ == '__main__':
    unittest.main()
