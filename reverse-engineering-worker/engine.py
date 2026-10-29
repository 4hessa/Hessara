"""Engine entrypoint. Run only inside the supervisor's hardened containers."""
from __future__ import annotations

import argparse
import ast
import importlib.metadata
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from common import (MAX_CODE, MAX_ITEMS, WorkerError, base_result, bounded_process,
                    evidence, finish_result, inspect_format, utf8_view, validate_archive)

ROOT = Path('/work')
ARTIFACT = Path('/input/artifact')
FORMATS = {
    'rea': {'zip', 'asar'}, 'ghidra': {'elf', 'pe', 'macho'},
    'mobsf': {'apk'}, 'jadx': {'apk', 'dex', 'jar', 'aab'},
    'rizin': {'elf', 'pe', 'macho', 'dex'}, 'angr': {'elf', 'pe'},
    'radare2': {'elf', 'pe', 'macho', 'dex'},
}


def checked(args, timeout=30, **kwargs) -> bytes:
    output, errors, status = bounded_process(args, timeout, **kwargs)
    if status:
        # Diagnostics remain local and bounded. Supervisor exposes a generic error.
        print(errors.decode(errors='replace')[:2000], file=sys.stderr)
        raise WorkerError('tool_failure', 'Analysis tool returned an unsuccessful exit status.')
    return output


def tool_version(engine: str) -> str:
    commands = {'rea': ['rea', '--version'], 'jadx': ['jadx', '--version'],
                'rizin': ['rizin', '-v'], 'radare2': ['r2', '-v']}
    if engine in commands:
        return checked(commands[engine], timeout=20).decode(errors='replace').strip().splitlines()[0][:100]
    if engine == 'angr':
        return importlib.metadata.version('angr')
    if engine == 'ghidra':
        properties = Path('/opt/ghidra/Ghidra/application.properties').read_text()
        match = re.search(r'^application.version=(.+)$', properties, re.M)
        if not match or not Path('/opt/ghidra/support/analyzeHeadless').is_file():
            raise WorkerError('dependency_missing', 'Ghidra headless installation is missing.')
        checked(['java', '-version'])
        return match.group(1).strip()
    if engine == 'mobsf':
        init = Path('/home/mobsf/Mobile-Security-Framework-MobSF/mobsf/MobSF/init.py')
        tree = ast.parse(init.read_text())
        version = next((node.value.value for node in tree.body if isinstance(node, ast.Assign)
                        and any(isinstance(t, ast.Name) and t.id == 'VERSION' for t in node.targets)
                        and isinstance(node.value, ast.Constant)), None)
        importlib.metadata.version('Django')
        importlib.metadata.version('gunicorn')
        if not isinstance(version, str):
            raise WorkerError('dependency_missing', 'MobSF installation metadata is unavailable.')
        return version
    raise WorkerError('engine_unavailable', 'Unknown engine.')


def validate_options(engine: str, options: dict) -> dict:
    if not isinstance(options, dict):
        raise WorkerError('invalid_options', 'Analysis options must be an object.')
    allowed = {'maxFunctions', 'decompile', 'strings', 'symbols', 'symbolicExecution', 'maxSteps', 'maxPaths', 'maxStates', 'timeoutSeconds'}
    if set(options) - allowed:
        raise WorkerError('invalid_options', 'Unsupported analysis option.')
    for key in ('decompile', 'strings', 'symbols', 'symbolicExecution'):
        if key in options and type(options[key]) is not bool:
            raise WorkerError('invalid_options', 'Boolean analysis option required.')
    for key, maximum in (('maxFunctions', 400), ('maxSteps', 50), ('maxStates', 8), ('maxPaths', 8), ('timeoutSeconds', 300)):
        if key in options and (type(options[key]) is not int or not 1 <= options[key] <= maximum):
            raise WorkerError('invalid_options', f'{key} exceeds bounded policy.')
    if options.get('symbolicExecution') and engine != 'angr':
        raise WorkerError('unsupported_operation', 'Symbolic execution is available only through the bounded angr adapter.')
    if 'maxPaths' in options:
        options['maxStates'] = options['maxPaths']
    return options


def run_rea(result, options, timeout):
    target = ARTIFACT
    if inspect_format(ARTIFACT) == 'zip':
        validate_archive(ARTIFACT)
        with zipfile.ZipFile(ARTIFACT) as archive:
            names = set(archive.namelist())
            if 'package.json' not in names or not any(n.endswith(('.js', '.mjs', '.cjs', '.ts')) for n in names):
                raise WorkerError('unsupported_format', 'REA requires a static JavaScript application archive with package.json.')
        target = ROOT / 'application'
        target.mkdir(mode=0o700)
        with zipfile.ZipFile(ARTIFACT) as archive:
            for item in archive.infolist():
                destination = target / item.filename
                if item.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, destination.open('xb') as output:
                    count = 0
                    while chunk := source.read(65536):
                        count += len(chunk)
                        if count > item.file_size:
                            raise WorkerError('archive_limit', 'Archive entry exceeds its declared length.')
                        output.write(chunk)
        # Never install dependencies, execute npm scripts, attach a browser, or launch the app.
    raw = json.loads(checked(['rea', 'analyze-javascript-application', str(target), '--json'], timeout=timeout))
    normalize_rea_result(result, raw)


def normalize_rea_result(result: dict, raw) -> None:
    """Preserve upstream scope independently of bounded evidence rendering."""
    if isinstance(raw, dict) and raw.get('error'):
        raise WorkerError('tool_failure', 'REA reported an analysis failure.')
    normalized = raw.get('normalized_result') if isinstance(raw, dict) else None
    graph = normalized.get('graph') if isinstance(normalized, dict) else None
    if (not isinstance(graph, dict) or not isinstance(graph.get('nodes'), list)
            or not any(isinstance(node, dict) and node for node in graph['nodes'])):
        raise WorkerError('invalid_result', 'REA did not return structured application observations.')
    semantic = normalized.get('semantic_graph', {})
    semantic = semantic if isinstance(semantic, dict) else {}
    graph_coverage = graph.get('coverage') if isinstance(graph.get('coverage'), dict) else {}
    semantic_coverage = semantic.get('coverage') if isinstance(semantic.get('coverage'), dict) else {}
    partial = graph_coverage.get('status') != 'complete' or semantic_coverage.get('status') != 'complete'
    coverage_ref = evidence(result, 'coverage', 'REA declared analysis coverage', {
        'application': graph_coverage, 'semantic': semantic_coverage,
        'statistics': normalized.get('statistics', {}), 'confidence': raw.get('confidence', 'unknown')})
    # Keep upstream scope restrictions outside the bounded raw graph view. Its
    # tail can exceed 64 KiB, so embedding limitations only there would lose them.
    restrictions = []
    for source in (raw, normalized, graph, semantic):
        for item in source.get('limitations', []) if isinstance(source.get('limitations'), list) else []:
            if isinstance(item, str):
                message = utf8_view(re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', item), 2000)
                if message and message not in restrictions:
                    restrictions.append(message)
    result['limitations'] += restrictions[:30]
    if len(restrictions) > 30:
        result['limitations'].append('Upstream limitations view is capped at 30 distinct messages; consult declared coverage and retained raw evidence.')
    if partial:
        result['limitations'].append('REA reports partial or unknown graph coverage; missing relationships and semantic facts must not be interpreted as absent.')
    ref = evidence(result, 'static-application', 'REA static application evidence', raw)
    raw_size = len(json.dumps(raw, ensure_ascii=False).encode('utf-8'))
    result['evidence'][-1]['metadata'] = {'truncated': raw_size > MAX_CODE, 'originalBytes': raw_size}
    result['findings'].append(dict(title='Static JavaScript application evidence', severity='info',
                                   description='REA returned static observations and inferred relationships. Review the separate coverage evidence and upstream limitations.',
                                   confidence='inference' if partial or raw.get('confidence') != 'observed' else 'confirmed',
                                   evidenceIds=[coverage_ref, ref]))
    result['summary'] = ('REA returned bounded static JavaScript evidence with partial coverage.' if partial
                         else 'REA static JavaScript application analysis completed within its declared coverage.')
    result['limitations'] += ['Static CLI lane only. No arbitrary MCP calls, runtime capture, native provider, or external agent execution.',
                              'Evidence view is bounded to 64 KiB; large upstream graphs are not presented as complete.']


def run_rizin(result, options, timeout):
    executable = 'rizin' if result['engineId'] == 'rizin' else 'r2'
    per_command = max(1, timeout / 5)
    def query(command):
        return json.loads(checked([executable, '-N', '-2', '-q', '-c', command, str(ARTIFACT)], timeout=per_command))
    metadata = query('ij')
    ref = evidence(result, 'metadata', 'Binary metadata', metadata)
    result['findings'].append(dict(title='Binary metadata', severity='info', confidence='confirmed',
                                   description='Static file and binary metadata returned by the engine.', evidenceIds=[ref]))
    functions = query('aaa;aflj')
    function_ref = evidence(result, 'functions', 'Engine-discovered function records', functions, kind='function')
    for entry in functions[:options.get('maxFunctions', 400)] if isinstance(functions, list) else []:
        result['functions'].append(dict(name=str(entry.get('name', '')), address=hex(entry.get('offset', 0)),
                                        size=entry.get('size'), evidenceIds=[function_ref]))
    if options.get('symbols', True):
        evidence(result, 'symbols', 'Original symbol table', query('isj'), kind='symbol')
    strings = query('izj') if options.get('strings', True) else []
    string_ref = evidence(result, 'strings', 'Original string table', strings, kind='string')
    for entry in strings[:MAX_ITEMS] if isinstance(strings, list) else []:
        result['strings'].append(dict(value=str(entry.get('string', ''))[:2000],
                                      address=hex(entry.get('vaddr', 0)), evidenceIds=[string_ref]))
    imports = query('iij')
    import_ref = evidence(result, 'imports', 'Original import table', imports, kind='dependency')
    for entry in imports[:MAX_ITEMS] if isinstance(imports, list) else []:
        result['dependencies'].append(dict(name=str(entry.get('name', '')), kind='import', evidenceIds=[import_ref]))
    result['summary'] = f'{result["engineId"]} static binary inspection completed.'
    result['limitations'].append('Bounded static function discovery and original string/import tables; no debugging, target execution, or decompiler plugin.')


def run_jadx(result, options, timeout):
    out = ROOT / 'jadx'
    checked(['jadx', '--no-res', '--threads-count', '1', '--output-dir', str(out), str(ARTIFACT)], timeout=timeout)
    ref = evidence(result, 'decompilation', 'JADX decompilation', {'artifact': 'registered artifact', 'mode': 'Java sources; resources disabled'})
    budget = 1024 * 1024
    count = 0
    result['summary'] = 'JADX source decompilation completed.'
    for current, dirs, filenames in os.walk(out):
        dirs[:] = sorted(d for d in dirs if not (Path(current) / d).is_symlink())
        for name in sorted(filenames):
            path = Path(current) / name
            if path.is_symlink() or not path.is_file() or path.suffix not in {'.java', '.kt'}:
                continue
            count += 1
            if count > 100 or budget <= 0:
                result['limitations'].append('Source viewer limited to first 100 files / 1 MiB; absence from this view does not mean absent in the artifact.')
                return
            with path.open('rb') as source:
                data = source.read(min(MAX_CODE, budget))
            budget -= len(data)
            source_text = utf8_view(data.decode(errors='replace'))
            relative = path.relative_to(out).as_posix()
            result['files'].append(dict(path=relative, language='java',
                                        content=source_text, evidenceIds=[ref],
                                        truncated=path.stat().st_size > len(data)))
            for number, line in enumerate(source_text.splitlines(), 1):
                if len(result['functions']) >= 1000:
                    break
                # Navigation only: these are line locations in recovered Java,
                # not claims about original method signatures or native addresses.
                match = re.match(r'\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\],.?]+\s+(\w+)\s*\(', line)
                if match:
                    result['functions'].append(dict(name=match.group(1), location=f'{relative}:{number}',
                                                    signature=line.strip()[:300], evidenceIds=[ref],
                                                    representation='decompiled-source-navigation'))
    result['limitations'].append('Decompilation may be incomplete or inaccurate; it is a recovered source representation, not the original source.')


def run_ghidra(result, options, timeout):
    limit = str(options.get('maxFunctions', 100))
    decompile = 'true' if options.get('decompile', True) else 'false'
    checked(['/opt/ghidra/support/analyzeHeadless', '/work', 'investigation',
             '-import', str(ARTIFACT), '-deleteProject', '-analysisTimeoutPerFile', str(max(1, timeout - 20)),
             '-max-cpu', '1', '-scriptPath', '/opt/hessara/ghidra',
             '-postScript', 'HessaraExport.java', '/work/ghidra.json', limit, decompile], timeout=timeout,
            limit=512 * 1024)
    path = ROOT / 'ghidra.json'
    if not path.is_file() or path.stat().st_size > 1500 * 1024:
        raise WorkerError('output_limit', 'Ghidra did not produce a bounded complete export.')
    data = json.loads(path.read_text())
    ref = evidence(result, 'metadata', 'Ghidra program metadata', data.get('metadata', {}))
    for key in ('functions', 'strings', 'dependencies', 'files'):
        if key == 'strings' and not options.get('strings', True):
            continue
        result[key] = [dict(item, evidenceIds=[ref]) for item in data.get(key, [])][:MAX_ITEMS]
    result['summary'] = 'Ghidra headless analysis and bounded export completed.'
    result['limitations'] += data.get('limitations', [])
    result['limitations'].append('Bounded function/source export. Decompiled C is an approximation, not original source; unsupported instructions and failed decompilations remain unknown.')


def run_angr(result, options, timeout):
    import angr
    project = angr.Project(str(ARTIFACT), auto_load_libs=False)
    cfg = project.analyses.CFGFast(normalize=True, force_complete_scan=False)
    ref = evidence(result, 'cfg', 'angr static CFG', {'entry': hex(project.entry), 'architecture': project.arch.name,
                                                    'functionsObserved': len(cfg.kb.functions)})
    for address, function in list(cfg.kb.functions.items())[:options.get('maxFunctions', 400)]:
        result['functions'].append(dict(name=function.name, address=hex(address), size=function.size, evidenceIds=[ref]))
    if options.get('symbolicExecution', False):
        manager = project.factory.simulation_manager(project.factory.entry_state(), save_unconstrained=True)
        steps = 0
        max_states = options.get('maxStates', 4)
        deadline = time.monotonic() + max(1, timeout / 2)
        while manager.active and steps < options.get('maxSteps', 20) and time.monotonic() < deadline:
            manager.step(num_inst=32)
            steps += 1
            if len(manager.active) > max_states:
                manager.stashes['bounded_out'] = manager.active[max_states:]
                manager.stashes['active'] = manager.active[:max_states]
            # Keep all stashes bounded; only counts/addresses are exported.
            for key in list(manager.stashes):
                manager.stashes[key] = manager.stashes[key][:max_states]
        data = dict(steps=steps, activeAddresses=[hex(s.addr) for s in manager.active],
                    deadendedCount=len(manager.deadended), erroredCount=len(manager.errored))
        ref = evidence(result, 'bounded-paths', 'Bounded symbolic execution observations', data)
        result['findings'].append(dict(title='Bounded symbolic execution', severity='info', confidence='confirmed',
                                       description='Observed symbolic states within the configured step/state budget. No path exhaustiveness or vulnerability claim.', evidenceIds=[ref]))
    result['summary'] = 'angr static CFG and requested bounded symbolic inspection completed.'
    result['limitations'].append('Libraries are not automatically loaded. State pruning, symbolic defaults and missing environment models limit coverage; no proof of safety or exhaustive execution paths.')


def run_mobsf(result, options, timeout):
    """Fresh per-job MobSF API on loopback, in THIS network-none container."""
    home = ROOT / 'mobsf'
    home.mkdir()
    env = dict(os.environ, MOBSF_HOME_DIR=str(home), MOBSF_API_ONLY='1', MOBSF_ASYNC_ANALYSIS='0',
               MOBSF_SECRET_KEY=secrets.token_hex(32), MOBSF_API_KEY=secrets.token_hex(32),
               MOBSF_DOMAIN_MALWARE_SCAN='0', MOBSF_MULTIPROCESSING='0',
               MOBSF_JADX_TIMEOUT=str(max(1, timeout - 30)))
    cwd = '/home/mobsf/Mobile-Security-Framework-MobSF'
    checked(['python3', 'manage.py', 'migrate', '--noinput'], timeout=45, cwd=cwd, env=env, limit=65536)
    # No public listening socket, emulator, adb host binding, dynamic API or shared DB.
    service = subprocess.Popen(['gunicorn', '-b', '127.0.0.1:8000', 'mobsf.MobSF.wsgi:application',
                                '--workers=1', '--threads=1', '--timeout=' + str(timeout)],
                               stdin=subprocess.DEVNULL, stdout=sys.stderr, stderr=sys.stderr,
                               cwd=cwd, env=env, shell=False)
    def request(route, fields=None, upload=False):
        if upload:
            boundary = secrets.token_hex(16)
            extension = '.apk' if inspect_format(ARTIFACT) == 'apk' else '.ipa'
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="artifact{extension}"\r\n'
                    'Content-Type: application/octet-stream\r\n\r\n').encode() + ARTIFACT.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
            content_type = 'multipart/form-data; boundary=' + boundary
        else:
            body = urllib.parse.urlencode(fields or {}).encode()
            content_type = 'application/x-www-form-urlencoded'
        req = urllib.request.Request('http://127.0.0.1:8000/api/v1/' + route, data=body,
                                     headers={'Authorization': env['MOBSF_API_KEY'], 'Content-Type': content_type})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(1500 * 1024 + 1)
            if len(raw) > 1500 * 1024:
                raise WorkerError('output_limit', 'MobSF report exceeded the bounded report budget.')
            return json.loads(raw)
    try:
        uploaded = None
        for _ in range(40):
            if service.poll() is not None:
                raise WorkerError('tool_startup', 'MobSF API could not start offline.')
            try:
                uploaded = request('upload', upload=True)
                break
            except (ConnectionError, urllib.error.URLError):
                time.sleep(.5)
        if not uploaded or not re.fullmatch(r'[a-fA-F0-9]{32}', str(uploaded.get('hash', ''))):
            raise WorkerError('tool_failure', 'MobSF upload did not return a valid scan identity.')
        scanned = request('scan', {'hash': uploaded['hash']})
        if scanned.get('error'):
            raise WorkerError('tool_failure', 'MobSF scan failed.')
        report = request('report_json', {'hash': uploaded['hash']})
        ref = evidence(result, 'static-report', 'MobSF static report', report)
        for item in report.get('manifest_analysis', {}).get('manifest_findings', [])[:200]:
            severity = str(item.get('severity', 'info')).lower()
            result['findings'].append(dict(title=str(item.get('title', 'Manifest observation'))[:300],
                                           description=str(item.get('description', ''))[:4000],
                                           severity=severity if severity in {'critical', 'high', 'medium', 'low', 'info'} else 'info',
                                           confidence='inference', evidenceIds=[ref]))
        for name, value in list(report.get('permissions', {}).items())[:200]:
            result['findings'].append(dict(title=str(name)[:300], description=json.dumps(value)[:2000],
                                           severity='info', confidence='confirmed', evidenceIds=[ref]))
        result['summary'] = 'MobSF offline static API scan completed.'
        result['limitations'].append('Static scan only. Network intelligence, emulators, device access and dynamic analysis are disabled. Report evidence view capped at 64 KiB.')
    finally:
        service.terminate()
        try:
            service.wait(timeout=3)
        except subprocess.TimeoutExpired:
            service.kill()
            service.wait(timeout=3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--health', action='store_true')
    parser.add_argument('--engine', default=os.environ.get('HESSARA_ENGINE'))
    parser.add_argument('--format')
    parser.add_argument('--options', default='{}')
    parser.add_argument('--timeout', type=int, default=120)
    args = parser.parse_args()
    if args.engine not in FORMATS:
        raise WorkerError('engine_unavailable', 'Engine identity is missing or unsupported.')
    version = tool_version(args.engine)
    if args.health:
        print(json.dumps({'healthy': True, 'version': version}))
        return
    if os.environ.get('HESSARA_RE_CONTAINER') != '1' or sys.platform != 'linux' or os.getuid() == 0:
        raise WorkerError('isolation_required', 'Analysis requires the non-root isolated job container.')
    if not 1 <= args.timeout <= 300:
        raise WorkerError('invalid_options', 'Execution deadline exceeds policy.')
    options = validate_options(args.engine, json.loads(args.options))
    observed = inspect_format(ARTIFACT)
    if observed != args.format or observed not in FORMATS[args.engine]:
        raise WorkerError('unsupported_format', 'Artifact content does not match this engine and registered format.')
    started = time.monotonic()
    result = base_result(args.engine, version)
    {'rea': run_rea, 'ghidra': run_ghidra, 'jadx': run_jadx, 'mobsf': run_mobsf,
     'rizin': run_rizin, 'radare2': run_rizin, 'angr': run_angr}[args.engine](result, options, args.timeout)
    result['metrics']['durationMs'] = round((time.monotonic() - started) * 1000)
    print(json.dumps(finish_result(result), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (WorkerError, ValueError, OSError, ImportError) as error:
        print(json.dumps({'error': error.code if isinstance(error, WorkerError) else 'tool_failure',
                          'message': str(error)[:500]}), file=sys.stderr)
        sys.exit(1)
