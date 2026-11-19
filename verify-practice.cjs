// Exercise the static Pages startup, real question generators and isolated local storage.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
function harness(host='alkc281-netizen.github.io',storage=new Map()){
 const els=new Map(),timers=new Map(),requests=[];let now=0,serial=0,fetchImpl=async()=>{throw Error('offline')};
 function element(tag='div',id=''){
  const flags=new Set(),e={tagName:tag.toUpperCase(),children:[],dataset:{},hidden:false,textContent:'',style:{},className:'',value:'',
   classList:{toggle(k,v){if(v===undefined)v=!flags.has(k);v?flags.add(k):flags.delete(k)},contains:k=>flags.has(k),add:k=>flags.add(k),remove:k=>flags.delete(k)},
   append(...items){e.children.push(...items)},replaceChildren(...items){e.children=[...items]},querySelector(){return e.children.find(c=>c.dataset?.russianBack)},querySelectorAll(){return []},remove(){},setAttribute(){},addEventListener(){},closest(){return null},focus(){}};
  Object.defineProperty(e,'id',{get:()=>id,set(value){id=value;els.set(value,e)}});if(id)els.set(id,e);return e;
 }
 for(const [,id]of fs.readFileSync(__dirname+'/index.html','utf8').matchAll(/id="([^"]+)"/g))element('div',id);
 els.get('app').classList.add('auth-required');
 const document={getElementById:id=>els.get(id)||null,createElement:tag=>element(tag),createTextNode:text=>({textContent:text}),querySelectorAll(){return []},addEventListener(){}};
 const localStorage={getItem:k=>storage.get(k)??null,setItem(k,v){storage.set(k,String(v))}};
 const window={addEventListener(){}};
 const context=vm.createContext({console,document,window,localStorage,location:{hostname:host},crypto:webcrypto,Uint8Array,AbortSignal,
  fetch:async(...args)=>{requests.push(args);return fetchImpl(...args)},
  performance:{now:()=>now},setTimeout(fn,ms){timers.set(++serial,{fn,at:now+ms});return serial},clearTimeout:id=>timers.delete(id),setInterval(){return 0},clearInterval(){}});
 const run=code=>vm.runInContext(code,context);
 for(const file of ['app.js','russian-curriculum.js','russian.js','school-curriculum.js','school.js','players.js','mario-manual.js'])run(fs.readFileSync(__dirname+'/'+file,'utf8'));
 const tick=ms=>{const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn()}now=end};
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
 return {run,tick,flush,els,requests,storage,setFetch:fn=>{fetchImpl=fn}};
}
(async()=>{
 const savedQueue=JSON.stringify([{player:'server-owner',data:{kind:'round',id:'existing-server-round'}}]);
 const storage=new Map([['bunny-player-outbox',savedQueue]]),h=harness(undefined,storage);await h.flush();
 assert.equal(h.run('practiceMode'),true);assert.equal(h.requests.length,0,'Pages must not contact a LAN server or missing /api');
 assert.equal(h.els.get('app').classList.contains('auth-required'),false);assert.equal(h.run('phase'),'menu');
 assert.equal(h.els.get('mario-admin-play').hidden,true);assert.equal(h.els.get('mario-earned-play').hidden,true);
 // All existing math lengths, scoring and first-attempt rules still run on static hosting.
 for(const mode of ['compare','pattern','add','multiply','divide'])for(const count of [10,50,100]){
  h.run(`begin('${mode}',${count})`);
  for(let i=0;i<count;i++){h.run('choose(answer)');h.tick(1000);if(i<count-1&&(i+1)%10===0)h.tick(950)}
  assert.equal(h.run('phase'),'finished');assert.equal(h.run('score'),count);
 }
 h.run("begin('memory')");h.tick(1500);h.run("choose('bad')");h.tick(1800);h.tick(1500);h.run('choose(answer)');h.tick(1000);
 for(let i=1;i<50;i++){h.tick(1500);h.run('choose(answer)');h.tick(1000);if(i<49&&(i+1)%10===0)h.tick(950)}
 assert.equal(h.run('score'),49);assert.equal(h.run('activePlayer.rounds'),16);
 const rounds=h.run('activePlayer.rounds');h.run("savePracticeResult({kind:'round',id:activePlayer.completed.at(-1),score:10,total:10,topics:['add']})");assert.equal(h.run('activePlayer.rounds'),rounds);
 assert.equal(h.requests.length,0);assert.equal(storage.get('bunny-player-outbox'),savedQueue,'Server outbox must remain untouched');
 assert.equal(h.run('activePlayer.rewards'),undefined);assert.equal(h.run('Object.keys(activePlayer.stickers).length'),0);
 assert.equal(h.els.get('round-mario').hidden,true,'Local rounds cannot mint a server Mario ticket');
 const id=h.run('activePlayer.id'),reloaded=harness(undefined,storage);await reloaded.flush();assert.equal(reloaded.run('activePlayer.id'),id);assert.equal(reloaded.run('activePlayer.rounds'),16);
 // Create local learners with separate class ranges and preferences.
 reloaded.run(`openPracticePicker();var f=$('player-panel').children.find(e=>e.tagName==='FORM');f.children.find(e=>e.tagName==='LABEL').children[0].value='Юля';f.children.find(e=>e.tagName==='LABEL'&&e.children[0]?.tagName==='SELECT').children[0].value='1,2';f.onsubmit({preventDefault(){}})`);
 assert.equal(reloaded.run('activePlayer.name'),'Юля');assert.equal(reloaded.run('JSON.stringify(playerSchoolClasses())'),'[1,2]');
 reloaded.run("savePlayerPreference('bunny-russian-count','50');var juliaId=activePlayer.id;practiceStore.profiles.push(newPracticeProfile('Соня','🦊',[3,4]));choosePractice(practiceStore.profiles.at(-1))");
 assert.equal(reloaded.run('readPlayerPreference("bunny-russian-count","10")'),'10');assert.equal(reloaded.run('JSON.stringify(allowedRussianClasses())'),'[3,4]');
 reloaded.run('choosePractice(practiceStore.profiles.find(p=>p.id===juliaId))');assert.equal(reloaded.run('readPlayerPreference("bunny-russian-count","10")'),'50');
 // A failed home API offers practice; successful reconnection restores authenticated behavior.
 const home=harness('192.168.88.61',new Map([['bunny-player-outbox',savedQueue]]));await home.flush();assert.equal(home.run('practiceMode'),true);
 home.run("begin('add',10)");for(let i=0;i<10;i++){home.run('choose(answer)');home.tick(1000)}await home.flush();
 assert.equal(home.requests.length,1,'Practice results never POST to the home server');
 const remote={id:'other-owner',name:'Server learner',avatar:'🐰',schoolClasses:[3,4],preferences:{},rounds:9,correct:80,topics:[],best:{},stickers:{start:{x:25,y:35}},coins:8,rewards:{prices:{}}};
 home.setFetch(async url=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>url.includes('auth/status')?{configured:true,parent:false,player:remote}:[]}));
 await home.run('loadPlayerSession()');await home.flush();assert.equal(home.run('practiceMode'),false);assert.equal(home.run('activePlayer.id'),'other-owner');
 assert.equal(home.run('JSON.stringify(activePlayer.stickers)'),JSON.stringify(remote.stickers));assert.equal(home.storage.get('bunny-player-outbox'),savedQueue);
 assert.equal(home.requests.some(([,options])=>options?.method==='POST'),false);
 console.log('PASS static practice: no API/audio dependency, menu unlocked, all math lengths and scoring, memory retry, persisted local results, deduplication, separate learners/classes/preferences, no server awards or Mario tickets, untouched server outbox, home outage fallback and authenticated reconnection');
})().catch(e=>{console.error(e);process.exitCode=1});
