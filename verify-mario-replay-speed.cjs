// Drive the production animation loop with a controlled display clock.
// No private ROM or player data is needed to check wall-clock playback speed.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const frameMs=1000/60.0988138974405;
let now=0,serial=0,steps=0;
const pending=new Map(),elements=new Map(),events=new Map();
const blank=new Uint32Array(256*240);
function element(){return {hidden:true,value:'0',setAttribute(){},addEventListener(){},close(){},getContext(){return {createImageData:()=>({data:new Uint8ClampedArray(256*240*4)}),putImageData(){}}}};}
const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
const window={},document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn)};
const c=vm.createContext({window,document,$,console,Uint32Array,Uint8ClampedArray,Float32Array,performance:{now:()=>now},phase:'answer',activePlayer:null,audioCtx:null,mute:false,fxVolume:0,
 requestAnimationFrame:fn=>{pending.set(++serial,fn);return serial;},cancelAnimationFrame:id=>pending.delete(id),
 testRuntime:{step(){steps++;},nes:{ppu:{buffer:blank}}},blank});
let source=fs.readFileSync(__dirname+'/mario-replay.js','utf8');
source=source.replace(/\}\)\(\);\s*$/,`window.clockTest={start(){
  stopPlayback();cancelSecret(false);chosen=marioTheme=true;
  currentCompleted=currentTotal=frame=target=0;secretAttempted=false;
  verified={start:0,flag:1200,end:1200,buttons:Array(1201).fill(0),startImage:blank};session=testRuntime;
},frame:()=>frame,target:()=>target};})();`);
vm.runInContext(source,c);const t=window.clockTest;
function tick(hz){now+=1000/hz;const callbacks=[...pending.values()];pending.clear();for(const fn of callbacks)fn(now);}
function reset(){t.start();steps=0;now=0;c.phase='answer';document.hidden=false;}
for(const hz of [30,60,90,120])for(const total of [10,50,100])for(const idle of [0,4000,60000]){
 reset();let activeTime=0;
 for(let task=1;task<=total;task++){
   assert.equal(pending.size,0);now+=idle;
   const start=now,before=steps;window.bunnyReplay.setProgress(task,total);
   tick(hz);
   assert.ok(steps-before<=Math.floor((1000/hz)/frameMs+1e-8),'A new segment cannot spend time from the answer pause or emit a frame early');
   for(let guard=0;pending.size&&guard<3000;guard++)tick(hz);
   assert.equal(pending.size,0);assert.equal(t.frame(),t.target());
   activeTime+=now-start;
 }
 assert.equal(steps,1200,'No route frames may be skipped or repeated');
 assert.ok(activeTime+1e-6>=steps*frameMs,'Playback cannot run faster than the original NES clock');
 assert.ok(activeTime<=steps*frameMs+total*1000/hz+1e-6,'Only display-frame rounding may slow playback');
}
for(const hz of [60,120]){
 reset();window.bunnyReplay.setProgress(1,10);tick(hz);tick(hz);
 c.phase='settings';tick(hz);const before=steps;
 for(let i=0;i<100;i++)tick(hz);
 assert.equal(steps,before);c.phase='answer';tick(hz);
 assert.ok(steps-before<=1,'Settings cannot create catch-up frames');
 document.hidden=true;events.get('visibilitychange')();const hiddenSteps=steps;now+=3600000;
 document.hidden=false;events.get('visibilitychange')();tick(hz);
 assert.ok(steps-hiddenSteps<=Math.floor((1000/hz)/frameMs+1e-8),'Background time is not replay time');
 reset();const start=now;window.bunnyReplay.setProgress(1,10);
 for(let i=0;i<5;i++)tick(hz);
 window.bunnyReplay.setProgress(9,10);
 for(let i=0;i<15;i++)tick(hz);
 assert.ok(steps*frameMs<=now-start+1e-6,'New answers during motion do not accelerate it');
 window.bunnyReplay.setProgress(10,10);
 for(let guard=0;pending.size&&guard<3000;guard++)tick(hz);
 assert.equal(t.frame(),1200,'The last answer still finishes the route');
}
console.log('PASS playback clock: 30/60/90/120 Hz; 10/50/100 tasks; 0/4/60s answer waits; no catch-up or early frames; native rate; no skipped frames; settings/background; rapid answers; final completion');
