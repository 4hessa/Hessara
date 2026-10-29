"""Shared bounded IO. This module never executes an uploaded artifact."""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import signal
import stat
import subprocess
import threading
import time
import zipfile

MAX_UPLOAD = 100 * 1024 * 1024
MAX_RESULT = 1900 * 1024
MAX_ITEMS = 1000
MAX_CODE = 65536


class WorkerError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(65536), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_archive(path: Path) -> set[str]:
    """Inspect ZIP central directory without materializing any members."""
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 10000:
                raise WorkerError('archive_limit', 'Archive has too many entries.')
            names: set[str] = set()
            total = 0
            for entry in entries:
                name = entry.filename
                segments = PurePosixPath(name.replace('\\', '/'))
                if ('\x00' in name or '\\' in name or ':' in name
                        or segments.is_absolute() or '..' in segments.parts
                        or stat.S_ISLNK(entry.external_attr >> 16)
                        or entry.flag_bits & 1 or name in names):
                    raise WorkerError('unsafe_archive', 'Unsafe or encrypted archive entry.')
                names.add(name)
                total += entry.file_size
                if (entry.file_size > 64 * 1024 * 1024 or total > 256 * 1024 * 1024
                        or entry.file_size > max(entry.compress_size, 1) * 100):
                    raise WorkerError('archive_limit', 'Archive expansion exceeds policy.')
            return names
    except zipfile.BadZipFile as error:
        raise WorkerError('invalid_artifact', 'Corrupted ZIP container.') from error


def classify_archive_names(entries) -> str:
    """Canonical order/predicates; shared fixtures cover the API implementation."""
    names = set(entries)
    if 'AndroidManifest.xml' in names and any(re.fullmatch(r'classes\d*\.dex', name) for name in names):
        return 'apk'
    if 'base/manifest/AndroidManifest.xml' in names and 'BundleConfig.pb' in names:
        return 'aab'
    if 'META-INF/MANIFEST.MF' in names and any(name.endswith('.class') for name in names):
        return 'jar'
    return 'zip'


def inspect_format(path: Path) -> str:
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_UPLOAD:
        raise WorkerError('invalid_artifact', 'Artifact size or file type is invalid.')
    with path.open('rb') as source:
        head = source.read(4096)
    if head.startswith(b'\x7fELF'):
        if len(head) < 52 or head[4] not in (1, 2) or head[5] not in (1, 2) or head[6] != 1 or (head[4] == 2 and len(head) < 64):
            raise WorkerError('invalid_artifact', 'Malformed ELF header.')
        return 'elf'
    if head.startswith(b'MZ') and len(head) >= 64:
        offset = int.from_bytes(head[60:64], 'little')
        if 64 <= offset <= min(path.stat().st_size - 4, 1024 * 1024):
            with path.open('rb') as source:
                source.seek(offset)
                if source.read(4) == b'PE\x00\x00':
                    return 'pe'
        raise WorkerError('invalid_artifact', 'Malformed PE header.')
    if head[:4] in (b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'):
        if len(head) < 32 or (head[:4] == b'\xca\xfe\xba\xbe' and int.from_bytes(head[4:8], 'big') > 64):
            raise WorkerError('unsupported_format', 'Ambiguous or malformed Mach-O header.')
        return 'macho'
    if head.startswith(b'dex\n') and head[7:8] == b'\x00':
        if (len(head) < 112 or int.from_bytes(head[32:36], 'little') != path.stat().st_size
                or int.from_bytes(head[36:40], 'little') != 112):
            raise WorkerError('invalid_artifact', 'Malformed DEX header.')
        return 'dex'
    if head.startswith(b'PK\x03\x04'):
        names = validate_archive(path)
        return classify_archive_names(names)
    # ASAR Pickle header: bounded JSON validation; never trust the extension.
    if len(head) >= 16 and int.from_bytes(head[:4], 'little') == 4:
        size = int.from_bytes(head[12:16], 'little')
        if 0 < size <= 4 * 1024 * 1024 and size < path.stat().st_size - 16:
            with path.open('rb') as source:
                source.seek(16)
                try:
                    header = json.loads(source.read(size))
                    if isinstance(header, dict) and isinstance(header.get('files'), dict):
                        count = 0
                        def walk(entries, depth=0):
                            nonlocal count
                            if depth > 32 or not isinstance(entries, dict):
                                raise WorkerError('unsafe_archive', 'ASAR structure exceeds policy.')
                            for name, node in entries.items():
                                count += 1
                                if (count > 10000 or not isinstance(name, str) or not name or name in ('.', '..')
                                        or any(char in name for char in '/\\:\x00') or not isinstance(node, dict)
                                        or node.get('link') or node.get('unpacked')):
                                    raise WorkerError('unsafe_archive', 'Unsafe ASAR entry.')
                                if 'files' in node:
                                    walk(node['files'], depth + 1)
                                elif (type(node.get('size')) is not int or not 0 <= node['size'] <= MAX_UPLOAD
                                      or not str(node.get('offset', '')).isdigit()
                                      or int(node['offset']) + node['size'] > path.stat().st_size):
                                    raise WorkerError('unsafe_archive', 'ASAR entry range exceeds policy.')
                        walk(header['files'])
                        return 'asar'
                except (ValueError, UnicodeError):
                    pass
    raise WorkerError('unsupported_format', 'Unsupported artifact content.')


def bounded_process(args: list[str], timeout: float, *, cwd: str | None = None,
                    env: dict | None = None, limit: int = MAX_RESULT,
                    cancel=None, on_stderr=None) -> tuple[bytes, bytes, int]:
    """Drain both pipes concurrently; terminate on timeout/cancel/output pressure."""
    proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, shell=False, cwd=cwd, env=env,
                            start_new_session=os.name != 'nt')
    buffers = [bytearray(), bytearray()]
    overflow = threading.Event()

    def read_pipe(pipe, index):
        while True:
            data = pipe.read(8192)
            if not data:
                break
            room = limit - len(buffers[index])
            buffers[index].extend(data[:max(0, room)])
            if index == 1 and on_stderr:
                on_stderr(data[:1024])
            if len(data) > room:
                overflow.set()

    readers = [threading.Thread(target=read_pipe, args=(proc.stdout, 0), daemon=True),
               threading.Thread(target=read_pipe, args=(proc.stderr, 1), daemon=True)]
    for reader in readers:
        reader.start()
    deadline = time.monotonic() + timeout
    problem = None
    try:
        while proc.poll() is None:
            if overflow.is_set():
                problem = WorkerError('output_limit', 'Tool output exceeded the bounded result budget.')
                break
            if cancel and cancel():
                problem = WorkerError('cancelled', 'Analysis was cancelled.')
                break
            if time.monotonic() >= deadline:
                problem = WorkerError('timed_out', 'Analysis exceeded its execution deadline.')
                break
            time.sleep(.1)
    finally:
        if proc.poll() is None:
            if os.name == 'nt':
                proc.kill()
            else:
                os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=10)
        for reader in readers:
            reader.join(timeout=2)
        proc.stdout.close()
        proc.stderr.close()
    if problem:
        raise problem
    if overflow.is_set():
        raise WorkerError('output_limit', 'Tool output exceeded policy.')
    return bytes(buffers[0]), bytes(buffers[1]), proc.returncode


def base_result(engine: str, version: str) -> dict:
    return dict(engineId=engine, engineVersion=version, summary='', findings=[], evidence=[],
                functions=[], strings=[], dependencies=[], files=[], limitations=[], metrics={})


def utf8_view(text: str, limit: int = MAX_CODE) -> str:
    return text.encode('utf-8')[:limit].decode('utf-8', errors='ignore')


def evidence(result: dict, key: str, title: str, data, *, kind='metadata') -> str:
    identifier = f'{result["engineId"]}:{key}'[:200]
    result['evidence'].append(dict(id=identifier, kind=kind, name=title[:300],
                                   content=utf8_view(json.dumps(data, ensure_ascii=False))))
    return identifier


def finish_result(result: dict) -> dict:
    for key in ('findings', 'evidence', 'functions', 'strings', 'dependencies', 'files'):
        if len(result[key]) > MAX_ITEMS:
            result['limitations'].append(f'{key} truncated to {MAX_ITEMS} records.')
            result[key] = result[key][:MAX_ITEMS]
    if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_RESULT:
        raise WorkerError('output_limit', 'Normalized result exceeds policy; narrow the analysis.')
    return result
