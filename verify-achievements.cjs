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

const {spawnSync}=require('node:child_process');
const fixture=spawnSync('python3',['-c',`import importlib.util,json
from pathlib import Path
s=importlib.util.spec_from_file_location('b','tool/bunny-server.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
p=b.initial_profile();p['stickerPolicy']='junior-v1';j=b.player_view('j','Юля','🌸',p,True,True)
p.pop('stickerPolicy');a=b.player_view('s','Соня','🦊',p,True,True)
print(json.dumps(dict(grades=b.REWARD_TOPIC_GRADES,junior=j['rewards'],standard=a['rewards'])))`],{encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);const data=JSON.parse(fixture.stdout);
assert.deepEqual(JSON.parse(run('JSON.stringify(Object.fromEntries(Object.entries(russianTopics).map(([k,t])=>[k,t.grade||1])))')),data.grades);
for(const [name,classes,rewards]of [['Юля',[1,2],data.junior],['Соня',[3,4],data.standard]]){
 run(`chooseActivePlayer({id:'test',name:${JSON.stringify(name)},schoolClasses:${JSON.stringify(classes)},preferences:{},topics:Object.keys(russianTopics),stickers:{},coins:20,rewards:${JSON.stringify(rewards)}})`);
 for(const grade of classes){
  run(`russianClass=${grade};russianStudiedByClass[${grade}]=new Set(Object.keys(russianTopics).filter(k=>(russianTopics[k].grade||1)===${grade}))`);
  for(const key of Object.keys(rewards.conditions)){
   run(`home();startRewardMission('${key}')`);
   assert.equal(run('game'),'mission',key);
   assert.equal(run('rewardRound.deck.length'),rewards.conditions[key].count);
   assert.ok(run('rewardRound.deck.filter(i=>russianTopics[i.topic]).every(i=>(russianTopics[i.topic].grade||1)===russianClass)'));
   if(rewards.conditions[key].stages===2){
    const first=run('rewardRound.deck[0].topic');
    assert.ok(run('rewardRound.deck.every(i=>i.topic===rewardRound.deck[0].topic)'));
    run(`home();activePlayer.rewards.conditions['${key}'].completedTopics=[${JSON.stringify(first)}];startRewardMission('${key}')`);
    assert.notEqual(run('rewardRound.deck[0].topic'),first,'Second stage must change topic');
    run(`activePlayer.rewards.conditions['${key}'].completedTopics=[]`);
   }
  }
 }
}
run(`chooseActivePlayer({id:'j',name:'Юля',schoolClasses:[1,2],preferences:{},topics:['zhi','cha'],stickers:{},coins:20,rewards:${JSON.stringify(data.junior)}});russianClass=1;startRewardMission('koopa');writingPlayer=true;`);
// Two first-attempt errors are corrected; academic score remains 8/10.
for(let i=0;i<10;i++){
 assert.equal(run('phase'),'answer');
 if(i<2){run(`choose('__wrong__')`);const continueButton=run("$('answers').children[0]");continueButton.onclick();assert.equal(run('attempt'),2);}
 run('choose(rewardRound.deck[round].correct)');tick(1000);
}
assert.equal(run('score'),8);assert.equal(run('rewardRound.corrected'),2);assert.equal(run('phase'),'finished');
const out=JSON.parse(run('JSON.stringify(playerOutbox.at(-1).data)'));
assert.equal(out.rewardVersion,2);assert.equal(out.missionClass,1);assert.equal(out.score,8);assert.equal(out.corrected,2);assert.equal(out.total,10);
const parent=el();run('home()');ctx.testParent=parent;run('renderMarioCollection(testParent);renderAlbumDecorations(testParent)');
function texts(node){return [node.textContent,...node.children.flatMap(texts)];}
assert.ok(!texts(parent).some(t=>t?.includes('Обменять за')),'Character exchange buttons removed');
assert.ok(texts(parent).some(t=>t?.includes('Космос')),'Cosmetics available');
console.log('PASS reward UI: server/client curriculum parity, every character at both class ranges, distinct stage decks, 10/20/30 lengths, retry payload and unchanged first-attempt scoring, cosmetics instead of character shop');
