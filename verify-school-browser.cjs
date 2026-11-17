// Real Chromium pointer/touch tests against an isolated temporary profile database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bunny-album-'));
let chrome, backend, ws;
async function until(fn) {
  for (let i = 0; i < 400; i++) { if (await fn()) return; await delay(50); }
  throw Error('Timed out: ' + fn);
}
(async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const database = path.join(directory, 'progress.sqlite');
  const seed = spawnSync('python3', ['-c', `
import importlib.util, json, sqlite3, sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('bunny',sys.argv[1])
bunny=importlib.util.module_from_spec(spec); spec.loader.exec_module(bunny)
database=Path(sys.argv[2]); bunny.initialize_database(database)
profile=bunny.initial_profile()
profile['schoolClasses']=[1,2]
profile.update(rounds=5,correct=40,coins=3,stickers={'start':{'x':25,'y':35},'books':{'x':70,'y':60},'coin':None})
with sqlite3.connect(database) as db:
 db.execute('INSERT INTO players VALUES (?,?,?,?)',('album-test','Тест альбома','🐰',json.dumps(profile)))
`, path.join(__dirname, 'tool/bunny-server.py'), database], {encoding: 'utf8'});
  assert.equal(seed.status, 0, seed.stderr);
  backend = spawn('python3', [path.join(__dirname, 'tool/bunny-server.py'), '--directory', __dirname,
    '--database', database, '--port', String(port)], {stdio: 'ignore'});
  const site = 'http://127.0.0.1:' + port + '/';
  await until(async () => { try { return (await fetch(site)).ok; } catch { return false; } });
  const browser = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  chrome = spawn(browser, ['--headless', '--remote-debugging-port=0', '--user-data-dir=' + path.join(directory, 'chrome'), 'about:blank'], {stdio: 'ignore'});
  chrome.on('error', error => { console.error(error.message); });
  let debugPort;
  await until(() => { try { debugPort = fs.readFileSync(path.join(directory, 'chrome/DevToolsActivePort'), 'utf8').split('\n')[0]; return debugPort; } catch { return false; } });
  const [tab] = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    const item = pending.get(m.id);
    if (!item) return;
    pending.delete(m.id);
    m.error ? item.reject(m.error) : item.resolve(m.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++serial, {resolve, reject}); ws.send(JSON.stringify({id: serial, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception.description);
    return result.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: site});
  await until(() => evaluate("typeof authConfigured !== 'undefined' && playerApiReady"));
  const code = fs.readFileSync(database.replace('.sqlite', '.setup-code'), 'utf8').trim();
  await evaluate(`apiRequest('auth/setup', ${JSON.stringify({code, player: 'album-test', login: 'album-test', password: 'Album-test-123'})}).then(loadPlayerSession)`);

  const errors=[];
  const prior=ws.onmessage;
  ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);prior(event)};
  await send('Runtime.enable');
  for(const [width,height] of [[390,844],[820,1180]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});
    await send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await evaluate("home();$('game-menu').children[0].click()");
    assert.equal(await evaluate('phase'),'math-modes');
    assert.equal(await evaluate("$('math-games').children.length"),7);
    await evaluate("$('math-games').children[3].click()");
    assert.equal(await evaluate('phase'),'math-length');
    await evaluate("$('math-back').click()");assert.equal(await evaluate('phase'),'math-modes');
    await evaluate("$('math-games').children[6].click()");assert.equal(await evaluate('phase'),'school-classes');
    assert.equal(await evaluate("$('school-menu').children[0].children[0].textContent"),'2 класс · часть 1');
    for(const subject of ['math','english','world']){
      await evaluate(`openSchoolClasses('${subject}');openSchoolTopics()`);
      assert.equal(await evaluate('schoolClass'),2);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await evaluate('openSettings();settingsBack()');
      assert.equal(await evaluate("$('school-menu').hidden"),false);
    }
    console.log('PASS subject navigation and no overflow',width,height);
  }
  await evaluate("openSchoolClasses('english');openSchoolStudied();$('school-menu').children[0].children[0].click();$('school-menu').children[0].children[1].click();openSchoolTopics()");
  await until(()=>evaluate('!writingPlayer'));
  assert.equal(await evaluate('schoolStudied.size'),2);
  await send('Page.reload');
  await until(()=>evaluate("typeof activePlayer!=='undefined' && activePlayer?.id==='album-test'"));
  await evaluate("openSchoolClasses('english');openSchoolTopics()");
  assert.equal(await evaluate('schoolStudied.size'),2,'studied selection persists');
  await evaluate('beginSchoolMixed()');
  await evaluate("choose('incorrect')");
  await delay(300);
  assert.equal(await evaluate('phase'),'feedback');
  assert.ok((await evaluate("$('russian-detail').textContent")).length>20);
  await evaluate("$('answers').children[0].click();choose(answer)");
  await until(()=>evaluate('round===1'));
  for(let i=1;i<10;i++){
    await until(()=>evaluate("phase==='answer'"));
    await evaluate('choose(answer)');
    await until(()=>evaluate(`round>${i}`));
  }
  await until(()=>evaluate("phase==='finished'&&!writingPlayer"));
  assert.equal(await evaluate('score'),9);
  assert.equal(await evaluate('schoolCorrected'),1);
  assert.equal(await evaluate('activePlayer.rounds'),6);
  assert.equal(await evaluate('activePlayer.coins'),4);
  assert.ok(await evaluate("activePlayer.topics.some(key=>key.startsWith('en2'))"));
  // Switch only the temporary fixture's assigned classes and verify the senior book list.
  const change=spawnSync('python3',['-c',`import sqlite3,json,sys
with sqlite3.connect(sys.argv[1]) as db:
 p=json.loads(db.execute("select progress from players where id='album-test'").fetchone()[0]);p['schoolClasses']=[3,4]
 db.execute("update players set progress=? where id='album-test'",(json.dumps(p),))`,database],{encoding:'utf8'});
  assert.equal(change.status,0,change.stderr);
  await send('Page.reload');
  await until(()=>evaluate("typeof activePlayer!=='undefined'&&activePlayer?.schoolClasses.includes(4)"));
  for(const subject of ['math','english','world']){
    await evaluate(`openSchoolClasses('${subject}')`);
    assert.equal(await evaluate('schoolClass'),4);
    assert.equal(await evaluate("$('school-menu').children[0].children[0].textContent"),'4 класс · часть 1');
  }
  await evaluate('home()');
  assert.deepEqual(errors,[]);
  const picture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync('/tmp/bunny-subjects-menu.png',Buffer.from(picture.data,'base64'));
  console.log('PASS actual browser loading, school-class isolation, persistent studied selection, retry, grade, server rewards and no JS exceptions');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{ws?.close();chrome?.kill();backend?.kill()});
