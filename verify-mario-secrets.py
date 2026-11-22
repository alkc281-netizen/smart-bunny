"""Discovery preferences merge across devices without touching learning rewards."""
import copy
import importlib.util
import json
import sqlite3
import tempfile
from pathlib import Path

root = Path(__file__).parent
spec = importlib.util.spec_from_file_location('bunny', root/'tool/bunny-server.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
with tempfile.TemporaryDirectory() as directory:
    database = Path(directory)/'test.sqlite'
    b.initialize_database(database)
    with sqlite3.connect(database) as db:
        profile = b.initial_profile()
        other = b.initial_profile()
        before = copy.deepcopy(profile)
        def update(ids):
            b.BunnyHandler.update(db, 'one', profile, dict(kind='preference', key='bunny-mario-discoveries', value=json.dumps(ids)))
        update(['oneup11'])
        update(['coins11'])
        update([])
        assert set(json.loads(profile['preferences']['bunny-mario-discoveries'])) == {'oneup11', 'coins11'}
        assert not other['preferences']
        for ids in [None, {}, ['unknown'], [True], [['oneup11']], ['oneup11']*6]:
            previous = copy.deepcopy(profile)
            try:
                update(ids)
            except ValueError:
                pass
            else:
                raise AssertionError(ids)
            assert profile == previous
        profile['preferences'] = {}
        assert profile == before, 'Rewards, coins, earned game time and album layout do not change'
        assert db.execute('SELECT count(*) FROM mario_tickets').fetchone()[0] == 0
print('PASS discovery validation, monotonic device merge, player isolation; rewards/progress/album/tickets unchanged')
