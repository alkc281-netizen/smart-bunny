// Exercise production handlers and frame delivery; no live accounts or browser automation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
  constructor(tag='div',parent=null){this.tagName=tag.toUpperCase();this.parent=parent;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.className='';parent?.children.push(this);}
  get classList(){return {contains:name=>this.className.split(' ').includes(name),add:name=>{this.className+=' '+name;},remove:name=>{this.className=this.className.split(' ').filter(x=>x!==name).join(' ');}};}
  matches(selector){return selector==='button'?this.tagName==='BUTTON':selector==='[data-mask]'?Boolean(this.dataset.mask):selector.startsWith('.')?this.classList.contains(selector.slice(1)):selector.startsWith('#')?this.id===selector.slice(1):false;}
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector);}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0];}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(type,fn,options){(this.listeners[type]||=[]).push({fn,options});}
  dispatch(type,event){for(const {fn}of this.listeners[type]||[])fn(event);}
  click(){return this.onclick?.();}
  setPointerCapture(){if(this.captureFails)throw Error('capture unavailable');}
  getBoundingClientRect(){return {left:10,right:60,top:10,bottom:60};}
  getContext(){return {createImageData:()=>({data:new Uint8ClampedArray(256*240*4)}),putImageData(){}};}
}
async function harness(){
  const root=new Element(),elements=new Map(),frames=new Map(),masks=[],startedLevels=[];
  let now=0,serial=0,released=0,selection={rangeCount:1,removeAllRanges(){this.rangeCount=0;}};
  const $=id=>{if(!elements.has(id)){const el=new Element('div',root);el.id=id;elements.set(id,el);}return elements.get(id);};
  const document=new Element();document.hidden=false;
  document.querySelectorAll=selector=>selector.includes('[data-mask]')?root.querySelectorAll('[data-mask]'):[];
  document.elementFromPoint=()=>document.hit;
  const window=new Element();window.ontouchstart=null;window.getSelection=()=>selection;
  let session;
  if(process.env.BUNNY_TEST_NES&&process.env.BUNNY_TEST_ROM){
    const source=fs.readFileSync(__dirname+'/mario-replay.js','utf8');
    const make=vm.runInNewContext(source.slice(source.indexOf('  function makeSession('),source.indexOf('  function isolateEffects('))+';makeSession',{structuredClone});
    session=make(require(process.env.BUNNY_TEST_NES),new Uint8Array(fs.readFileSync(process.env.BUNNY_TEST_ROM)),()=>{},()=>{},true);
    for(let i=0;i<41;i++)session.step(0);session.step(16);
    for(let i=0;i<174;i++)session.step(0);
    assert.equal(session.nes.cpu.mem[0x0e],8,'Original ROM enters active gameplay');
  }
  const runtime={step:mask=>{masks.push(mask);session?.step(mask);},isPaused:()=>false,snapshot:()=>({}),restore(){},silence(){},releaseInput(){released++;session?.release();}};
  window.bunnyReplay={manual:async level=>{startedLevels.push(level);return runtime;},stopManual(){}};
  const c=vm.createContext({window,document,console,$,navigator:{},performance:{now:()=>now},
    activePlayer:{id:'test'},parentSession:true,phase:'menu',mute:true,
    playerElement:(tag,text,parent)=>{const el=new Element(tag,parent);el.textContent=text;return el;},
    playerButton:(parent,text,fn)=>{const el=new Element('button',parent);el.textContent=text;el.onclick=fn;return el;},
    playerScreen:(title,hint,screen)=>{c.phase=screen;window.bunnyMario?.screenChanged();const panel=$('player-panel');panel.children=[];return panel;},
    apiRequest:async()=>({player:'test',admin:true,id:'lease',tickets:0}),stopMusic(){},message(){},
    home:()=>{c.phase='menu';window.bunnyMario.screenChanged();},
    requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),setInterval(){},
  });
  vm.runInContext(fs.readFileSync(__dirname+'/mario-manual.js','utf8'),c);
  await window.bunnyMario.open(null);for(let i=0;i<15;i++)await Promise.resolve();
  assert.ok(window.bunnyMario.isPlaying());
  const panel=$('player-panel'),buttons=root.querySelectorAll('[data-mask]');
  const button=mask=>buttons.find(el=>+el.dataset.mask===mask);
  const pad=mask=>button(mask).closest('.mario-touch-controls');
  const event=(target,extra={})=>({target,cancelable:true,preventDefault(){this.prevented=true;},...extra});
  const touch=(id,mask)=>({identifier:id,target:button(mask),clientX:30,clientY:30});
  function dispatch(type,touches,changed=touches){const e=event(panel,{touches,changedTouches:changed});(type==='touchstart'||type==='touchmove'?panel:window).dispatch(type,e);return e;}
  function tick(count=1){for(let i=0;i<count;i++){now+=17;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));}}
  return {window,document,button,pad,panel,event,touch,dispatch,tick,masks,startedLevels,c,$,released:()=>released,selection,session};
}
(async()=>{
  const h=await harness(),{touch,dispatch,tick,button,pad,window,event,masks}=h;
  const right=touch(1,1),run=touch(2,64),jump=touch(3,128);
  assert.ok(dispatch('touchstart',[right],[right]).prevented,'Safari default gestures blocked');
  dispatch('touchstart',[right,run],[run]);dispatch('touchstart',[right,run,jump],[jump]);tick(4);
  assert.equal(masks.at(-1),193,'Three simultaneous fingers reach NES');
  if(h.session)assert.equal(h.session.nes.cpu.mem[0x1d],1,'Original Mario actually jumps');
  dispatch('touchend',[right,run],[jump]);tick(2);assert.equal(masks.at(-1),65,'Jump releases without releasing run');
  dispatch('touchend',[],[right,run]);tick(2);assert.equal(masks.at(-1),0,'Last finger releases all buttons');
  assert.equal(button(64).attrs['aria-pressed'],'false');
  if(h.session)for(const state of Object.values(h.session.nes.controllers))assert.ok(state.state.every(value=>!(value&1)),'Both actual NES controllers release');
  dispatch('touchstart',[jump]);dispatch('touchend',[],[jump]);const start=masks.length;tick(4);
  assert.deepEqual(masks.slice(start),[128,128,0,0],'Quick tap lasts two NES polls, then releases');
  dispatch('touchstart',[run]);tick(3);
  // The old B touchend is lost. The next real active-touch list repairs it.
  dispatch('touchstart',[jump],[jump]);tick(3);assert.equal(masks.at(-1),128,'Missing release cannot latch old B');
  dispatch('touchcancel',[],[jump]);tick(2);assert.equal(masks.at(-1),0);
  dispatch('touchstart',[run]);tick(3);dispatch('touchcancel',[],[run]);tick();assert.equal(masks.at(-1),0);
  for(let i=0;i<100;i++){dispatch('touchstart',[jump]);dispatch('touchend',[],[jump]);tick(3);assert.equal(masks.at(-1),0,'Repeated A tap must release: '+i);}
  dispatch('touchstart',[run]);tick(3);dispatch('touchmove',[{...run,clientX:999,clientY:999}]);tick();
  assert.equal(masks.at(-1),64,'A/B allow thumb slip until finger release');
  dispatch('touchend',[],[run]);tick();assert.equal(masks.at(-1),0);
  // Pointer fallback still releases outside the pad, even if capture fails.
  pad(64).captureFails=true;
  const pointer=event(button(64),{pointerId:9,pointerType:'mouse',button:0,buttons:1});
  pad(64).onpointerdown(pointer);tick(3);
  window.dispatch('pointerup',event(h.panel,{pointerId:9}));tick();assert.equal(masks.at(-1),0);
  pad(64).onpointerdown(pointer);tick(3);pad(64).onpointermove({...pointer,buttons:0});tick();assert.equal(masks.at(-1),0);
  pad(64).onpointerdown(pointer);tick(3);pad(64).onlostpointercapture(pointer);tick();assert.equal(masks.at(-1),0);
  pad(64).onpointerdown({...pointer,pointerType:'touch'});tick();assert.equal(masks.at(-1),0,'Touch pointer cannot double-register native touch');
  // START touch uses original system button; no delayed compatibility click needed.
  const system=h.panel.children[0].querySelectorAll('button').find(b=>b.id==='manual-select');
  dispatch('touchstart',[{identifier:10,target:system}]);await Promise.resolve();tick();assert.equal(masks.at(-1),32);
  tick(2);assert.equal(masks.at(-1),0);
  dispatch('touchstart',[run]);tick(3);const before=h.released();window.dispatch('blur',{});
  assert.equal(window.bunnyMario.isPlaying(),false);assert.ok(h.released()>before,'Pause releases actual emulator input immediately');
  assert.equal(button(64).attrs['aria-pressed'],'false');
  h.selection.rangeCount=1;h.document.dispatch('selectionchange',{});assert.equal(h.selection.rangeCount,0);
  h.c.home();const lesson=event(h.panel);h.panel.onselectstart(lesson);assert.equal(lesson.prevented,undefined,'Lessons retain normal selection');
  await window.bunnyMario.open(null);for(let i=0;i<15;i++)await Promise.resolve();
  assert.equal(h.panel.listeners.touchstart.length,1,'Reopening does not accumulate gesture handlers');
  assert.equal(h.panel.listeners.touchmove.length,1);
  h.c.home();await window.bunnyMario.open();
  assert.equal(h.c.phase,'player-mario-select');assert.equal(window.bunnyMario.isPlaying(),false);
  const choices=h.panel.querySelectorAll('button').filter(button=>button.dataset.marioLevel!==undefined);
  assert.equal(choices.length,32);assert.deepEqual(choices.map(button=>Number(button.dataset.marioLevel)),Array.from({length:32},(_,i)=>i));
  await choices[31].click();for(let i=0;i<15;i++)await Promise.resolve();
  assert.equal(h.startedLevels.at(-1),31);assert.equal(window.bunnyMario.isPlaying(),true);
  h.c.home();await window.bunnyMario.open(null);for(let i=0;i<15;i++)await Promise.resolve();assert.equal(h.startedLevels.at(-1),null);
  console.log('PASS NES input: native three-touch, short tap, missed release recovery, cancel, slip, global pointer release, failed capture, duplicate suppression, SELECT, blur reset, selection blocking');
})().catch(error=>{console.error(error);process.exitCode=1;});
