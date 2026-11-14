const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const manifest=JSON.parse(fs.readFileSync(__dirname+'/assets/audio/music/loops.json'));
function harness(){
 const nodes=[],requests=[],els=new Map();let current=0;
 const param=()=>({value:1,setValueAtTime(v){this.value=v},linearRampToValueAtTime(v){this.value=v},setTargetAtTime(v){this.value=v},cancelScheduledValues(){}});
 const gain=()=>({gain:param(),connect(){},disconnect(){}});
 class AC{constructor(){this.currentTime=0;this.destination={};this.state='running'}resume(){return Promise.resolve()}createGain(){return gain()}createBufferSource(){const n={connect(){},disconnect(){},start(t){this.started=true;this.time=t},stop(t){this.stopped=true;this.stopTime=t},loop:false};nodes.push(n);return n}decodeAudioData(data,ok){ok({duration:data.duration,sampleRate:48000})}}
 function el(){return {hidden:false,textContent:'',style:{},classList:{toggle(){}},append(){},replaceChildren(){},setAttribute(){}}}
 const document={getElementById(id){if(!els.has(id))els.set(id,el());return els.get(id)},createElement:el,querySelectorAll(){return []},addEventListener(){}};
 class Audio{addEventListener(){}play(){return Promise.resolve()}pause(){}}
 const fetch=url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}));
 const c=vm.createContext({console:{warn(){}},document,window:{AudioContext:AC},Audio,fetch,performance:{now:()=>0},setTimeout(){return ++current},clearTimeout(){}});
 vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),c);const run=s=>vm.runInContext(s,c);
 const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
 async function resolveAll(){for(const r of requests.splice(0)){if(r.url.endsWith('loops.json'))r.resolve({ok:true,json:async()=>manifest});else {const t=manifest.tracks.find(t=>r.url.endsWith(t.file));r.resolve({ok:true,arrayBuffer:async()=>({duration:t?t.duration_seconds:5.641})})}}await flush()}
 return {run,nodes,requests,resolveAll,flush,els};
}
(async()=>{
 for(const action of ['home()','finish()',"begin('compare')"]){const h=harness();h.run("begin('add')");h.run(action);await h.resolveAll();const music=h.nodes.filter(n=>n.loop&&n.started&&!n.stopped);if(action.startsWith('begin')){assert.equal(music.length,1);assert.equal(music[0].loopStart,manifest.tracks.find(t=>t.file==='underground.wav').loop_start_sample/44100)}else assert.equal(music.length,0)}
 const h=harness();h.run("begin('add')");await h.resolveAll();let n=h.nodes.find(n=>n.loop);assert.ok(n.started);assert.equal(n.loopStart,manifest.tracks[0].loop_start_sample/44100);assert.ok(Math.abs(n.loopEnd-manifest.tracks[0].loop_end_sample_exclusive/44100)<1/44100);
 for(const [mode,index] of Object.entries({memory:2,compare:1,pattern:3,add:0,multiply:4,divide:1})){h.run(`begin('${mode}')`);await h.flush();assert.equal(h.run('selectedMusic'),index)}
 h.run("openSettings();$('auto-music').onchange({target:{checked:false}});$('song').onchange({target:{value:'4'}})");await h.flush();assert.equal(h.run('selectedMusic'),4);assert.equal(h.run('autoMusic'),false);
 h.run("$('music-volume').oninput({target:{value:'25'}});$('fx-volume').oninput({target:{value:'80'}})");assert.equal(h.run('musicVolume'),.25);assert.equal(h.run('fxVolume'),.8);
 h.run('settingsBack();finish()');await h.flush();const win=h.nodes.filter(n=>!n.loop&&n.started).at(-1);assert.ok(win);assert.equal(win.buffer.duration,5.641);assert.equal(h.run('musicNodes.length'),0);
 h.run("home();begin('add')");await h.flush();assert.ok(!win.stopped);assert.equal(h.run('musicNodes.length'),0);win.onended();await h.flush();assert.equal(h.run('musicNodes.length'),1);
 h.run('finish()');await h.flush();const win2=h.nodes.filter(n=>!n.loop&&n.started).at(-1);h.run('home()');win2.onended();await h.flush();assert.equal(h.run('musicNodes.length'),0);
 h.run("begin('add')");await h.flush();h.run("selectedMusic=4;startMusic()");await h.flush();const fading=[...h.run('retiringMusic')];assert.ok(fading.length);h.run('finish()');for(const old of fading)assert.equal(old.source.stopTime,undefined);
 const e=harness();e.run("begin('add')");for(const r of e.requests.splice(0))r.reject(new Error('offline'));await e.flush();assert.equal(e.run('musicNodes.length'),0);assert.match(e.els.get('track-label').textContent,/недоступна/);
 const m=harness();m.run("begin('memory');$('mute').onclick()");await m.resolveAll();assert.equal(m.run('musicNodes.length'),0);
 console.log('PASS audio: stale loads/menu/victory/mode switch; six mappings; 44100 loop points in 48000 context; manual/auto; independent volumes; full fanfare and replay; mute; network failure.');
})().catch(e=>{console.error(e);process.exitCode=1});
