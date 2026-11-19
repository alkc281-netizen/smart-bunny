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
  await send('Runtime.enable');
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
  await evaluate(`window.nesAudio={buffers:0,peak:0};const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer&&this.buffer.sampleRate===44100&&this.buffer.duration<.04){nesAudio.buffers++;for(const v of this.buffer.getChannelData(0))nesAudio.peak=Math.max(nesAudio.peak,Math.abs(v));}return start.apply(this,args);};`);
  await click('#mario-admin-play');await ready("phase==='player-mario'&&bunnyMario.isPlaying()");
  await ready('testNES.at(-1).cpu.mem[0x0770]===0&&testNES.at(-1).cpu.mem[0x0772]===3');
  assert.equal(await evaluate("Boolean($('manual-settings')||$('manual-options'))"),false,'No custom menu');
  assert.equal(await evaluate('musicAllowed()'),false);
  await evaluate('startMusic()');assert.equal(await evaluate('musicNodes.length'),0,'Bunny soundtrack is forbidden in manual NES');
  assert.ok(await evaluate('testNES.at(-1).papu.stereoPosLTriangle>0'),'Original NES music channels stay enabled');
  assert.ok((await evaluate("$('manual-clock').textContent")).includes('без ограничения'));
  await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await delay(100);
  const touch=(type,points=[])=>send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const tap=async selector=>{const p=await position(selector);await touch('touchStart',[{...p,id:91}]);await touch('touchEnd');};
  await tap('#manual-select');await ready('testNES.at(-1).cpu.mem[0x077a]===1');
  await delay(450);await tap('#manual-select');await ready('testNES.at(-1).cpu.mem[0x077a]===0');
  await tap('#manual-pause');await ready('testNES.at(-1).cpu.mem[0x0770]===1&&testNES.at(-1).cpu.mem[0x0772]===3&&testNES.at(-1).cpu.mem[0x0e]===8');
  await evaluate('nesAudio.peak=0;nesAudio.buffers=0');await delay(250);
  assert.ok((await evaluate('nesAudio.peak'))>.01,'Original level music must produce audible PCM without any action');
  const controls = await Promise.all(['.manual-dpad [data-mask="1"]','.manual-action-pad [data-mask="64"]','.manual-action-pad [data-mask="128"]'].map(position));
  const points=controls.map((point,index)=>({...point,id:index+1}));
  const image=await evaluate("$('manual-picture').toDataURL()");
  for(let i=1;i<=3;i++)await touch('touchStart',points.slice(0,i));
  await delay(220);
  const held=await evaluate(`(()=>{const nes=testNES.at(-1),state=nes.controllers[1].state;return ['RIGHT','B','A'].map(key=>state[jsnes.Controller['BUTTON_'+key]]&1)})()`);
  assert.deepEqual(held,[1,1,1],'Movement, run and jump must be held together');
  assert.notEqual(await evaluate("$('manual-picture').toDataURL()"),image,'NES must actually render moving gameplay');
  await touch('touchCancel');await delay(100);
  assert.deepEqual(await evaluate(`(()=>{const state=testNES.at(-1).controllers[1].state;return ['RIGHT','B','A'].map(key=>state[jsnes.Controller['BUTTON_'+key]]&1)})()`),[0,0,0]);
  assert.ok((await evaluate('nesAudio.buffers'))>0,'Actual NES audio buffers must be scheduled');
  assert.ok((await evaluate('nesAudio.peak'))>.01,'A genuine jump/run gesture must produce audible NES samples');
  assert.equal(await evaluate('audioCtx.state'),'running');
  // A/B capture survives slipping a thumb outside the round key.
  await touch('touchStart',[points[2]]);
  await touch('touchMove',[{...points[2],x:points[2].x-40,y:points[2].y+10}]);await delay(60);
  assert.equal(await evaluate('testNES.at(-1).controllers[1].state[jsnes.Controller.BUTTON_A]&1'),1);
  await touch('touchEnd');await delay(60);
  assert.equal(await evaluate('testNES.at(-1).controllers[1].state[jsnes.Controller.BUTTON_A]&1'),0);
  // A sub-frame tap still reaches one emulated frame, then releases normally.
  await evaluate(`window.buttonEdges=[];const nes=testNES.at(-1),down=nes.buttonDown,up=nes.buttonUp;nes.buttonDown=function(p,b){buttonEdges.push(['down',b,p]);return down.call(this,p,b);};nes.buttonUp=function(p,b){buttonEdges.push(['up',b,p]);return up.call(this,p,b);};const b=document.querySelector('.manual-action-pad [data-mask="128"]'),parent=b.closest('.mario-touch-controls');b.setPointerCapture=()=>{};const e={target:b,button:0,pointerId:999,preventDefault(){}};parent.onpointerdown(e);parent.onpointerup({...e,type:'pointerup'});`);
  await delay(100);
  assert.deepEqual(await evaluate(`buttonEdges.filter(e=>e[1]===jsnes.Controller.BUTTON_A&&e[2]===1).map(e=>e[0])`),['down','up']);
  // Restoring a suspended context is triggered by a real control gesture.
  await evaluate('audioCtx.suspend()');assert.equal(await evaluate('audioCtx.state'),'suspended');
  await touch('touchStart',[points[0]]);await ready("audioCtx.state==='running'");await touch('touchEnd');
  assert.equal(await evaluate("getComputedStyle($('app')).webkitUserSelect"),'none');
  const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/bunny-manual-mario.png',Buffer.from(screenshot.data,'base64'));
  await tap('#manual-pause');await ready('Boolean(testNES.at(-1).cpu.mem[0x0776]&1)');
  assert.equal(await evaluate('bunnyMario.isPlaying()'),true,'Native pause leaves emulator running to process START');
  const paused=await evaluate("$('manual-picture').toDataURL()");await delay(180);assert.equal(await evaluate("$('manual-picture').toDataURL()"),paused);
  await delay(800);await tap('#manual-pause');await ready('!(testNES.at(-1).cpu.mem[0x0776]&1)');
  assert.equal(await evaluate('musicNodes.length'),0);
  assert.equal(await evaluate('players.size'),0,'No Bunny click effects in manual NES');
  for(const width of [320,390,568,820,844]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:width===844?390:width===568?320:1180,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Overflow at '+width);
    const fit=await evaluate(`(()=>{const v=document.querySelector('.manual-view').getBoundingClientRect();const keys=[...document.querySelectorAll('.manual-side button')].map(b=>b.getBoundingClientRect());return {ratio:v.width/v.height,h:v.height,overlap:keys.some(b=>b.left<v.right&&b.right>v.left&&b.top<v.bottom&&b.bottom>v.top)}})()`);
    assert.ok(Math.abs(fit.ratio-240/224)<.002,'NES proportions at '+width);assert.equal(fit.overlap,false,'Controls must stay outside game at '+width);
    if(width===844)assert.ok(Math.abs(fit.h-390)<1,'Landscape iPhone game must fill the available height');
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
  await ready('bunnyMario.isPlaying()');
  const grant=await evaluate("apiRequest('mario')");assert.equal(grant.tickets,0);assert.ok(grant.remaining>590&&grant.remaining<=600);
  assert.equal(await evaluate("$('mario-admin-play').hidden"),true);
  // A real START from the original title, not a prepared level checkpoint.
  await ready('testNES.at(-1).cpu.mem[0x0770]===0&&testNES.at(-1).cpu.mem[0x0772]===3');
  await tap('#manual-pause');await ready('testNES.at(-1).cpu.mem[0x0770]===1&&testNES.at(-1).cpu.mem[0x0772]===3');
  await evaluate("$('manual-home').click()");await delay(250);
  const checkpointExists=await evaluate(`new Promise(resolve=>{const request=indexedDB.open('bunny-mario-saves',1);request.onsuccess=()=>{const db=request.result,op=db.transaction('states').objectStore('states').get(activePlayer.id+':original');op.onsuccess=()=>{db.close();resolve(Boolean(op.result?.state));};};request.onerror=()=>resolve(false);})`);
  assert.ok(checkpointExists,'NES checkpoint must be stored locally under the child profile');
  await send('Page.reload');await ready("typeof activePlayer!=='undefined'&&activePlayer?.name==='Ребёнок'");
  await ready("!$('mario-earned-play').hidden");
  assert.equal(await evaluate('JSON.stringify(activePlayer.stickers)'),before);
  await evaluate("$('mario-earned-play').click()");await ready("phase==='player-mario'");await ready('bunnyMario.isPlaying()');
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
  console.log('PASS native Mario: original title, SELECT 1/2 players, START launches original ROM and toggles native pause, full APU music without Bunny soundtrack/clicks, three-touch run/jump, sub-frame tap, slip capture, audio unlock, viewport geometry, earned access, local checkpoints, offline stop, server expiry, unchanged rewards');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{ws?.close();chrome?.kill();backend?.kill();});
