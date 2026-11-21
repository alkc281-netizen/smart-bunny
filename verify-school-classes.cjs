const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
let now=0,serial=0;const timers=new Map(),els=new Map();
function el(id=''){return {id,children:[],dataset:{},hidden:false,textContent:'',style:{setProperty(){}},className:'',classList:{toggle(){}},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},querySelector(){return this.children.find(c=>c.dataset?.russianBack)},remove(){},setAttribute(){},addEventListener(){},closest(){return null}}}
const document={getElementById(id){if(!els.has(id))els.set(id,el(id));return els.get(id)},createElement(){return el()},createTextNode(text){return {textContent:text}},querySelectorAll(){return []},addEventListener(){}};
class Audio{constructor(){this.events={};this.paused=false}addEventListener(n,f){this.events[n]=f}play(){return Promise.resolve()}pause(){this.paused=true}}
const prefs=new Map();const localStorage={getItem:k=>prefs.get(k)??null,setItem:(k,v)=>prefs.set(k,v)};
const ctx=vm.createContext({crypto:require("node:crypto").webcrypto,AbortSignal,fetch:()=>new Promise(()=>{}),localStorage,console,document,window:{addEventListener(){}},Audio,performance:{now:()=>now},setTimeout(fn,ms){timers.set(++serial,{fn,at:now+ms});return serial},clearTimeout(id){timers.delete(id)},setInterval(){return 0},clearInterval(){}});
vm.runInContext(fs.readFileSync('app.js','utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);function tick(ms){const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn()}now=end}
vm.runInContext(fs.readFileSync('russian-curriculum.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('russian.js','utf8'),ctx);

vm.runInContext(fs.readFileSync('players.js','utf8'),ctx);

for(const [name,classes] of [['Юля',[1,2]],['Соня',[3,4]]]) {
 run(`playerOutbox=[{player:'child',data:{kind:'preference',key:'bunny-russian-class',value:'${classes[0]===1?4:1}'}},{player:'other',data:{kind:'preference',key:'bunny-russian-class',value:'1'}}];writingPlayer=false;
 chooseActivePlayer({id:'child',name:${JSON.stringify(name)},avatar:'🐰',schoolClasses:${JSON.stringify(classes)},preferences:{'bunny-russian-class':'${classes[0]===1?4:1}'},topics:Object.keys(russianTopics),stickers:{},rounds:8,coins:3,rewards:{prices:{},day:'2026-11-17',mission:'koopa'}})`);
 assert.equal(run('russianClass'),classes[0]);
 assert.equal(run('playerOutbox.length'),1);
 assert.equal(run('playerOutbox[0].player'),'other');
 run('openRussianClasses()');
 assert.equal(run("$('russian-menu').children[0].children.map(b=>b.textContent).join(',')"),classes.map(c=>c+' класс').join(','));
 for(const grade of [1,2,3,4]) {
  const allowed=classes.includes(grade);
  run(`home();russianClass=${grade};russianStudiedByClass[${grade}] = new Set(Object.keys(russianTopics).filter(k=>(russianTopics[k].grade||1)===${grade}))`);
  const topic=run(`Object.keys(russianTopics).find(k=>(russianTopics[k].grade||1)===${grade})`);
  run(`beginRussian('${topic}')`);
  assert.equal(run('game'),allowed?'russian':null);
  run(`home();russianClass=${grade};beginRussianMixed()`);
  assert.equal(run('game'),allowed?'russian':null);
  if(allowed)assert.equal(run('russianDeck.every(item=>allowedRussianClasses().includes(russianTopics[item[4]].grade||1))'),true);
  run('home();beginRussianMixed(true)');
  if(!allowed)assert.equal(run('game'),null);
  run('home()');
  assert.equal(run('rewardTopics().every(k=>allowedRussianClasses().includes(russianTopics[k].grade||1))'),true);
  if(allowed){
   for(const key of ['mushroom','mario','chip','darkwing']){
    run(`activePlayer.rewards.conditions ||= {}; activePlayer.rewards.conditions['${key}']={type:stickerMissionTypes['${key}'],tier:'ordinary',count:10,required:7,stages:1,completedTopics:[],countCorrections:true};startRewardMission('${key}')`);
    assert.equal(run('game'),'mission');
    assert.equal(run('rewardRound.deck.filter(i=>russianTopics[i.topic]).every(i=>allowedRussianClasses().includes(russianTopics[i.topic].grade||1))'),true);
    run('home()');
   }
  }
 }
 run(`russianClass=${classes[0]};home();beginRussianMixed(false,true)`);
 assert.equal(run('game'),classes.includes(3)?'russian':null);
 const before=run("activePlayer.preferences['bunny-russian-class']");
 run(`savePlayerPreference('bunny-russian-class','${classes[0]===1?4:1}')`);
 assert.equal(run("activePlayer.preferences['bunny-russian-class']"),before);
 assert.equal(run('activePlayer.rounds'),8);
 assert.equal(run('activePlayer.coins'),3);
 console.log('PASS',name,classes,'class picker, stale preference cleanup, topic/mixed/review/mission isolation and unchanged rewards');
}
run("chooseActivePlayer({id:'parent',preferences:{},topics:[],stickers:{}})");
assert.equal(run('JSON.stringify(allowedRussianClasses())'),'[1,2,3,4]');
console.log('PASS unrestricted profiles retain all four classes');
