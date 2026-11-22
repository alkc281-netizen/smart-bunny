"""Server preference isolation and one-time round/award/completion receipts."""
import copy
import importlib.util
import sqlite3
import tempfile
from pathlib import Path
from uuid import uuid4
p=Path(__file__).parent
s=importlib.util.spec_from_file_location('bunny',p/'tool/bunny-server.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
with tempfile.TemporaryDirectory() as t:
 database=Path(t)/'test.sqlite';b.initialize_database(database)
 with sqlite3.connect(database) as db:
  db.execute('INSERT INTO players VALUES (?,?,?,?)',('one','Test','🐰','{}'))
  db.execute('INSERT INTO players VALUES (?,?,?,?)',('two','Test','🦊','{}'))
  one=b.initial_profile();two=b.initial_profile();old=copy.deepcopy(one['stickers'])
  for key,value in [('autoMusic','false'),('selectedMusic','9'),('musicVolume','0.25'),('taskVolume','0'),('fxVolume','1'),('enableMusic','true'),('enableVictory','false'),('mute','false')]:
   b.BunnyHandler.update(db,'one',one,dict(kind='preference',key='bunny-audio-'+key,value=value))
  assert not two['preferences'] and one['stickers']==old
  for key,value in [('selectedMusic','1.5'),('selectedMusic','10'),('selectedMusic','-1'),('musicVolume','nan'),('fxVolume','inf'),('taskVolume','-0.1'),('taskVolume','1.1'),('mute','yes'),('unknown','0')]:
   before=copy.deepcopy(one)
   try:b.BunnyHandler.update(db,'one',one,dict(kind='preference',key='bunny-audio-'+key,value=value))
   except ValueError:pass
   else:raise AssertionError((key,value))
   assert one==before
  group=b.COLLECTION_REWARDS[0];assert len(group['keys'])==30
  target=next(k for k in group['keys'] if b.MISSION_TYPES[k]=='math' and b.REWARD_PRICES[k]==7)
  one.update(schoolClasses=[1,2],stickerPolicy='junior-v1',stickers={k:None for k in group['keys'] if k!=target})
  # Keep legacy coordinates exactly as they were.
  one['stickers']['mario']={'x':12,'y':34,'boardX':345,'boardY':678};layout=copy.deepcopy(one['stickers']['mario'])
  e=dict(kind='round',id=str(uuid4()),mission=target,total=10,score=7,corrected=0,topics=['compare','add'],review=False,rewardVersion=2,missionClass=1)
  receipt=b.BunnyHandler.update(db,'one',one,e)
  assert receipt['kind']=='collection' and receipt['collections']==[dict(id=group['id'],name=group['name'])]
  assert one['stickers']['mario']==layout
  after=copy.deepcopy(one)
  assert b.BunnyHandler.update(db,'one',one,e) is None and one==after,'Duplicate does not emit another reward'
  assert db.execute('SELECT count(*) FROM mario_tickets').fetchone()[0]==1
  other=b.initial_profile();other.update(schoolClasses=[1,2],stickerPolicy='junior-v1')
  fresh=dict(e,id=str(uuid4()));assert b.BunnyHandler.update(db,'two',other,fresh)['kind']=='sticker'
  fresh=dict(e,id=str(uuid4()));assert b.BunnyHandler.update(db,'two',other,fresh)['kind']=='round'
  view=b.player_view('two','Test','🦊',other,True,True);assert 'audioEvent' not in view,'Reading a profile or album cannot emit audio'
print('PASS audio server: eight validated preferences; player isolation; 30-character completion; preserved layout; sticker/round priority; duplicate receipts/tickets; silent profile reads')
