"""Exercise catalog imports in an isolated copy with no network or game database."""
import importlib.util
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)


with tempfile.TemporaryDirectory(prefix='bunny-catalog-test-') as name:
    root = Path(name)
    (root/'tool').mkdir()
    for file in ('players.js','sticker-catalog.json','tool/stickers.py','tool/bunny-server.py'):
        shutil.copy2(ROOT/file, root/file)
    manager = module(root/'tool/stickers.py', 'test_stickers')
    catalog = manager.read_catalog()
    before = manager.generated(catalog)
    assert all(path.read_text() == text for path, text in manager.render_outputs(catalog))
    original_labels = {e['id'] for e in catalog['stickers'] if e['enabled']}
    pending = next(e for e in catalog['stickers'] if not e['enabled'])
    art = root/'test.png'
    art.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)) +
                    chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00\xff')) + chunk(b'IEND', b''))
    assert manager.verify_png(art.read_bytes()) == (1, 1)
    for invalid in (b'not a png', art.read_bytes()[:-12], art.read_bytes()[:-1]+b'x'):
        try:
            manager.verify_png(invalid)
            raise AssertionError('Corrupt art accepted')
        except ValueError:
            pass
    command = [sys.executable, str(root/'tool/stickers.py'), 'import', pending['id'], str(art),
               '--source', pending['source']]
    subprocess.run(command, check=True, capture_output=True)
    new_catalog = manager.read_catalog()
    assert {e['id'] for e in new_catalog['stickers'] if e['enabled']} == original_labels | {pending['id']}
    assert (root/pending['image']).read_bytes() == art.read_bytes()
    subprocess.run([sys.executable, str(root/'tool/stickers.py'), 'check'], check=True, capture_output=True)
    assert subprocess.run(command, capture_output=True).returncode != 0, 'Duplicate import must fail'
    server = module(root/'tool/bunny-server.py', 'test_bunny_catalog')
    profile = server.initial_profile()
    profile['coins'] = 40
    profile['stickers'] = {'chip': {'x': 20, 'y': 30}}
    for kwargs, present in (({}, False), ({'characters': True}, False), ({'characters': True, 'catalog': True}, True)):
        visible = server.player_view('test','Test','🐰',profile,**kwargs)
        assert (pending['id'] in visible['rewards']['prices']) is present
    event = dict(kind='redeem', sticker=pending['id'])
    server.BunnyHandler.update(None, 'test', profile, event)
    after_purchase = profile['coins']
    assert after_purchase == 40 - pending['cost']
    server.BunnyHandler.update(None, 'test', profile, event)
    assert profile['coins'] == after_purchase, 'Duplicate purchase charged twice'
    assert profile['stickers']['chip'] == {'x': 20, 'y': 30}
    assert profile['stickers'][pending['id']] is None
    server.BunnyHandler.update(None,'test',profile,dict(kind='sticker',sticker=pending['id'],x=30,y=50))
    assert profile['stickers'][pending['id']] == {'x': 30, 'y': 50}
    mission_profile = server.initial_profile()
    server.apply_round(mission_profile,dict(score=8,total=10,topics=['add','compare'],review=False,corrected=2,mission=pending['id']))
    assert pending['id'] in mission_profile['stickers']
    assert mission_profile['rounds'] == 1
    assert pending['id'] not in server.player_view('test','Test','🐰',profile,characters=True)['stickers']
    assert pending['id'] in server.player_view('test','Test','🐰',profile,characters=True,catalog=True)['stickers']
    print('PASS isolated import, generated client/server, invalid art, duplicate import/purchase, placement, missions, old-client compatibility and previous stickers')
