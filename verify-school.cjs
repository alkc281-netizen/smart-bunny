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

vm.runInContext(fs.readFileSync('school-curriculum.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('school.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('players.js','utf8'),ctx);

const keys=run('Object.keys(schoolTopics)');assert.equal(keys.length,39);
let total=0;
for(const key of keys){const topic=run(`schoolTopics['${key}']`);assert.ok([2,4].includes(topic.grade));assert.ok(['math','english','world'].includes(topic.subject));assert.ok(/^[a-zA-Z0-9]+$/.test(key));assert.ok(topic.rule.length>20);const seen=new Set();
 for(const [prompt,correct,choices,why] of topic.items){assert.ok(prompt&&why);assert.ok(choices.includes(correct));assert.equal(new Set(choices).size,choices.length);assert.ok(choices.length>=2);assert.ok(!seen.has(prompt));seen.add(prompt);total++;}
}
assert.ok(total>2000);
for(const subject of ['english','world'])for(const grade of [2,4]){
 const bank=run(`Object.values(schoolTopics).filter(t=>t.subject==='${subject}'&&t.grade===${grade}).flatMap(t=>t.items)`);
 assert.ok(bank.length>=50,'enough distinct exercises for a mixed 50-question round');
 assert.ok(bank.some(([prompt])=>prompt.includes('\n\n')),'includes a passage with a separate question');
}
const sample=run("schoolTopics.math4area.items.find(([prompt])=>prompt.startsWith('Прямоугольная площадка 14 м на 12 м.'))");
assert.equal(sample[1],'126','three quarters of a 14 by 12 metre rectangle');
run("chooseActivePlayer({id:'junior',name:'Тест',avatar:'🐰',schoolClasses:[1,2],preferences:{},topics:[],stickers:{}})");
run("$('game-menu').children[0].onclick()");assert.equal(run('phase'),'math-modes');assert.equal(run("$('math-games').children.length"),7);
run("$('math-games').children[0].onclick()");assert.equal(run('game'),'memory');assert.equal(run('roundQuestionCount()'),50);run('home()');
for(const [id,range,grade] of [['junior',[1,2],2],['senior',[3,4],4]]){
 run(`chooseActivePlayer({id:'${id}',name:'Тест',avatar:'🐰',schoolClasses:${JSON.stringify(range)},preferences:{},topics:[],stickers:{}})`);
 for(const subject of ['math','english','world']){
  run(`openSchoolClasses('${subject}')`);assert.equal(run('schoolClass'),grade);assert.equal(run('JSON.stringify(schoolAllowedClasses())'),JSON.stringify([grade]));
  assert.equal(run("$('school-menu').children[0].children[0].textContent"),grade+' класс · часть 1');
  run('openSchoolTopics()');assert.equal(run('schoolStudied.size'),0);assert.equal(run("$('school-menu').children[0].children[1].disabled"),true);
  run('beginSchoolMixed()');assert.equal(run('game'),null);
  const topics=run('schoolClassTopics()');
  for(const topic of topics){
   run(`schoolCount=10;beginSchoolTopic('${topic}')`);assert.equal(run('roundQuestionCount()'),10);
   for(let i=0;i<10;i++){run('choose(answer);choose(answer)');tick(1200)}
   assert.equal(run('phase'),'finished');assert.equal(run('score'),10);assert.equal(run("$('heading').textContent"),'Оценка: 5');assert.equal(run('playerOutbox.at(-1).data.topics[0]'),topic);
  }
  run('schoolStudied=new Set(schoolClassTopics())');
  for(const count of [10,50,100]){
   run(`schoolCount=${count};beginSchoolMixed()`);assert.equal(run('schoolDeck.length'),count);assert.ok(run('schoolDeck.every(item=>schoolTopics[item[4]].grade===schoolClass&&schoolTopics[item[4]].subject===schoolSubject)'));
   const distinct = Math.min(count, topics.reduce((n,key)=>n+run(`schoolTopics['${key}'].items.length`),0));
   assert.equal(new Set(run(`schoolDeck.slice(0,${distinct}).map(item=>item[0])`)).size,distinct);
   run("choose('incorrect')");tick(60000);assert.equal(run('phase'),'feedback');assert.equal(run('round'),0);
   run('openSettings()');tick(60000);run('settingsBack()');assert.equal(run('phase'),'feedback');
   run("$('answers').children[0].onclick()");assert.equal(run('attempt'),2);run("choose('incorrect')");tick(60000);assert.equal(run('round'),0);
   const proceed=run("$('answers').children[0].onclick");proceed();proceed();assert.equal(run('round'),1);
   for(let i=1;i<count;i++){run('choose(answer)');tick(1200);if(i<count-1&&(i+1)%10===0)tick(950)}
   assert.equal(run('phase'),'finished');assert.equal(run('score'),count-1);assert.equal(run('playerOutbox.at(-1).data.total'),count);
  }
  run('schoolCount=10;beginSchoolMixed(true)');assert.equal(run('game'),'school');assert.ok(run('schoolDeck.every(item=>schoolMistakes[item[4]]>0)'));
  run("choose('incorrect');$('answers').children[0].onclick();choose(answer)");tick(1200);assert.equal(run('schoolCorrected'),1);assert.equal(run('score'),0);run('home()');
  const forbidden=run(`Object.keys(schoolTopics).find(k=>schoolTopics[k].subject==='${subject}'&&schoolTopics[k].grade!==${grade})`);
  run(`beginSchoolTopic('${forbidden}')`);assert.equal(run('game'),null);
 }
}
run("loadSchoolSubject('math');schoolCount=10");
const key=run('schoolClassTopics()[0]');run(`schoolSave('bunny-school-history-${key}','{}')`);
const first=run(`pickSchoolItems('${key}',10).map(i=>i[0])`),second=run(`pickSchoolItems('${key}',10).map(i=>i[0])`);
assert.equal(new Set(first).size,10);assert.ok(second.every(q=>!first.includes(q)));
console.log('PASS 39 topics, reasoning exercises, mixed deck uniqueness, profile class ranges, 10/50/100 rounds, explanations, retries and rewards');
