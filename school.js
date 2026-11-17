'use strict';
const schoolSubjects = {math:['🔢','Математика'],english:['🇬🇧','Английский язык'],world:['🌍','Окружающий мир']};
let schoolSubject='math',schoolClass=2,schoolCount=10,schoolStudied=new Set(),schoolMistakes={};
let schoolDeck=[],schoolMode='topic',schoolTopic=null,schoolCorrected=0,schoolStats={};
function schoolAllowedClasses(){return (typeof playerSchoolClasses==='function'?playerSchoolClasses():[1,2,3,4]).filter(c=>c===2||c===4)}
function schoolRead(key,fallback){if(typeof readPlayerPreference==='function')return readPlayerPreference(key,fallback);try{return localStorage.getItem(key)??fallback}catch{return fallback}}
function schoolSave(key,value){if(typeof savePlayerPreference==='function')savePlayerPreference(key,String(value));else try{localStorage.setItem(key,String(value))}catch{}}
function schoolKey(setting){return 'bunny-school-'+schoolSubject+'-'+setting}
function loadSchoolSubject(subject){
 schoolSubject=subject;
 schoolClass=Number(schoolRead(schoolKey('class'),'2'));
 if(!schoolAllowedClasses().includes(schoolClass))schoolClass=schoolAllowedClasses()[0];
 schoolCount=Number(schoolRead(schoolKey('count'),'10'));
 if(![10,50,100].includes(schoolCount))schoolCount=10;
 schoolMistakes={};
 try{const saved=JSON.parse(schoolRead(schoolKey('mistakes'),'{}'));if(saved&&typeof saved==='object'&&!Array.isArray(saved))for(const [key,n] of Object.entries(saved))if(schoolTopics[key]?.subject===subject&&Number.isFinite(n)&&n>0)schoolMistakes[key]=Math.min(1000,Math.floor(n))}catch{}
 loadSchoolStudied();
}
function loadSchoolStudied(){
 schoolStudied=new Set();
 try{const saved=JSON.parse(schoolRead(schoolKey('studied'+schoolClass),'[]'));if(Array.isArray(saved))schoolStudied=new Set(saved.filter(key=>schoolTopics[key]?.subject===schoolSubject&&schoolTopics[key]?.grade===schoolClass))}catch{}
}
function schoolClassTopics(){return schoolAllowedClasses().includes(schoolClass)?Object.keys(schoolTopics).filter(key=>schoolTopics[key].subject===schoolSubject&&schoolTopics[key].grade===schoolClass):[]}
function schoolScreen(title,hint){home();setVisible('game-menu',false);setVisible('school-menu',true);$('heading').textContent=title;$('hint').textContent=hint;message('');$('school-menu').replaceChildren();const box=playerElement('div','',$('school-menu'));box.className='russian-options';return box}
function openMathMenu(){
 home();phase='math-modes';setVisible('game-menu',false);setVisible('math-modes',true);
 $('heading').textContent='🔢 Математика';$('hint').textContent='Выбери тренировку или задания по учебнику';message('');
}
function openSchoolClasses(subject){
 if(!schoolSubjects[subject])return;
 loadSchoolSubject(subject);
 const [icon,name]=schoolSubjects[subject];
 const box=schoolScreen(icon+' '+name,'Выбери учебник');phase='school-classes';
 for(const grade of schoolAllowedClasses()){
  const b=playerButton(box,grade+' класс · часть 1',()=>{schoolClass=grade;schoolSave(schoolKey('class'),grade);loadSchoolStudied();openSchoolTopics()});
  b.setAttribute('aria-pressed',String(grade===schoolClass));
 }
 if(!schoolAllowedClasses().length)message('Для этого профиля пока нет учебника выбранного класса.');
 playerButton(box,subject==='math'?'← Математика':'← Предметы',subject==='math'?openMathMenu:home).className='wide';
}
function openSchoolTopics(){
 if(!schoolAllowedClasses().includes(schoolClass)){openSchoolClasses(schoolSubject);return;}
 const keys=schoolClassTopics(),[icon,name]=schoolSubjects[schoolSubject];
 const box=schoolScreen(icon+' '+name,schoolClass+' класс · часть 1');phase='school-topics';
 playerButton(box,'По темам',openSchoolTopicList);
 const mixed=playerButton(box,'Смешанная тренировка',()=>beginSchoolMixed(false));mixed.disabled=!schoolStudied.size;
 const weak=keys.filter(key=>schoolStudied.has(key)&&schoolMistakes[key]>0);
 const review=playerButton(box,'Работа над ошибками'+(weak.length?' · '+weak.length+' тем':''),()=>beginSchoolMixed(true));review.disabled=!weak.length;
 playerButton(box,'Пройденные темы · '+schoolStudied.size,openSchoolStudied);
 playerButton(box,'← Выбрать учебник',()=>openSchoolClasses(schoolSubject)).className='wide';
 const label=playerElement('p','Количество вопросов',$('school-menu'));label.className='hint';
 const counts=playerElement('div','',$('school-menu'));counts.className='russian-options';
 for(const count of [10,50,100]){const b=playerButton(counts,count+' вопросов',()=>{schoolCount=count;schoolSave(schoolKey('count'),count);openSchoolTopics()});b.setAttribute('aria-pressed',String(count===schoolCount))}
 message(keys.length+' тем · '+keys.reduce((sum,key)=>sum+schoolTopics[key].items.length,0)+' заданий. '+(schoolStudied.size?'Смешанная тренировка использует отмеченные темы.':'Отметь пройденные темы для смешанной тренировки.'));
}
function openSchoolTopicList(){
 const box=schoolScreen('📖 Темы учебника',schoolSubjects[schoolSubject][1]+' · '+schoolClass+' класс');phase='school-topics';
 for(const key of schoolClassTopics()){const topic=schoolTopics[key];playerButton(box,topic.name,()=>beginSchoolTopic(key))}
 playerButton(box,'← Виды тренировок',openSchoolTopics).className='wide';
}
function openSchoolStudied(){
 const box=schoolScreen('Пройденные темы','Отметь только то, что уже разобрали на уроках');phase='school-topics';
 for(const key of schoolClassTopics()){
  const b=playerButton(box,schoolTopics[key].name,()=>{
   if(schoolStudied.has(key))schoolStudied.delete(key);else schoolStudied.add(key);
   schoolSave(schoolKey('studied'+schoolClass),JSON.stringify([...schoolStudied]));
   b.setAttribute('aria-pressed',String(schoolStudied.has(key)));message('Отмечено тем: '+schoolStudied.size);
  });b.setAttribute('aria-pressed',String(schoolStudied.has(key)));
 }
 playerButton(box,'Готово',openSchoolTopics).className='wide';message('Отмечено тем: '+schoolStudied.size);
}
function schoolItemId(item) {
 const [prompt,correct,,,table]=item;
 return JSON.stringify(table ? [prompt,correct,table] : [prompt,correct]);
}
function pickSchoolItems(key,count){
 const items=schoolTopics[key].items,ids=items.map(schoolItemId);
 let history={};try{history=JSON.parse(schoolRead('bunny-school-history-'+key,'{}'))||{}}catch{}
 const valid=new Set(ids),seen=new Set(Array.isArray(history.seen)?history.seen.filter(id=>valid.has(id)):[]);
 const recent=Array.isArray(history.last)?history.last.filter(id=>valid.has(id)).slice(-10):[],deck=[];
 const usedInRound = new Set();
 while(deck.length<count){
  if (usedInRound.size === items.length) usedInRound.clear();
  let available=items.filter((_,i)=>!seen.has(ids[i])&&!usedInRound.has(ids[i]));
  if(!available.length){seen.clear();available=items.filter((_,i)=>!usedInRound.has(ids[i]))}
  const fresh=available.filter(item=>!recent.includes(schoolItemId(item)));
  const next=shuffledRussian(fresh.length?fresh:available)[0],id=schoolItemId(next);
  const [prompt,correct,choices,explanation,table]=next;
  deck.push([prompt,correct,choices,explanation,key,table]);seen.add(id);usedInRound.add(id);recent.push(id);if(recent.length>10)recent.shift();
 }
 schoolSave('bunny-school-history-'+key,JSON.stringify({seen:[...seen],last:recent}));return deck;
}
function beginSchoolTopic(key){if(!schoolClassTopics().includes(key))return;launchSchoolRound(pickSchoolItems(key,schoolCount),'topic',key)}
function beginSchoolMixed(review=false){
 const keys=schoolClassTopics().filter(key=>schoolStudied.has(key)&&(!review||schoolMistakes[key]>0));
 if(!keys.length){openSchoolStudied();return;}
 const order=[];
 let remaining=new Map(),last=null;
 while(order.length<schoolCount){
  if(!remaining.size)remaining=new Map(keys.map(key=>[key,schoolTopics[key].items.length]));
  const cycle=shuffledRussian([...remaining.keys()]);
  if(cycle.length>1&&cycle[0]===last)[cycle[0],cycle[1]]=[cycle[1],cycle[0]];
  for(const key of cycle){
   if(order.length===schoolCount)break;
   order.push(key);last=key;
   const left=remaining.get(key)-1;
   if(left>0)remaining.set(key,left);else remaining.delete(key);
  }
 }
 const queues={};for(const key of keys){const count=order.filter(k=>k===key).length;if(count)queues[key]=pickSchoolItems(key,count)}
 launchSchoolRound(order.map(key=>queues[key].shift()),review?'mistakes':'mixed',null);
}
function launchSchoolRound(deck,mode,topic){
 if(!deck.length||deck.some(item=>!schoolClassTopics().includes(item[4])))return;
 schoolDeck=deck;schoolMode=mode;schoolTopic=topic;schoolCorrected=0;schoolStats={};
 gameMusic.school={math:1,english:2,world:0}[schoolSubject];begin('school');
}
function renderSchoolTable(data) {
 const table=$('school-table');
 table.replaceChildren();
 setVisible('school-table',Boolean(data));
 if(!data)return;
 playerElement('caption',data.caption,table);
 const headings=playerElement('tr','',playerElement('thead','',table));
 for(const label of data.headers) playerElement('th',label,headings).scope='col';
 const body=playerElement('tbody','',table);
 for(const [label,value] of data.rows){
  const row=playerElement('tr','',body);
  playerElement('th',label,row).scope='row';
  playerElement('td',String(value),row);
 }
}
function renderSchoolQuestion(){
 const [prompt,correct,choices,,key,table]=schoolDeck[round],topic=schoolTopics[key];
 phase='answer';answer=correct;$('heading').textContent=schoolMode==='topic'?topic.name:schoolMode==='mistakes'?'Работа над ошибками':'Смешанная тренировка';
 $('hint').textContent=schoolSubjects[schoolSubject][1]+' · '+schoolClass+' класс'+(schoolMode==='topic'?'':' · '+topic.name)+(attempt===2?' · Вторая попытка':'');
 message(prompt);$('message').classList.toggle('russian-question',true);setVisible('russian-detail',false);
 renderSchoolTable(table);
 $('answers').replaceChildren();
 const longChoices=choices.some(choice=>choice.length>34);
 for(const choice of shuffledRussian(choices)){
  const button=playerButton($('answers'),choice,()=>choose(choice));
  if(longChoices)button.style.gridColumn='1 / -1';
 }
 setVisible('answers',true);setAudioLevel();
}
function schoolTask(){cancelTask();mood();attempt=1;stats();panels();setVisible('stats',true);setVisible('progress',true);renderSchoolQuestion()}
function schoolChoose(value){
 if(phase!=='answer')return;phase='feedback';setVisible('answers',false);
 const [,correct,,,key]=schoolDeck[round],topic=schoolTopics[key],stat=schoolStats[key]||(schoolStats[key]={total:0,correct:0,corrected:0});
 if(attempt===1){stat.total++;if(value===correct){stat.correct++;if(schoolMode==='mistakes')schoolMistakes[key]=Math.max(0,(schoolMistakes[key]||0)-1)}else schoolMistakes[key]=(schoolMistakes[key]||0)+1;schoolSave(schoolKey('mistakes'),JSON.stringify(schoolMistakes))}
 else if(value===correct)stat.corrected++;
 if(value===correct){setVisible('school-table',false);if(attempt===1)score++;else schoolCorrected++;$('score').textContent='⭐ '+score;mood('happy');sound('coin');message(attempt===1?'Правильно! +1 балл':'Ты исправил ошибку!');wait(1200,nextTask);return;}
 mood('sad');sound('wrong');message('Правильный ответ: '+correct);$('hint').textContent='Разберём задание';
 $('russian-detail').className='hint russian-rule';$('russian-detail').textContent=schoolDeck[round][3]+'\n\n'+topic.rule;setVisible('russian-detail',true);
 const deck=schoolDeck,task=round;let confirmed=false;$('answers').replaceChildren();
 playerButton($('answers'),'Продолжить',()=>{if(confirmed||game!=='school'||schoolDeck!==deck||round!==task||phase!=='feedback')return;confirmed=true;phase='transition';if(attempt===2){setVisible('school-table',false);nextTask()}else{attempt=2;sound('retry');renderSchoolQuestion()}}).className='wide';setVisible('answers',true);
}
function schoolFinish(){
 cancelTask();phase='finished';mood('party');panels();setVisible('finished',true);$('progress-fill').style.width='100%';$('counter').textContent='Раунд завершён';
 $('heading').textContent='Оценка: '+russianGrade(score,schoolDeck.length);$('hint').textContent=schoolSubjects[schoolSubject][1]+' · '+schoolClass+' класс';
 message('Верно сразу: '+score+' из '+schoolDeck.length+' · Исправлено: '+schoolCorrected);
 const detail=$('russian-detail');detail.className='hint russian-rule';detail.textContent=Object.entries(schoolStats).map(([key,stat])=>schoolTopics[key].name+': '+stat.correct+' из '+stat.total+'; исправлено '+stat.corrected).join('\n');setVisible('russian-detail',true);
 const back=playerElement('div','',$('finished'));back.dataset.schoolBack='true';playerButton(back,'← К тренировкам',openSchoolTopics).className='wide';victorySound();
}
window.bunnySchool={count:()=>schoolDeck.length,task:schoolTask,answer:schoolChoose,finish:schoolFinish,
 load:()=>loadSchoolSubject('math'),topics:()=>Object.keys(schoolStats),review:()=>schoolMode==='mistakes',corrected:()=>schoolCorrected};
const schoolBasePanels=panels;
panels=function(){schoolBasePanels();if(game!=='school'||!['settings','finished'].includes(phase))$('finished').querySelector('[data-school-back]')?.remove()};
const schoolBaseReplay=$('replay').onclick;
$('replay').onclick=()=>game!=='school'?schoolBaseReplay():schoolMode==='topic'?beginSchoolTopic(schoolTopic):beginSchoolMixed(schoolMode==='mistakes');
russianButton($('game-menu'),'🇬🇧 Английский язык',()=>openSchoolClasses('english'));
russianButton($('game-menu'),'🌍 Окружающий мир',()=>openSchoolClasses('world'));
russianButton($('math-games'),'📖 По учебнику',()=>openSchoolClasses('math')).className='wide';
