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
}
console.log('PASS mixed mission UI: both grades, 20/30/50 questions, 3 subjects, 2 topics each, distinct exercises, first-answer evidence, no sticker mission crossover');
`;
new Function('require','__dirname',harness+tests)(require,__dirname);
