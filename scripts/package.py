"""Package the UXP plugin on macOS, Windows, or Linux with Python 3."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
plugin = root / 'plugin'
version = json.loads((plugin / 'manifest.json').read_text())['version']
output = root / 'dist' / f'局部改图-LK888-{version}.ccx'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(plugin.rglob('*')):
        if path.is_file() and path.name not in ('.uxprc', '.DS_Store'):
            archive.write(path, path.relative_to(plugin))
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
print(output)
