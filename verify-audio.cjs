// Audio lifecycle tests with real application logic and a controllable audio clock/network.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const manifest=JSON.parse(fs.readFileSync(__dirname+'/assets/audio/music/loops.json'));
function harness(){
 const nodes=[],requests=[],els=new Map(),listeners={},windowListeners={},saved=[];let current=0;
 const param=()=>({value:1,setValueAtTime(v){this.value=v},linearRampToValueAtTime(v){this.value=v},setTargetAtTime(v){this.value=v},cancelScheduledValues(){}});
 const gain=()=>({gain:param(),connect(){},disconnect(){}});
 class AC{constructor(){this.currentTime=42;this.destination={};this.state='running'}resume(){this.state='running';return Promise.resolve()}suspend(){this.state='suspended';return Promise.resolve()}createGain(){return gain()}createBufferSource(){const n={connect(){},disconnect(){},start(t){this.started=true;this.time=t},stop(t){this.stopped=true;this.stopTime=t}};nodes.push(n);return n}decodeAudioData(data,ok){ok({duration:data.duration,sampleRate:48000})}}
 function el(){return {hidden:false,textContent:'',value:'',style:{},classList:{toggle(){}},append(){},replaceChildren(){},setAttribute(){}}}
 const document={hidden:false,getElementById(id){if(!els.has(id))els.set(id,el());return els.get(id)},createElement:el,querySelectorAll(){return []},addEventListener(name,fn){listeners[name]=fn}};
 class Audio{addEventListener(){}play(){return Promise.resolve()}pause(){this.paused=true}}
 const fetch=url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}));
 const window={AudioContext:AC,addEventListener:(name,fn)=>windowListeners[name]=fn,bunnyAudioPreferences:{save:(k,v)=>saved.push([k,v])}};
 const c=vm.createContext({console:{warn(){}},document,window,Audio,fetch,performance:{now:()=>0},setTimeout(){return ++current},clearTimeout(){}});
 vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),c);const run=s=>vm.runInContext(s,c);
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
 async function resolveAll(){await flush();for(const r of requests.splice(0)){if(r.url.endsWith('loops.json'))r.resolve({ok:true,json:async()=>manifest});else {const t=manifest.tracks.find(t=>r.url.endsWith(t.file));r.resolve({ok:true,arrayBuffer:async()=>({duration:t?t.duration_seconds:5.641})})}}await flush()}
 return {run,nodes,requests,resolveAll,flush,els,saved,document,listeners,windowListeners};
}
(async()=>{
 const h=harness();await h.resolveAll();assert.equal(h.run('music.length'),10);assert.equal(h.run('musicNodes[0].index'),6);
 const original=h.run('musicNodes[0].source');h.run('home();home()');await h.flush();assert.equal(h.run('musicNodes[0].source'),original,'Navigation keeps the existing source and position');
 h.document.hidden=true;h.listeners.visibilitychange();assert.equal(h.run('audioCtx.state'),'suspended');assert.equal(original.stopped,undefined);
 const clock=h.run('audioCtx.currentTime');h.document.hidden=false;h.listeners.visibilitychange();await h.flush();assert.equal(h.run('audioCtx.state'),'running');assert.equal(h.run('musicNodes[0].source'),original);assert.equal(h.run('audioCtx.currentTime'),clock);
 h.run("loadAudioProfile({id:'julia',preferences:{'bunny-audio-selectedMusic':'4','bunny-audio-autoMusic':'false','bunny-audio-taskVolume':'0.2'}});home()");await h.resolveAll();assert.equal(h.run('musicNodes[0].index'),4);
 h.run("$('music-volume').oninput({target:{value:'25'}});$('music-volume').onchange();$('fx-volume').oninput({target:{value:'80'}});$('fx-volume').onchange()");assert.deepEqual(h.saved.slice(-2),[['bunny-audio-musicVolume','0.25'],['bunny-audio-fxVolume','0.8']]);
 h.run("sound('coin');sound('tap')");assert.equal(h.run("[...players].find(p=>p[1]==='coin')[0].volume"),.2);assert.equal(h.run("[...players].find(p=>p[1]==='tap')[0].volume"),.8);
 h.run("loadAudioProfile({id:'sonya',preferences:{}});home()");await h.resolveAll();assert.equal(h.run('autoMusic'),true);assert.equal(h.run('taskVolume'),.65);assert.equal(h.run('fxVolume'),.65);assert.equal(h.run('musicNodes[0].index'),6);
 h.run("begin('add')");await h.resolveAll();assert.equal(h.run('musicNodes[0].index'),7);const ordinary=h.run('musicNodes[0].source');h.run("begin('compare')");await h.flush();assert.equal(h.run('musicNodes[0].source'),ordinary);
 h.run("home();phase='player-album';startMusic()");await h.resolveAll();assert.equal(h.run('musicNodes[0].index'),8);const count=h.nodes.filter(n=>!n.loop&&n.started).length;h.run("albumRewardSound('albumClear');albumRewardSound('albumClear')");await h.resolveAll();assert.equal(h.nodes.filter(n=>!n.loop&&n.started).length,count,'Album opening never replays an award');
 h.run("planRoundAudio('r1','sonya');finish()");await h.resolveAll();assert.equal(h.nodes.filter(n=>!n.loop&&n.started).length,count,'Wait for the actual award before choosing fanfare');
 h.run("completeRoundAudio('r1','sonya',{kind:'sticker'});completeRoundAudio('r1','sonya',{kind:'sticker'})");await h.resolveAll();assert.equal(h.nodes.filter(n=>!n.loop&&n.started).length,count+1);assert.equal(h.run("[...players.values()].filter(n=>n==='stickerClear').length"),1);assert.equal(h.run('musicBus.gain.value'),.35*.15);
 h.run("stopEffects(true);phase='finished';planRoundAudio('r2','sonya');completeRoundAudio('r2','sonya',{kind:'collection',collections:[{name:'Микки Маус'}]})");await h.resolveAll();assert.match(h.els.get('message').textContent,/Коллекция собрана: Микки Маус/);assert.equal(h.run('audioFanfare!==null'),true);
 h.document.hidden=true;h.listeners.visibilitychange();assert.equal(h.run('players.size'),0);h.document.hidden=false;h.listeners.visibilitychange();await h.flush();assert.equal(h.run('audioFanfare'),null,'Resume does not replay fanfare');
 const late=harness();late.run("begin('add')");await late.flush();late.document.hidden=true;late.listeners.visibilitychange();await late.resolveAll();assert.equal(late.run('musicNodes.length'),0,'Late load cannot start while hidden');late.document.hidden=false;late.listeners.visibilitychange();await late.resolveAll();assert.equal(late.run('musicNodes.length'),1);
 const nes=harness();nes.run("stopMusic();game=null;phase='player-mario';startMusic();sound('tap');playFanfare('win')");await nes.resolveAll();assert.equal(nes.run('musicNodes.length'),0);assert.equal(nes.run('players.size'),0);nes.run("phase='settings';settingsSnapshot={phase:'player-mario'};startMusic(true)");await nes.resolveAll();assert.equal(nes.run('musicNodes.length'),0);nes.run('settingsSnapshot=null;home()');await nes.resolveAll();assert.equal(nes.run('musicNodes.length'),1);
 const e=harness();await e.flush();for(const r of e.requests.splice(0))r.reject(new Error('offline'));await e.flush();assert.match(e.els.get('track-label').textContent,/недоступна/);e.run('startMusic()');await e.resolveAll();assert.equal(e.run('musicNodes.length'),1);
 console.log('PASS audio: ten themes; source continuity; hidden clock suspension and resume; stale loads; profile preferences; separate volumes; one award sound; collection congratulations; NES exclusion; network retry.');
})().catch(e=>{console.error(e);process.exitCode=1});
