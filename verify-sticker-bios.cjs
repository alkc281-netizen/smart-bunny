const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();let requests=0,focusReturns=0;
function el(tag='div'){
 return {tagName:tag,children:[],dataset:{},attributes:{},style:{setProperty(){}},className:'',textContent:'',classList:{toggle(){}},
 append(...items){for(const item of items){this.children.push(item);item.parent=this}},replaceChildren(){this.children=[]},
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)},setAttribute(k,v){this.attributes[k]=v},
 addEventListener(){},querySelector(){return null},closest(){return null},showModal(){this.open=true},close(){this.open=false;this.onclose?.()},
 getBoundingClientRect(){return {left:0,top:0,right:400,bottom:600}}};
}
const opener={isConnected:true,focus(){focusReturns++}};
const document={activeElement:opener,getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id)},createElement:el,createTextNode:text=>({textContent:text,children:[]}),querySelectorAll:()=>[],addEventListener(){}};
const ctx=vm.createContext({document,console,crypto:require('node:crypto').webcrypto,AbortSignal,fetch(){requests++;return new Promise(()=>{})},localStorage:{getItem(){return null},setItem(){}},window:{addEventListener(){}},performance:{now:()=>0},setTimeout(){return 0},clearTimeout(){},setInterval(){return 0},clearInterval(){},Audio:class{addEventListener(){}pause(){}play(){return Promise.resolve()}}});
const run=code=>vm.runInContext(code,ctx);
for(const file of ['app.js','russian-curriculum.js','russian.js','players.js'])run(fs.readFileSync(file,'utf8'));
run('stickerArt=()=>{}'); // Image loading is independent of the description dialog.
const catalog=JSON.parse(fs.readFileSync('sticker-catalog.json','utf8'));
const described=catalog.stickers.filter(e=>e.enabled&&e.bio);
assert.equal(described.length,catalog.stickers.filter(e=>e.enabled&&e.collection!=='basic').length);
assert.ok(catalog.stickers.filter(e=>e.enabled&&e.collection!=='basic').every(e=>e.bio),'Every available character must have a description');
function texts(n){return [n.textContent,...n.children.flatMap(texts)].filter(Boolean)}
for(const entry of described){
 run(`activePlayer={id:'test',coins:9,stickers:{coin:{boardX:345,boardY:678}},rewards:{conditions:{}}}`);
 const before=run('JSON.stringify(activePlayer)'),networkBefore=requests;
 run(`showStickerDetail(${JSON.stringify(entry.id)})`);
 const dialog=run('stickerDialog'),content=texts(dialog);
 assert.ok(dialog.open);
 for(const value of Object.values(entry.bio))assert.ok(content.includes(value),entry.id);
 assert.ok(content.includes('Как получить наклейку'));
 assert.ok(content.includes('Пока не получена'));
 const bioIndex=dialog.children.findIndex(n=>n.className==='sticker-bio');
 const rewardIndex=dialog.children.findIndex(n=>n.className==='sticker-reward-heading');
 assert.ok(rewardIndex>bioIndex);
 assert.equal(dialog.attributes['aria-describedby'],'sticker-bio-intro');
 assert.equal(run('JSON.stringify(activePlayer)'),before);
 assert.equal(requests,networkBefore,'Viewing must not write progress');
 let prevented=false;dialog.onkeydown({key:'Escape',preventDefault(){prevented=true}});
 assert.ok(prevented);assert.equal(run('stickerDialog'),null);
 run(`activePlayer.stickers[${JSON.stringify(entry.id)}]=null;showStickerDetail(${JSON.stringify(entry.id)})`);
 assert.ok(texts(run('stickerDialog')).includes('Получена · есть в твоей коллекции'));
 run('stickerDialog.close()');
}
run("showStickerDetail('start')");assert.ok(!texts(run('stickerDialog')).includes('Как получить наклейку'));run('stickerDialog.close()');
// Catalog text remains literal text, including characters that could otherwise create markup.
const payload='<img src=x onerror=alert(1)>';
run(`stickerBiographies.ddrockerduck.fact=${JSON.stringify(payload)};showStickerDetail('ddrockerduck')`);
assert.ok(texts(run('stickerDialog')).includes(payload));
assert.equal(run("stickerDialog.children.find(n=>n.className==='sticker-bio').children.at(-1).children.at(-1).tagName"),'span');
run('stickerDialog.close()');assert.ok(focusReturns>=described.length*2+1);
console.log('PASS '+described.length+' biographies: earned/unearned dialogs, separate reward block, safe text, Escape/focus, no network writes or progress changes; basic rewards unchanged');
