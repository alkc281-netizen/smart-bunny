const fs=require('node:fs');
const harness=fs.readFileSync(__dirname+'/verify-school.cjs','utf8').split('const keys=run')[0];
const tests=`
for(const [name,classes,base,required] of [['Julia',[1,2],20,16],['Sonya',[3,4],30,26]]) {
 run('chooseActivePlayer('+JSON.stringify({id:name,name,avatar:'🐰',schoolClasses:classes,preferences:{},topics:[],stickers:{}})+')');
 run('openMarioMission()');
 const panel=run("$('player-panel')");
 const walk=(el,predicate)=>[...(predicate(el)?[el]:[]),...(el.children||[]).flatMap(child=>walk(child,predicate))];
 const button=walk(panel,el=>el.textContent==='▶ Начать миссию')[0];
 assert.ok(button);
 button.onclick();
 assert.equal(run('game'),'marioMission');assert.equal(run('roundQuestionCount()'),base);
 const deck=run('rewardRound.deck');
 assert.equal(new Set(deck.map(item=>item.subject)).size,3);
 assert.ok(deck.every(item=>classes.includes(item.grade)));
 for(const subject of new Set(deck.map(item=>item.subject)))assert.ok(new Set(deck.filter(item=>item.subject===subject).map(item=>item.topic)).size>=2);
 for(let i=0;i<base;i++){run('choose(rewardRound.deck[round].correct)');tick(2200);}
 assert.equal(run('phase'),'finished');assert.equal(run('score'),base);
 const event=run('playerOutbox.filter(item=>item.data.kind==="round").at(-1).data');
 assert.equal(event.marioMission.length,base);assert.ok(event.marioMission.every(item=>item.correct));
 assert.equal(event.mission,undefined,'Mario mission never redeems a character mission');
 run('openMarioMission()');
 const nextPanel=run("$('player-panel')"),select=walk(nextPanel,el=>el.children?.some(option=>option.textContent==='50'))[0];
 assert.ok(select);select.value='50';
 walk(nextPanel,el=>el.textContent==='▶ Начать миссию')[0].onclick();
 assert.equal(run('roundQuestionCount()'),50);
 assert.equal(run('rewardRound.rule.required'),name==='Julia'?40:44);
 assert.equal(new Set(run('rewardRound.deck.map(item=>JSON.stringify([item.question,item.correct,item.table]))')).size,50,'no repeated questions in the fifty-question sample');
 // A correction does not turn an incorrect first attempt into earned accuracy.
 run('choose("WRONG")');
 assert.equal(run('rewardRound.deck[0].firstCorrect'),false);
 run('attempt=2;phase="answer";choose(rewardRound.deck[0].correct)');tick(1200);
 assert.equal(run('score'),0);assert.equal(run('rewardRound.corrected'),1);

 // Reproduce the phone screenshot: only math and Russian selected, while scrolled
 // down to Start. Validation belongs beside that button, not the top message.
 run('openMarioMission()');
 const invalidPanel=run("$('player-panel')"),groups=walk(invalidPanel,el=>el.className==='mario-mission-subject');
 const enable=group=>walk(group,el=>el.type==='checkbox')[0];
 const start=walk(invalidPanel,el=>el.textContent==='▶ Начать миссию')[0];
 const status=walk(invalidPanel,el=>el.id==='mario-mission-selection-status')[0];
 assert.ok(status);assert.ok(invalidPanel.children.indexOf(status)>invalidPanel.children.indexOf(start));
 let focus=0,scroll=0;status.focus=()=>focus++;status.scrollIntoView=()=>scroll++;
 enable(groups[2]).checked=false;enable(groups[2]).onchange();
 assert.match(status.textContent,/2 из 3/);assert.match(status.textContent,/ещё один/);
 start.onclick();assert.equal(run('phase'),'mario-mission-menu');assert.equal(focus,1);assert.equal(scroll,1);
 assert.match(status.textContent,/Окружающий мир/);assert.match(status.textContent,/Английский язык/);
 enable(groups[3]).checked=true;enable(groups[3]).onchange();
 assert.match(status.textContent,/Можно начинать/);
 start.onclick();assert.equal(run('game'),'marioMission');assert.equal(run('phase'),'answer');
 assert.ok(run('rewardRound.deck.some(item=>item.subject==="english")'),'third-subject choice is used in the real deck');

 run('openMarioMission()');
 const fourPanel=run("$('player-panel')"),fourGroups=walk(fourPanel,el=>el.className==='mario-mission-subject');
 const fourStatus=walk(fourPanel,el=>el.id==='mario-mission-selection-status')[0];
 const fourStart=walk(fourPanel,el=>el.textContent==='▶ Начать миссию')[0];
 enable(fourGroups[3]).checked=true;enable(fourGroups[3]).onchange();fourStart.onclick();
 assert.match(fourStatus.textContent,/4 предмета/);assert.equal(run('phase'),'mario-mission-menu');
 enable(fourGroups[3]).checked=false;enable(fourGroups[3]).onchange();
 const russianChecks=walk(fourGroups[1],el=>el.type==='checkbox').slice(1);
 for(const checkbox of russianChecks)checkbox.checked=false;
 russianChecks[0].checked=true;russianChecks[0].onchange();fourStart.onclick();
 assert.match(fourStatus.textContent,/минимум две темы/);assert.match(fourStatus.textContent,/Русский язык/);
 assert.equal(walk(fourGroups[1],el=>el.children?.some(child=>child.textContent?.startsWith('Выбрать темы')))[0].open,true);
 russianChecks[1].checked=true;russianChecks[1].onchange();fourStart.onclick();
 assert.equal(run('phase'),'answer');assert.equal(run('roundQuestionCount()'),base);
}
console.log('PASS mixed mission UI: both grades, 20/30/50 questions, inline 2/3-subject validation beside Start with focus/scroll, third-subject recovery and real launch, 4-subject rejection, topic shortage and recovery; unchanged scoring/rewards');
`;
new Function('require','__dirname',harness+tests)(require,__dirname);
