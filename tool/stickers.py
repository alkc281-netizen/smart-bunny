"""Maintain sticker-catalog.json and generate matching client/server definitions."""
import argparse
import json
import re
import struct
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'sticker-catalog.json'


def read_catalog():
    data = json.loads(CATALOG.read_text())
    collections = {entry['id'] for entry in data['collections']} | {'basic'}
    identifiers = set()
    for entry in data['stickers']:
        key = entry['id']
        if not re.fullmatch(r'[a-z][a-z0-9]*', key) or key in identifiers:
            raise ValueError('Invalid or duplicate sticker ID: ' + key)
        identifiers.add(key)
        if entry['collection'] not in collections or type(entry['enabled']) is not bool:
            raise ValueError('Invalid collection or enabled flag: ' + key)
        if not all(isinstance(entry.get(field), str) and entry[field].strip() for field in ('icon', 'name', 'rule')):
            raise ValueError('Missing label: ' + key)
        if 'cost' in entry and (type(entry['cost']) is not int or not 1 <= entry['cost'] <= 100):
            raise ValueError('Invalid cost: ' + key)
        if entry.get('mission') not in (None, 'russian', 'math', 'mixed', 'review'):
            raise ValueError('Unknown mission: ' + key)
        bio = entry.get('bio')
        if entry['enabled'] and entry['collection'] != 'basic' and bio is None:
            raise ValueError('Missing character description: ' + key)
        if bio is not None and (not isinstance(bio, dict) or set(bio) != {'intro', 'traits', 'feature', 'fact'} or
                not all(isinstance(value, str) and 1 <= len(value.strip()) <= 400 for value in bio.values())):
            raise ValueError('Invalid character description: ' + key)
        for asset in (entry.get('image'), 'assets/stickers/' + entry['frame']['file'] if 'frame' in entry else None):
            if asset and (not asset.startswith('assets/') or '..' in Path(asset).parts or Path(asset).is_absolute()):
                raise ValueError('Invalid local image path: ' + key)
    return data


def generated(data):
    entries = [entry for entry in data['stickers'] if entry['enabled']]
    labels = {e['id']: [e['icon'], e['name'], e['rule']] for e in entries}
    frames = {e['id']: e['frame'] for e in entries if 'frame' in e}
    images = {e['id']: e['image'] for e in entries if 'image' in e}
    biographies = {e['id']: e['bio'] for e in entries if 'bio' in e}
    missions = {e['id']: e['mission'] for e in entries if e.get('mission') in ('russian', 'math', 'mixed')}
    groups = [dict(name=group['name'], keys=[e['id'] for e in entries if e['collection'] == group['id']]) for group in data['collections']]
    js = '\n'.join('const ' + name + ' = ' + json.dumps(value, ensure_ascii=False, indent=2) + ';' for name, value in (
        ('albumStickers', labels), ('stickerImagePaths', images), ('stickerBiographies', biographies), ('characterStickerFrames', frames),
        ('stickerMissionTypes', missions), ('stickerCollections', groups))) + '\n'
    prices = {e['id']: e['cost'] for e in entries if 'cost' in e}
    # Old tabs only understand their original sticker IDs.
    modern = [e['id'] for e in entries if e['id'] not in {'start','books','detective','rocket','coin','mushroom','star','koopa','mario'}]
    old_characters = {'chip','dale','darkwing'}
    future = [key for key in modern if key not in old_characters]
    py = ('REWARD_PRICES = ' + repr(prices) + '\nMISSION_REWARDS = ' + repr(tuple(missions)) + '\nMISSION_TYPES = ' + repr(missions) +
          '\nCHARACTER_STICKERS = ' + repr(tuple(modern)) + '\nCATALOG_ONLY_STICKERS = ' + repr(tuple(future)) + '\n')
    return [(ROOT/'players.js', '//', js), (ROOT/'tool/bunny-server.py', '#', py)]


def render_outputs(data):
    outputs = []
    for path, comment, content in generated(data):
        source = path.read_text()
        start_marker = comment + ' BEGIN GENERATED STICKER CATALOG\n'
        end_marker = comment + ' END GENERATED STICKER CATALOG'
        if source.count(start_marker) != 1 or source.count(end_marker) != 1:
            raise ValueError('Missing or duplicate generation markers in ' + str(path))
        start = source.index(start_marker) + len(start_marker)
        end = source.index(end_marker, start)
        outputs.append((path, source[:start] + content + source[end:]))
    return outputs


def write_atomic(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(content)
            stream.flush()
            temporary.chmod(0o644)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def verify_png(content):
    if not content.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Expected a PNG file')
    offset = 8
    dimensions = None
    has_data = False
    while offset + 12 <= len(content):
        size = struct.unpack('>I', content[offset:offset+4])[0]
        kind = content[offset+4:offset+8]
        end = offset + 8 + size
        payload = content[offset+8:end]
        if end + 4 > len(content) or zlib.crc32(kind + payload) & 0xffffffff != struct.unpack('>I', content[end:end+4])[0]:
            raise ValueError('Truncated PNG or invalid checksum')
        if kind == b'IHDR':
            if dimensions is not None or size != 13:
                raise ValueError('Invalid PNG header')
            dimensions = struct.unpack('>II', payload[:8])
            if not all(1 <= value <= 4096 for value in dimensions):
                raise ValueError('Image must be between 1 and 4096 pixels on each side')
        if kind == b'IDAT':
            has_data = True
        if kind == b'IEND':
            if not dimensions or not has_data or size:
                raise ValueError('Incomplete PNG')
            return dimensions
        offset = end + 4
    raise ValueError('PNG end marker is missing')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    actions.add_parser('build', help='Regenerate client and server from the catalog')
    actions.add_parser('check', help='Check generated definitions without changing files')
    actions.add_parser('pending', help='List characters whose art still needs to be imported')
    add = actions.add_parser('import', help='Import a character image and enable its rewards')
    add.add_argument('id')
    add.add_argument('image', type=Path)
    add.add_argument('--source', required=True, help='Source page for this image')
    options = parser.parse_args()
    data = read_catalog()
    if options.action == 'pending':
        for e in data['stickers']:
            if not e['enabled']:
                print(e['id'] + ' — ' + e['name'])
        return
    image = None
    if options.action == 'import':
        entry = next((e for e in data['stickers'] if e['id'] == options.id), None)
        if entry is None:
            parser.error('Add the character to sticker-catalog.json first')
        if entry['enabled']:
            parser.error('This sticker is already enabled. Edit its catalog record to replace art explicitly.')
        image = options.image.read_bytes()
        verify_png(image)
        if not options.source.startswith('https://'):
            parser.error('Provide an HTTPS source page')
        target = ROOT / entry['image']
        if target.exists():
            parser.error('Target image already exists: ' + str(target))
        entry.update(enabled=True, source=options.source)
    outputs = render_outputs(data)
    if options.action == 'check':
        stale = [str(path.relative_to(ROOT)) for path, content in outputs if path.read_text() != content]
        if stale:
            raise SystemExit('Regenerate: ' + ', '.join(stale))
        print('PASS catalog, generated client/server definitions and reward IDs')
        return
    # Validate and render everything before starting a recoverable local transaction.
    writes = [(path, content.encode()) for path, content in outputs]
    if image is not None:
        writes = [(target, image), (CATALOG, (json.dumps(data, ensure_ascii=False, indent=2)+'\n').encode()), *writes]
    previous = {path: path.read_bytes() if path.exists() else None for path, _ in writes}
    try:
        for path, content in writes:
            path.parent.mkdir(parents=True, exist_ok=True)
            write_atomic(path, content)
    except BaseException:
        for path, content in reversed(list(previous.items())):
            if content is None:
                path.unlink(missing_ok=True)
            else:
                write_atomic(path, content)
        raise
    print('Updated catalog definitions. Enabled stickers:', sum(e['enabled'] for e in data['stickers']))


if __name__ == '__main__':
    main()
