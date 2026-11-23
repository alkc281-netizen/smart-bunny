"""Reward boundaries and real SQLite retries, without touching the live database."""
import copy
import importlib.util
import json
import sqlite3
import tempfile
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('bunny', ROOT/'tool/bunny-server.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def profile(junior=True):
    p = b.initial_profile()
    p.update(schoolClasses=[1, 2] if junior else [3, 4], topics=['zhi','cha'] if junior else ['meaning3'],
             stickers={'mario': {'x': 12, 'y': 34, 'boardX': 345, 'boardY': 678}}, coins=40)
    if junior:
        p['stickerPolicy'] = 'junior-v1'
        p['preferences']['bunny-russian-studied-2'] = '["chk","soft"]'
    return p


def event(key, score, corrected=0, topics=None, count=10, grade=1):
    return dict(kind='round', id=str(uuid4()), mission=key, score=score, corrected=corrected,
                total=count, topics=topics or ['compare','add'], review=False,
                rewardVersion=2, missionClass=grade)


for score, corrected, expected in [(6,0,False), (6,1,True), (7,0,True), (0,7,True)]:
    p=profile();b.apply_round(p,event('koopa',score,corrected))
    assert ('koopa' in p['stickers']) == expected
    assert p['correct'] == score, 'Corrections must not inflate academic points'
for score, corrected, expected in [(15,5,False),(16,0,True)]:
    p=profile(False);b.apply_round(p,event('koopa',score,corrected,count=20))
    assert ('koopa' in p['stickers']) == expected

p=profile();old=copy.deepcopy(p['stickers'])
b.apply_round(p,event('monty',6,1,['compare']))
assert p['stickerStages']['monty']==['compare'] and 'monty' not in p['stickers']
p=json.loads(json.dumps(p))  # Persistence/reload, not just a local counter.
b.apply_round(p,event('monty',10,0,['compare']))
assert p['stickerStages']['monty']==['compare']
b.apply_round(p,event('monty',6,0,['add']))
assert p['stickerStages']['monty']==['compare']
b.apply_round(p,event('monty',7,0,['add']))
assert p['stickerStages']['monty']==['compare','add'] and 'monty' in p['stickers']
assert p['stickers']['mario']==old['mario']

for junior,key,count,required,grade,topics in [
    (True,'darkwing',10,8,1,['add','zhi']),
    (False,'darkwing',30,27,3,['add','meaning3']),
]:
    for good in (False,True):
        p=profile(junior)
        b.apply_round(p,event(key,required-1,1 if good and junior else 0,topics,count,grade)
                      if junior else event(key,required if good else required-1,0,topics,count,grade))
        assert (key in p['stickers'])==good

# Unstudied, wrong-class, fake grade, old tab, wrong length and same-subject mixed attempts do not qualify.
for change in [dict(topics=['add','verb4'],missionClass=4),dict(topics=['add','chk'],missionClass=1),
               dict(topics=['add','zhi'],missionClass=True),dict(rewardVersion=1),
               dict(topics=['add']),dict(topics=['add','nouncases4'],missionClass=2)]:
    p=profile();e=event('darkwing',10,topics=['add','zhi']);e.update(change);b.apply_round(p,e)
    assert 'darkwing' not in p['stickers'],change
p=profile(False);b.apply_round(p,event('koopa',10));assert 'koopa' not in p['stickers']

with tempfile.TemporaryDirectory(prefix='bunny-achievements-') as directory:
    database=Path(directory)/'progress.sqlite';b.initialize_database(database)
    p=profile()
    with sqlite3.connect(database) as db:
        # Duplicate event via the real server update code grants one stage/ticket/result.
        e=event('monty',7,topics=['compare'])
        b.BunnyHandler.update(db,'julia',p,e);b.BunnyHandler.update(db,'julia',p,e)
        assert p['rounds']==1 and p['stickerStages']['monty']==['compare']
        assert db.execute('select count(*) from mario_tickets').fetchone()[0]==0
        before=copy.deepcopy(p)
        b.BunnyHandler.update(db,'julia',p,dict(kind='redeem',sticker='darkwing'))
        assert p==before,'Old exchange cannot grant or debit'
        for _ in range(2):
            b.BunnyHandler.update(db,'julia',p,dict(kind='album-decoration',decoration='space'))
        assert p['coins']==30 and p['albumDecorations']==['space']
        assert p['stickers']==before['stickers']
        b.BunnyHandler.update(db,'julia',p,dict(kind='album-decoration',decoration='default'))
        b.BunnyHandler.update(db,'julia',p,dict(kind='album-decoration',decoration='space'))
        assert p['coins']==30 and p['albumDecoration']=='space'
        p['coins']=0
        b.BunnyHandler.update(db,'julia',p,dict(kind='album-decoration',decoration='stars'))
        assert 'stars' not in p['albumDecorations'] and p['coins']==0
    other=profile(False)
    assert 'stickerStages' not in other and 'albumDecoration' not in other

# Every enabled/pending catalog type keeps matching generated definitions.
catalog=json.loads((ROOT/'sticker-catalog.json').read_text())
for e in catalog['stickers']:
    if e['enabled'] and e.get('mission') in ('math','russian','mixed'):
        assert b.MISSION_TYPES[e['id']]==e['mission']
        rule=b.mission_condition(profile(),e['id'])
        assert rule['count']==10 and rule['countCorrections']

print('PASS rewards: junior/standard boundaries, corrections vs academic points, persistent distinct stages, class/studied restrictions, old tabs, retry deduplication, no coin redemption, one-time cosmetics, preserved positions and profile isolation')
