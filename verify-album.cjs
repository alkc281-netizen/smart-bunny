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
  await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: site});
  await until(() => evaluate("typeof authConfigured !== 'undefined' && playerApiReady"));
  const code = fs.readFileSync(database.replace('.sqlite', '.setup-code'), 'utf8').trim();
  await evaluate(`apiRequest('auth/setup', ${JSON.stringify({code, player: 'album-test', login: 'album-test', password: 'Album-test-123'})}).then(loadPlayerSession)`);
  await evaluate('openPlayerAlbum()');
  await until(() => evaluate("phase==='player-album' && !writingPlayer"));
  await delay(100);
  const center = selector => evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}; })()`);
  const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', {type, ...p, ...extra});
  const click = async p => {
    await mouse('mousePressed', p, {button: 'left', buttons: 1, clickCount: 1});
    await mouse('mouseReleased', p, {button: 'left', buttons: 0, clickCount: 1});
  };
  const saved = () => until(() => evaluate('!writingPlayer && playerOutbox.length===0'));
  await click(await center('.album-sticker[data-kind=start]'));
  assert.equal(await evaluate('selectedSticker'), 'start');
  const destination = await evaluate("(() => {const r=$('album-page').getBoundingClientRect(); return {x:r.left+r.width*.5,y:r.top+r.height*.22};})()");
  await click(destination);
  await saved();
  assert.ok(Math.abs(await evaluate('activePlayer.stickers.start.x') - 50) < 1);
  assert.equal(await evaluate('selectedSticker'), null);
  // Actual mouse pointer capture keeps dragging beyond the page, then clamps to its edge.
  const from = await center('.album-sticker[data-kind=start]');
  await mouse('mousePressed', from, {button: 'left', buttons: 1});
  await mouse('mouseMoved', {x: from.x + 40, y: from.y + 50}, {button: 'left', buttons: 1});
  assert.equal(await evaluate('Boolean(albumDrag?.moved)'), true);
  await mouse('mouseMoved', {x: from.x - 350, y: from.y + 500}, {button: 'left', buttons: 1});
  await mouse('mouseReleased', {x: from.x - 350, y: from.y + 500}, {button: 'left', buttons: 0, clickCount: 1});
  await saved();
  const afterMouse = await evaluate('activePlayer.stickers.start');
  assert.ok(afterMouse.x < 20 && afterMouse.y > 75, JSON.stringify(afterMouse));
  assert.equal(await evaluate('selectedSticker'), null, 'drag must not become a second selection');
  // Reload restores the saved coordinates from the server.
  await send('Page.reload');
  await until(() => evaluate("typeof activePlayer!=='undefined' && activePlayer?.id==='album-test'"));
  assert.deepEqual(await evaluate('activePlayer.stickers.start'), afterMouse);
  // Phone and iPad viewports, real CDP touch events.
  for (const [width, height] of [[390,844],[820,1180]]) {
    await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 2, mobile: true});
    await send('Emulation.setTouchEmulationEnabled', {enabled: true});
    await evaluate('openPlayerAlbum()');
    await delay(100);
    const p = await center('.album-sticker[data-kind=start]');
    const touch = (type, x, y) => send('Input.dispatchTouchEvent', {type, touchPoints: type==='touchEnd'||type==='touchCancel' ? [] : [{x,y,id:0,radiusX:5,radiusY:5,force:1}]});
    const beforeScroll = await evaluate('scrollY');
    await touch('touchStart', p.x, p.y);
    await touch('touchMove', p.x + 55, p.y - 55);
    await touch('touchMove', p.x + 80, p.y - 80);
    await touch('touchEnd');
    await saved();
    const afterTouch = await evaluate('activePlayer.stickers.start');
    assert.ok(afterTouch.x > afterMouse.x && afterTouch.y < afterMouse.y);
    assert.equal(await evaluate('scrollY'), beforeScroll, 'dragging a sticker must not scroll the page');
    assert.equal(await evaluate('selectedSticker'), null);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false);
    // Cancellation restores its last committed position without a new update.
    const c = await center('.album-sticker[data-kind=start]');
    await touch('touchStart', c.x, c.y);
    await touch('touchMove', c.x + 30, c.y + 30);
    await touch('touchCancel');
    assert.deepEqual(await evaluate('activePlayer.stickers.start'), afterTouch);
    assert.equal(await evaluate('albumDrag'), null);
    console.log('PASS touch drag/cancel, no scroll/overflow at', width, height);
  }
  // Queue two moves while offline; an older response must preserve the latest move.
  await evaluate(`window.originalPlayerRequest=playerRequest; window.originalRender=renderPlayerAlbum;
    window.renderCount=0; renderPlayerAlbum=(...args)=>{renderCount++; return originalRender(...args)};
    window.pendingCalls=[]; playerRequest=(path,data)=>new Promise(resolve=>pendingCalls.push({resolve,path,data}));
    enqueuePlayerUpdate({kind:'sticker',sticker:'start',x:30,y:40});
    activePlayer.stickers.start={x:65,y:70}; enqueuePlayerUpdate({kind:'sticker',sticker:'start',x:65,y:70});`);
  await evaluate("pendingCalls[0].resolve({...activePlayer,stickers:{...activePlayer.stickers,start:{x:30,y:40}}})");
  await until(() => evaluate('pendingCalls.length===2'));
  assert.deepEqual(await evaluate('activePlayer.stickers.start'), {x:65,y:70});
  assert.equal(await evaluate('renderCount'), 0);
  await evaluate("pendingCalls[1].resolve({...activePlayer}); playerRequest=originalPlayerRequest; renderPlayerAlbum=originalRender");
  await saved();
  // New stickers remain placeable and keyboard navigation works.
  await evaluate("renderPlayerAlbum(); document.querySelector('.album-tray [data-sticker=coin]').click(); $('album-page').focus()");
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await saved();
  assert.deepEqual(await evaluate('activePlayer.stickers.coin'), {x:45,y:78});
  await evaluate("document.querySelector('.album-sticker[data-kind=coin]').focus()");
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await saved();
  assert.deepEqual(await evaluate('activePlayer.stickers.coin'), {x:43,y:78});
  assert.equal(await evaluate('activePlayer.coins'), 3);
  assert.equal(await evaluate('activePlayer.rounds'), 5);
  console.log('PASS tap-move, mouse drag/capture/clamp, reload persistence, queued response order, new placement, keyboard, unchanged rewards');
})().catch(error => { console.error(error); process.exitCode=1; }).finally(() => {
  ws?.close(); chrome?.kill(); backend?.kill();
  // Chrome may still be closing files; retain the isolated temp directory for debugging.
});
