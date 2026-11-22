// Exercise actual ROM evidence and production discovery/restore/cancellation logic.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=__dirname,engine=require(root+'/assets/emulation/jsnes-2.1.0.min.js'),rom=new Uint8Array(fs.readFileSync(root+'/assets/emulation/smb-world.nes'));
const elements=new Map(),frames=new Map(),saved=[];let serial=0,clock=0;
function element(){return {hidden:true,open:false,value:'0',textContent:'',children:[],listeners:{},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},replaceChildren(){this.children=[];},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},getContext(){return {createImageData:()=>({data:new Uint8ClampedArray(256*240*4)}),putImageData(){}}}};}
const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
const window={jsnes:engine},document={hidden:false,addEventListener(){}};
const fetch=async url=>{const bytes=fs.readFileSync(path.join(root,url.split('?')[0]));return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),json:async()=>JSON.parse(bytes)}};
let c;
c=vm.createContext({window,document,$,fetch,console,structuredClone,performance,setTimeout,clearTimeout,AbortController,Uint8Array,Uint32Array,Uint8ClampedArray,Float32Array,phase:'answer',audioCtx:null,mute:false,fxVolume:.65,activePlayer:{id:'one',preferences:{}},ensureAudio(){},
 readPlayerPreference:(k,d)=>c.activePlayer?.preferences[k]||d,
 savePlayerPreference:(k,v)=>{saved.push({owner:c.activePlayer.id,k,v});c.activePlayer.preferences[k]=v;},
 playerButton:(parent,text,fn)=>{const el=element();el.textContent=text;el.onclick=fn;parent.children.push(el);return el;},
 requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id)});
let source=fs.readFileSync(root+'/mario-replay.js','utf8').replace(/\}\)\(\);\s*$/,`window.secretTest={secrets,makeSession,prepareSecret,startSecret,cancelSecret,discoveries,getRun:()=>secretRun,getFrame:()=>frame,getSession:()=>session,getTarget:()=>target,setRoute:value=>{verified=value;chosen=true;marioTheme=true;resetSession();}};})();`);
vm.runInContext(source,c);const t=window.secretTest;
function tick(n=1){for(let i=0;i<n;i++){clock+=17;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(clock);}}
async function ready(){for(let i=0;i<2000;i++){if(!t.getRun()||t.getRun().runtime)return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Episode loading timed out');}
function drain(){for(let i=0;frames.size&&i<2000;i++)tick();assert.equal(frames.size,0,'Animations settle');}
function route(){const p=JSON.parse(fs.readFileSync(root+'/assets/emulation/routes/1-1.json'));return {engine,rom,start:0,startState:p.startState,startImage:p.startImage.flatMap(([n,b])=>Array(n).fill(b)),buttons:p.inputs.flatMap(([n,b])=>Array(n).fill(b)),flag:p.goal,end:p.end};}
(async()=>{
 // The loader verifies all five native proof predicates before playing anything.
 $('nes-secret-dialog').showModal();
 for(const record of t.secrets){await t.startSecret(record,false);await ready();assert.ok(t.getRun()?.runtime,record.id+' must validate');tick(1000);assert.equal(t.getRun(),null);console.log('PASS native secret',record.id);}
 assert.equal(saved.length,0,'Collection replay does not grant discoveries');$('nes-secret-dialog').close();
 t.setRoute(route());window.bunnyReplay.setProgress(0,10);window.bunnyReplay.setProgress(4,10);drain();
 const session=t.getSession(),before=JSON.stringify(session.nes.toJSON());window.bunnyReplay.setProgress(5,10);await ready();assert.equal(t.getRun().record.id,'oneup11');
 tick(90);assert.equal(JSON.stringify(session.nes.toJSON()),before,'Learning ROM freezes during the separate clip');
 document.hidden=true;const at=t.getRun().frame;tick(120);assert.equal(t.getRun().frame,at,'Backgrounding pauses the clip');document.hidden=false;
 c.phase='settings';tick(120);assert.equal(t.getRun().frame,at,'Settings pause the clip');c.phase='answer';
 window.bunnyReplay.setProgress(6,10);drain();assert.equal(saved.length,1);assert.equal(saved[0].owner,'one');assert.equal(t.getSession(),session);assert.equal(t.getFrame(),t.getTarget(),'Latest question progress resumes');
 window.bunnyReplay.setProgress(7,10);drain();assert.equal(saved.length,1,'Only one episode per round');assert.equal(t.getRun(),null);
 window.bunnyReplay.setProgress(10,10);drain();assert.equal(t.getFrame(),route().end,'Final task still finishes original level');
 window.bunnyReplay.setProgress(0,10);window.bunnyReplay.setProgress(5,10);await ready();assert.equal(t.getRun().record.id,'coins11','Next round shows the other 1-1 secret');
 $('nes-secret-skip').onclick();drain();assert.equal(saved.length,1,'Skipping never discovers');window.bunnyReplay.setProgress(6,10);assert.equal(t.getRun(),null,'Skipping cannot retrigger in this round');
 window.bunnyReplay.setProgress(0,10);window.bunnyReplay.setProgress(5,10);await ready();c.activePlayer={id:'two',preferences:{}};window.bunnyReplay.playerChanged();tick(600);assert.equal(saved.length,1,'Switching profile cancels without granting to another child');
 window.bunnyReplay.setProgress(0,10);window.bunnyReplay.setProgress(5,10);await ready();window.bunnyReplay.setProgress(10,10);drain();assert.equal(saved.length,1,'Final answer cancels an unfinished optional clip');
 window.bunnyReplay.setProgress(0,10);window.bunnyReplay.setProgress(5,10);window.bunnyReplay.setProgress(0,0);await ready();tick(600);assert.equal(t.getRun(),null,'Leaving while loading cannot restart an episode');
 window.bunnyReplay.setProgress(0,10);window.bunnyReplay.setProgress(5,10);await ready();window.bunnyReplay.setTheme(false);tick(600);assert.equal(t.getRun(),null,'Changing theme cancels the clip');
 assert.equal(t.discoveries().size,0,'Profiles have separate discovery collections');
 console.log('PASS one episode per round; native life gain/coin room/reveal/growth/coins; learning state/finish preserved; hidden/settings pause; skip/profile/exit/theme/final-answer cancellation; collection replay grants nothing');
})().catch(error=>{console.error(error);process.exitCode=1});
