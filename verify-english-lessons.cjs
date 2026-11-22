// Real curriculum/navigation handlers; no live accounts or browser writes.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const harness=fs.readFileSync(__dirname+'/verify-school.cjs','utf8').split("const keys=run('Object.keys(schoolTopics)');")[0];
// Share the existing isolated DOM/clock harness, then assert English-specific behavior.
const tests=`
const english=run('englishBookLessons');assert.equal(english.length,41);
const legacy=run("Object.entries(schoolTopics).filter(([k,v])=>v.legacyEnglish).map(([k])=>k)");assert.equal(legacy.length,8);
for(const lesson of english){assert.ok(lesson.items.length>=8);assert.ok(lesson.pages&&lesson.focus);assert.ok(/^[a-zA-Z0-9]+$/.test(lesson.key));assert.equal(new Set(lesson.items.map(item=>JSON.stringify(item.slice(0,2)))).size,lesson.items.length);}
for(const [id,grades,grade,expected]of [['julia',[1,2],2,23],['sonya',[3,4],4,18]]){
 run('chooseActivePlayer('+JSON.stringify({id,name:id,avatar:'🐰',schoolClasses:grades,preferences:{},topics:[],stickers:{}})+')');
 run("openSchoolClasses('english');openSchoolTopics()");assert.equal(run('schoolClass'),grade);assert.equal(run('schoolClassTopics().length'),expected);
 assert.equal(run('schoolStudied.size'),0);assert.equal(run('englishSelection.size'),0);
 assert.ok(run("$('message').textContent.includes('Отмечать пройденный материал не требуется')"));
 run("$('school-menu').children[0].children[0].onclick()");
 assert.equal(run("$('heading').textContent"),'📖 Разделы учебника');
 run("$('school-menu').children[0].children[0].onclick()");
 run("$('school-menu').children[0].children[0].onclick()");
 assert.ok(run("$('hint').textContent.includes('Spotlight '+schoolClass)"));
 run("$('school-menu').children[0].children[0].onclick()");assert.equal(run('game'),'school');assert.equal(run('schoolStudied.size'),0,'Direct launch never requires a studied marker');
 const keys=run('schoolClassTopics()');for(const key of keys){run('beginSchoolTopic('+JSON.stringify(key)+')');assert.ok(run('schoolDeck.every(item=>item[4]==='+JSON.stringify(key)+')'));}
 run('home();openEnglishMix()');assert.equal(run("$('school-menu').children[0].children[0].disabled"),true);
 const chosen=keys[0],second=keys.at(-1);
 run('englishSelection=new Set('+JSON.stringify([chosen,second])+');saveEnglishSelection();loadEnglishSelection();schoolCount=50;beginSchoolMixed()');
 assert.equal(run('schoolDeck.length'),50);assert.ok(run('schoolDeck.every(item=>englishSelection.has(item[4]))'));
 assert.equal(run('new Set(schoolDeck.map(item=>item[4])).size'),2);assert.equal(run('schoolStudied.size'),0);
 assert.ok(run("playerOutbox.some(item=>item.player===activePlayer.id&&item.data.key==='bunny-school-english-selection'+schoolClass)"));
 const other=english.find(l=>l.grade!==grade).key;run('home();beginSchoolTopic('+JSON.stringify(other)+')');assert.equal(run('game'),null);
 run('schoolMistakes={['+JSON.stringify(chosen)+']:2};englishSelection.clear();beginSchoolMixed(true)');assert.equal(run('game'),'school');assert.ok(run('schoolDeck.every(item=>item[4]==='+JSON.stringify(chosen)+')'));
 run('home()');for(const key of legacy){run('beginSchoolTopic('+JSON.stringify(key)+')');assert.equal(run('game'),null,'Broad legacy banks cannot leak into the lesson picker');}
}
// A wrong question from the old topic must not silently become a newly chosen lesson.
run("schoolMistakes={en4family:99};schoolStudied=new Set(['en4family']);openEnglishMenu()");
assert.equal(run("$('school-menu').children[0].children[2].disabled"),true);
const lessonCode=(grade,code)=>english.find(l=>l.grade===grade&&l.code===code);
assert.ok(lessonCode(2,'1a').words.some(pair=>pair[0]==='chair'));
assert.ok(!lessonCode(2,'1a').items.some(item=>/bedroom|bathroom|kitchen|don't|has got/.test(item[0])),'Early home lesson excludes later rooms/grammar');
assert.ok(lessonCode(4,'3a').items.some(item=>item[0].includes('Where does')));
assert.ok(!lessonCode(4,'3a').items.some(item=>/have to|quarter|twice/.test(item[0])),'Workplace lesson excludes later obligation/time material');
assert.ok(lessonCode(4,'4b').items.some(item=>item[0].includes('have to')));
assert.ok(lessonCode(4,'8b').items.some(item=>item[0].includes('must')));
console.log('PASS English: 41 mapped lessons; direct free choice; module/lesson launch; selected-only mixing without studied markers; profile class isolation; legacy records retained and excluded; lesson grammar boundaries; saved selections; review without prerequisites');
`;
new Function('require',harness+tests)(require);
