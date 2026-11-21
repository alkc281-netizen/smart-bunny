"""Check all 90 classic characters and existing achievement policies without live data."""
import copy
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).parent
catalog=json.loads((ROOT/'sticker-catalog.json').read_text())
groups={'looney-tunes','tom-and-jerry','woody-woodpecker'}
main=[e for e in catalog['stickers'] if e['collection'] in groups]
extras=[]
assert len(main)==90 and len({e['id'] for e in main})==90
for group in groups:
 entries=[e for e in main if e['collection']==group]
 assert len(entries)==30 and len({e['character'] for e in entries})==30
 assert all(e['bio'] and set(e['bio'])=={'intro','traits','feature','fact'} for e in entries)

spec=importlib.util.spec_from_file_location('bunny',ROOT/'tool/bunny-server.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
for junior in (True,False):
 for e in main+extras:
  key=e['id'];p=b.initial_profile();p.update(schoolClasses=[1,2] if junior else [3,4],topics=['zhi','cha'] if junior else ['meaning3','roots3'],coins=40,stickers={'mario':{'x':12,'y':34,'boardX':345,'boardY':678}})
  if junior:p['stickerPolicy']='junior-v1'
  old=copy.deepcopy(p['stickers']);rule=b.mission_condition(p,key)
  assert rule['count']==(10 if junior else 30 if rule['tier']=='special' else 20)
  assert rule['required']==((8 if rule['tier']=='special' else 7) if junior else 27 if rule['tier']=='special' else 17 if rule['tier']=='rare' else 16)
  rus=['zhi','cha'] if junior else ['meaning3','roots3']
  def event(stage,score,corrected=0):
   topics=[['compare','add'][stage]] if rule['type']=='math' else [rus[stage]] if rule['type']=='russian' else ['add',rus[stage]]
   return dict(mission=key,total=rule['count'],score=score,corrected=corrected,topics=topics,review=False,rewardVersion=2,missionClass=1 if junior else 3)
  b.BunnyHandler.update(None,'test',p,dict(kind='redeem',sticker=key))
  assert p['coins']==40 and key not in p['stickers']
  b.apply_round(p,event(0,rule['required']-1))
  assert key not in p['stickers']
  for stage in range(rule['stages']):
   b.apply_round(p,event(stage,rule['required']-1,1) if junior else event(stage,rule['required']))
   if rule['stages']==2 and stage==0:
    assert key not in p['stickers'];b.apply_round(p,event(stage,rule['required']))
    assert len(p['stickerStages'][key])==1 and key not in p['stickers']
  assert key in p['stickers'] and p['stickers']['mario']==old['mario'] and p['coins']==40
  visible=b.player_view('test','Test','🐰',p,characters=True,catalog=True)
  assert key in visible['stickers'] and key in visible['rewards']['conditions']
  assert key not in b.player_view('test','Test','🐰',p,characters=True)['stickers']
print('PASS all 90 classic characters; 180 class-specific reward paths; no coin redemption; preserved sticker coordinates; catalog visibility')

# A second pose cannot be counted as another character, and incomplete sets cannot be enabled.
import tempfile
spec=importlib.util.spec_from_file_location('stickers',ROOT/'tool/stickers.py')
generator=importlib.util.module_from_spec(spec);spec.loader.exec_module(generator)
with tempfile.TemporaryDirectory() as temp:
 path=Path(temp)/'catalog.json';generator.CATALOG=path
 for kind in ('duplicate-character','incomplete-collection'):
  bad=copy.deepcopy(catalog);entries=[e for e in bad['stickers'] if e['collection']=='looney-tunes']
  if kind=='duplicate-character':entries[1]['character']=entries[0]['character']
  else:entries[-1]['enabled']=False
  path.write_text(json.dumps(bad))
  try:generator.read_catalog()
  except ValueError:pass
  else:raise AssertionError('Accepted '+kind)
print('PASS rejects duplicate identities and incomplete 30-character collections')
