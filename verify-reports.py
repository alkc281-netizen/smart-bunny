"""Private reporting through real HTTP, isolated DB and deterministic timestamps."""
import copy
import http.cookiejar
import importlib.util
import json
import sqlite3
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from functools import partial
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('bunny', ROOT/'tool/bunny-server.py')
b = importlib.util.module_from_spec(spec);spec.loader.exec_module(b)


class Quiet(b.BunnyHandler):
    def log_message(self, *_args):pass


with tempfile.TemporaryDirectory() as directory:
    database = Path(directory)/'progress.sqlite';b.initialize_database(database)
    server = b.ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, database=database, directory=ROOT, allowed_hosts=set()))
    server.RequestHandlerClass.keywords['allowed_hosts'] = {f'127.0.0.1:{server.server_port}'}
    threading.Thread(target=server.serve_forever, daemon=True).start()
    clients = [urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())) for _ in range(4)]
    parent, child, other, anonymous = clients

    def request(client, path, data=None):
        req = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/'+path,
                                     None if data is None else json.dumps(data).encode(), {'Content-Type':'application/json'})
        try:response = client.open(req)
        except urllib.error.HTTPError as error:response = error
        with response:return response.status, json.loads(response.read())

    try:
        code = database.with_suffix('.setup-code').read_text().strip()
        assert request(parent,'auth/setup',dict(code=code,name='Parent',avatar='⭐',login='parent',password='Parent-test-123'))[0] == 200
        for name in ['Julia', 'Sonya']:
            assert request(parent,'auth/accounts',dict(name=name,avatar='🐰',login=name.lower(),password='Child-test-123'))[0] == 200
        children = request(parent,'players')[1]
        julia = next(p['id'] for p in children if p['name']=='Julia')
        sonya = next(p['id'] for p in children if p['name']=='Sonya')
        for client, login in [(child,'julia'),(other,'sonya')]:assert request(client,'auth/login',dict(login=login,password='Child-test-123'))[0] == 200
        assert request(anonymous,'reports')[0] == 401
        assert request(child,'reports?player='+sonya)[0] == 403
        assert request(child,'reports?player='+julia)[0] == 403
        assert request(parent,'reports',{})[0] == 405
        assert request(parent,'reports?player=unknown')[0] == 404
        assert request(parent,'reports?days=999')[0] == 400
        assert request(parent,'reports?month=2026-99')[0] == 400
        assert request(anonymous,'activity',dict(player=julia))[0] == 401
        assert request(child,'activity',dict(player=sonya))[0] == 403
        before = request(child,'players/'+julia)[1]
        now = time.time();start = now-60

        def segment(a, z, kind='study', subject='math'):
            return dict(id=str(uuid4()),start=a,end=z,kind=kind,subject=subject)

        # Two concurrent devices: 30 study + 10 Mario + 10 other + 5 paused = 50 active.
        segments = [segment(start,start+30),segment(start+10,start+40,'mario',''),
                    segment(start+20,start+50,'other',''),segment(start+50,start+55,'pause','')]
        session = str(uuid4())
        answers = [dict(session=session,question=i,attempt=1,at=start+i,topic='chk',correct=i<7) for i in range(10)]
        answers += [dict(session=session,question=7,attempt=2,at=start+35,topic='chk',correct=True)]
        payload = dict(player=julia,segments=segments,answers=answers)
        assert request(child,'activity',payload)[0] == 200
        assert request(child,'activity',payload)[0] == 200
        assert request(other,'activity',dict(payload,player=sonya,segments=[],answers=[]))[0] == 200
        data = request(parent,'reports?player='+julia)[1]
        report = data['report'];summary = report['summary']
        assert (summary['study'],summary['mario'],summary['other'],summary['pause'],summary['total']) == (30,10,10,5,50), summary
        assert (summary['questions'],summary['correct'],summary['corrected']) == (10,7,1)
        assert report['topics'][0]['accuracy'] == 70
        assert request(parent,'reports?player='+sonya)[1]['report']['summary']['total'] == 0
        assert request(child,'players/'+julia)[1] == before,'Telemetry must not alter school progress, rewards or album positions'
        assert request(child,'mario')[1]['tickets'] == 0
        # A partial batch rolls back completely if any item fails validation.
        bad = dict(payload,segments=[segment(now-10,now-5),segment(now-100,now-10)],answers=[])
        assert request(child,'activity',bad)[0] == 400
        assert request(parent,'reports?player='+julia)[1]['report']['summary']['total'] == 50
        for change in [dict(at=now+100),dict(at=now-8*86400),dict(topic='unknown'),dict(question=-1),dict(question=100),dict(attempt=True),dict(correct='yes')]:
            assert request(child,'activity',dict(player=julia,answers=[dict(answers[0],**change)]))[0] == 400
        event = dict(kind='round',id=str(uuid4()),score=7,total=10,topics=['chk'],review=False,corrected=1,studySession=session,completedAt=start+40)
        assert request(child,'players/'+julia,event)[0] == 200
        assert request(child,'players/'+julia,event)[0] == 200
        report = request(parent,'reports?player='+julia)[1]['report']
        assert (report['summary']['questions'],report['summary']['rounds'],report['summary']['corrected']) == (10,1,1),'Round and answer feeds must not double count'
        assert len(report['rounds']) == 1 and report['rounds'][0]['score'] == 7
        # A completed round with no answer feed still has usable totals.
        event2 = dict(event,id=str(uuid4()),studySession=str(uuid4()))
        assert request(child,'players/'+julia,event2)[0] == 200
        assert request(parent,'reports?player='+julia)[1]['report']['summary']['questions'] == 20
        # Deliver its answers late: the fallback is replaced, never added twice.
        late = [dict(a,session=event2['studySession']) for a in answers]
        assert request(child,'activity',dict(player=julia,answers=late))[0] == 200
        report = request(parent,'reports?player='+julia)[1]['report']
        assert (report['summary']['questions'],report['summary']['correct'],report['summary']['corrected']) == (20,14,2)
        b.initialize_database(database)
        assert request(parent,'reports?player='+julia)[1]['report']['summary'] == report['summary'],'Restart preserves reports'
        # Deterministic Moscow midnight, earlier comparison week, and topic improvement.
        midday = datetime(2026,11,24,12,tzinfo=b.REPORT_TZ).timestamp()
        midnight = datetime(2026,11,24,tzinfo=b.REPORT_TZ).timestamp()
        with sqlite3.connect(database) as db:
            for key,a,z in [('a',midnight-10,midnight+10),('b',midnight-5,midnight+5)]:
                db.execute('INSERT INTO activity_segments VALUES (?,?,?,?,?,?)',('clock',key,a,z,'study','russian'))
            for week, correct in [(0,True),(8,False)]:
                s = str(uuid4())
                for i in range(5):db.execute('INSERT INTO activity_answers VALUES (?,?,?,?,?,?,?,?,?)',('clock',s,i,1,midday-week*86400-100-i,'chk','russian',2,correct))
            db.execute('INSERT INTO players VALUES (?,?,?,?)',('clock','Clock','🐰',json.dumps(b.initial_profile())))
            result = b.build_activity_report(db,'clock',7,'2026-11',midday)
            dates = {r['date']:r for r in result['days']}
            assert dates['2026-11-23']['study'] == 10 and dates['2026-11-24']['study'] == 10
            assert result['week']['questions'] == 5 and result['lastWeek']['questions'] == 5
            assert result['topics'][0]['change'] == 100
            assert result['week']['accuracy'] == 100 and result['lastWeek']['accuracy'] == 0
        assert request(parent,'auth/logout',{})[0] == 200
        assert request(parent,'reports?player='+julia)[0] == 401
        print('PASS reports: parent-only access, child isolation, overlapping devices, midnight/Moscow, idle-free intervals, retries, per-answer corrections, partial rounds, late delivery without double counts, comparisons, lifetime progress unchanged, restart and logout')
    finally:server.shutdown();server.server_close()
