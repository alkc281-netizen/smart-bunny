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
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: site});
  await until(() => evaluate("typeof authConfigured !== 'undefined' && playerApiReady"));
  const code = fs.readFileSync(database.replace('.sqlite', '.setup-code'), 'utf8').trim();
  await evaluate(`apiRequest('auth/setup', ${JSON.stringify({code,player:'album-test',login:'parent',password:'Parent-test-123'})}).then(loadPlayerSession)`);
  const ready = expression => until(() => evaluate(expression));
  const saved = () => ready('!writingPlayer&&playerOutbox.length===0');
  await ready("!document.querySelector('#mario-admin-play').hidden");
  await evaluate(`apiRequest('auth/accounts',{name:'Ребёнок',avatar:'🌸',login:'child',password:'Child-test-123'})`);
  // Observe genuine JSNES instances without adding production test hooks.
  await evaluate(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='assets/emulation/jsnes-2.1.0.min.js';script.onload=resolve;script.onerror=reject;document.head.append(script)}).then(()=>{const library=window.jsnes;window.testNES=[];window.jsnes={...library,NES:function(options){const nes=new library.NES(options);testNES.push(nes);return nes;}};})`);
  const position = selector => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}})()`);
  const click = async selector => {
    const point=await position(selector);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
  };
  await click('#mario-admin-play');await ready("phase==='player-mario'&&document.querySelector('#manual-start')");
  await click('#manual-start');await ready('window.bunnyMario.isPlaying()');
  assert.ok((await evaluate("$('manual-clock').textContent")).includes('без ограничения'));
  await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await delay(100);
  const controls = await Promise.all(['.manual-dpad [data-mask="1"]','.manual-action-pad [data-mask="64"]','.manual-action-pad [data-mask="128"]'].map(position));
  const touch=(type,points=[])=>send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const points=controls.map((point,index)=>({...point,id:index+1}));
  const image=await evaluate("$('manual-picture').toDataURL()");
  for(let i=1;i<=3;i++)await touch('touchStart',points.slice(0,i));
  await delay(220);
  const held=await evaluate(`(()=>{const nes=testNES.at(-1),state=nes.controllers[1].state;return ['RIGHT','B','A'].map(key=>state[jsnes.Controller['BUTTON_'+key]]&1)})()`);
  assert.deepEqual(held,[1,1,1],'Movement, run and jump must be held together');
  assert.notEqual(await evaluate("$('manual-picture').toDataURL()"),image,'NES must actually render moving gameplay');
  await touch('touchCancel');await delay(100);
  assert.deepEqual(await evaluate(`(()=>{const state=testNES.at(-1).controllers[1].state;return ['RIGHT','B','A'].map(key=>state[jsnes.Controller['BUTTON_'+key]]&1)})()`),[0,0,0]);
  const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/bunny-manual-mario.png',Buffer.from(screenshot.data,'base64'));
  await evaluate("$('manual-pause').click()");assert.equal(await evaluate('bunnyMario.isPlaying()'),false);
  const paused=await evaluate("$('manual-picture').toDataURL()");await delay(180);assert.equal(await evaluate("$('manual-picture').toDataURL()"),paused);
  await evaluate("$('manual-pause').click()");await ready('bunnyMario.isPlaying()');
  for(const width of [320,390,568,820,844]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:width===844?390:width===568?320:1180,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Overflow at '+width);
  }
  // Switching to the child stops the parent and hides the unrestricted menu entry.
  await evaluate(`apiRequest('auth/login',{login:'child',password:'Child-test-123'}).then(loadPlayerSession)`);
  await ready("activePlayer?.name==='Ребёнок'&&phase==='menu'");
  assert.equal(await evaluate('bunnyMario.isPlaying()'),false);
  assert.equal(await evaluate("$('app').classList.contains('manual-playing')"),false);
  await delay(100);assert.equal(await evaluate("$('mario-admin-play').hidden"),true);
  assert.equal(await evaluate("$('mario-earned-play').hidden"),true);
  await evaluate("parentSession=true;$('mario-admin-play').click()");await delay(250);
  assert.equal(await evaluate('phase'),'menu','A forged client admin flag cannot unlock play');
  await evaluate('loadPlayerSession()');
  // Complete a real ten-question round through the existing game integration.
  await evaluate('window.realWait=wait;wait=(ms,fn)=>queueMicrotask(fn);begin("compare",10)');
  for(let i=0;i<10;i++){
    await ready("phase==='answer'");await evaluate('choose(answer)');
  }
  await ready("phase==='finished'");await saved();await evaluate('wait=realWait');
  await ready("!$('round-mario').hidden");
  const before = await evaluate('JSON.stringify(activePlayer.stickers)');
  const earned=await evaluate("apiRequest('mario')");assert.equal(earned.tickets,1);assert.equal(earned.admin,false);
  await evaluate("$('round-mario').click()");await ready("phase==='player-mario'&&Boolean($('manual-start'))");
  await click('#manual-start');await ready('bunnyMario.isPlaying()');
  const grant=await evaluate("apiRequest('mario')");assert.equal(grant.tickets,0);assert.ok(grant.remaining>590&&grant.remaining<=600);
  assert.equal(await evaluate("$('mario-admin-play').hidden"),true);
  // All three existing real NES start levels remain usable within the same grant.
  for(const level of [1,2,0]){
    await evaluate(`document.querySelector('.manual-toolbar select').value='${level}';document.querySelector('.manual-toolbar select').onchange()`);
    await ready("bunnyMario.isPlaying()&&!document.querySelector('.manual-toolbar select').disabled");
    assert.equal((await evaluate("apiRequest('mario')")).expires,grant.expires);
  }
  await evaluate("$('manual-pause').click()");await delay(250);
  const checkpointExists=await evaluate(`new Promise(resolve=>{const request=indexedDB.open('bunny-mario-saves',1);request.onsuccess=()=>{const db=request.result,op=db.transaction('states').objectStore('states').get(activePlayer.id+':0');op.onsuccess=()=>{db.close();resolve(Boolean(op.result?.state));};};request.onerror=()=>resolve(false);})`);
  assert.ok(checkpointExists,'NES checkpoint must be stored locally under the child profile');
  await send('Page.reload');await ready("typeof activePlayer!=='undefined'&&activePlayer?.name==='Ребёнок'");
  await ready("!$('mario-earned-play').hidden");
  assert.equal(await evaluate('JSON.stringify(activePlayer.stickers)'),before);
  await evaluate("$('mario-earned-play').click()");await ready("phase==='player-mario'");await click('#manual-start');await ready('bunnyMario.isPlaying()');
  assert.equal((await evaluate("apiRequest('mario')")).expires,grant.expires,'Reload must not extend ten minutes');
  // Connectivity failure stops gameplay; reconnect requires a server check.
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await ready('!bunnyMario.isPlaying()');
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate("$('manual-pause').click()");await ready('bunnyMario.isPlaying()');
  const childId=await evaluate('activePlayer.id');
  const expire=spawnSync('python3',['-c',`import sqlite3,sys,time\nwith sqlite3.connect(sys.argv[1]) as db: db.execute('UPDATE mario_sessions SET expires=? WHERE player=?',(time.time()-1,sys.argv[2]))`,database,childId],{encoding:'utf8'});
  assert.equal(expire.status,0,expire.stderr);
  await ready("!bunnyMario.isPlaying()&&$('manual-clock').textContent==='Время закончилось'");
  const ended=await evaluate("$('manual-picture').toDataURL()");await delay(200);assert.equal(await evaluate("$('manual-picture').toDataURL()"),ended);
  assert.equal(await evaluate('JSON.stringify(activePlayer.stickers)'),before);
  await ready("$('manual-start').textContent.includes('К заданиям')");await evaluate("$('manual-start').click()");assert.equal(await evaluate('phase'),'menu');
  console.log('PASS real Mario: parent-only free entry, child earned after 10 answers, real NES frame output, simultaneous three-touch run/jump, input cancellation, pause/resume, all 3 levels, 390/820/844px, local checkpoints, reload without extended time, offline stop, server expiry and unchanged rewards');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{ws?.close();chrome?.kill();backend?.kill();});
