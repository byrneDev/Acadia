#!/usr/bin/env python3
"""Package only the files explicitly tracked by Git for public distribution."""
from pathlib import Path
import json
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
tracked = subprocess.run(
    ['git', 'ls-files', '-z'], cwd=root, check=True, capture_output=True
).stdout.decode('utf-8').split('\0')
files = sorted(name for name in tracked if name)
if not files:
    raise SystemExit('No Git-tracked files found. Stage the reviewed public source files first.')
version = json.loads((root / 'package.json').read_text())['version']
target = root / 'release' / f'v{version}' / f'Acadia-{version}-source.zip'
target.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        path = root / name
        if path.is_symlink():
            raise SystemExit(f'Refusing to package a symlink: {name}')
        if path.is_file():
            archive.write(path, Path('Acadia-source') / name)
print(target)
