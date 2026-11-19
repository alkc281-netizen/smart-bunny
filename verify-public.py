"""Test HTTPS proxy mode against the same SQLite database as the LAN listener."""
import importlib.util,json,sqlite3,tempfile,threading,urllib.request,urllib.error
from pathlib import Path
from functools import partial
from uuid import uuid4
spec=importlib.util.spec_from_file_location('bunny',Path(__file__).parent/'tool/bunny-server.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class Quiet(b.BunnyHandler):
 def log_message(self,*_args):pass
origin='https://bunny.example'
for bad in ['http://bunny.example','https://user:pass@bunny.example','https://bunny.example/path','https://bunny.example?x=1','https://bunny.example:8443','https://bunny.example/#x']:
 try:b.public_origin(bad)
 except ValueError:pass
 else:raise AssertionError(bad)
assert b.public_origin('https://BUNNY.example:443/')==origin
with tempfile.TemporaryDirectory(prefix='bunny-public-') as tmp:
 root=Path(tmp);web=root/'web';web.mkdir();(web/'assets').mkdir()
 (web/'assets/private.wav').write_bytes(b'private-test-wav');(web/'assets/rom.nes').write_bytes(b'private-test-rom')
 (web/'index.html').write_text('test-app');(web/'app.js').write_text('test-js');(web/'tool').mkdir();(web/'tool/secret.txt').write_text('hidden')
 (root/'outside.txt').write_text('outside');(web/'assets/leak.wav').symlink_to(root/'outside.txt')
 database=root/'progress.sqlite';b.initialize_database(database)
 for pid,name in [('parent','Parent'),('child','Child')]:
  with sqlite3.connect(database) as db:db.execute('INSERT INTO players VALUES (?,?,?,?)',(pid,name,'🐰',json.dumps(b.initial_profile())))
 lan=b.ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,database=database,directory=web,allowed_hosts=set()))
 lan.RequestHandlerClass.keywords['allowed_hosts']={'127.0.0.1:'+str(lan.server_port)}
 public=b.ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,database=database,directory=web,allowed_hosts={'bunny.example'},external_origin=origin))
 for server in [lan,public]:threading.Thread(target=server.serve_forever,daemon=True).start()
 def request(server,path,data=None,cookie=None,headers=None,method=None):
  hdr={'Content-Type':'application/json',**({'Host':'bunny.example','Origin':origin} if server is public else {}),**(headers or {})}
  if cookie:hdr['Cookie']=cookie
  req=urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+path,None if data is None else json.dumps(data).encode(),hdr,method=method)
  try:r=urllib.request.urlopen(req)
  except urllib.error.HTTPError as e:r=e
  with r:
   body=r.read();return r.status,json.loads(body) if r.headers.get_content_type()=='application/json' else body,r.headers
 def cookie(headers):return headers['Set-Cookie'].split(';',1)[0]
 try:
  code=database.with_suffix('.setup-code').read_text().strip()
  assert request(public,'/api/auth/setup',dict(code=code,player='parent',login='parent',password='Parent-test-123'))[0]==403
  status,_,headers=request(lan,'/api/auth/setup',dict(code=code,player='parent',login='parent',password='Parent-test-123'));assert status==200
  lan_cookie=cookie(headers)
  assert request(lan,'/api/auth/accounts',dict(player='child',login='child',password='Child-test-123'),lan_cookie)[0]==200
  assert request(public,'/api/players')[1]==[]
  assert request(public,'/')[0]==200 and request(public,'/app.js')[0]==200
  for method in ['GET','HEAD']:
   assert request(public,'/assets/private.wav',method=method)[0]==401
  for path in ['/tool/secret.txt','/.git/config','/assets/../tool/secret.txt','/assets/%2e%2e/tool/secret.txt','/assets/leak.wav']:
   assert request(public,path)[0]==404,path
  assert request(public,'/api/auth/status',headers={'Host':'127.0.0.1:'+str(public.server_port)})[0]==403
  assert request(public,'/api/auth/login',dict(login='child',password='Child-test-123'),headers={'Origin':'https://evil.example'})[0]==403
  assert request(public,'/api/auth/login',dict(login='child',password='Child-test-123'),headers={'Origin':'http://bunny.example'})[0]==403
  status,_,headers=request(public,'/api/auth/login',dict(login='child',password='Child-test-123'));assert status==200
  assert 'Secure' in headers['Set-Cookie'] and 'HttpOnly' in headers['Set-Cookie'] and 'SameSite=Strict' in headers['Set-Cookie']
  public_cookie=cookie(headers)
  assert request(public,'/assets/private.wav',cookie=public_cookie)[1]==b'private-test-wav'
  assert 'no-store' in request(public,'/assets/rom.nes',cookie=public_cookie)[2]['Cache-Control']
  assert request(public,'/api/players/parent',cookie=public_cookie)[0]==403
  assert request(public,'/api/auth/accounts',dict(name='Other',avatar='🦊',login='other',password='Other-test-123'),public_cookie)[0]==403
  event=dict(kind='round',id=str(uuid4()),score=9,total=10,topics=['compare'],review=False)
  assert request(public,'/api/players/child',event,public_cookie)[1]['rounds']==1
  # Retrying the very same result through the LAN cannot add a second round or ticket.
  child_lan=cookie(request(lan,'/api/auth/login',dict(login='child',password='Child-test-123'))[2])
  result=request(lan,'/api/players/child',event,child_lan)[1];assert result['rounds']==1 and result['coins']==1
  assert request(public,'/api/mario',cookie=public_cookie)[1]['tickets']==1
  point=dict(kind='sticker',sticker='start',x=25,y=35,boardX=500,boardY=700)
  assert request(lan,'/api/players/child',point,child_lan)[0]==200
  assert request(public,'/api/players/child',cookie=public_cookie)[1]['stickers']['start']['boardX']==500
  status,_,headers=request(public,'/api/auth/logout',{},public_cookie);assert status==200 and 'Secure' in headers['Set-Cookie']
  assert request(public,'/assets/private.wav',cookie=public_cookie)[0]==401
  assert request(public,'/api/players/child',cookie=public_cookie)[0]==401
  assert request(lan,'/api/players/child',cookie=child_lan)[0]==200,'Logging out a different device must not revoke the LAN session'
  print('PASS public HTTPS: shared progress/stickers/round deduplication and Mario quota across LAN/public, private assets require login, Secure HttpOnly cookie, host/origin checks, child isolation, path/symlink protection, logout and unchanged LAN sessions')
 finally:
  for server in [lan,public]:server.shutdown();server.server_close()
