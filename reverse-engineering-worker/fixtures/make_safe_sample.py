"""Create our own harmless JS source archive; does not run its contents."""
from pathlib import Path
import hashlib
import json
import zipfile

destination = Path(__file__).with_name('hessara-safe-sample.zip')
with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED) as archive:
    archive.writestr('package.json', json.dumps({'name': 'hessara-owned-safe-sample', 'version': '1.0.0', 'main': 'index.js'}))
    archive.writestr('index.js', 'export function add(left, right) { return left + right; }\nexport const label = "HESSARA safe sample";\n')
print(json.dumps({'artifact': str(destination), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'bytes': destination.stat().st_size}))
