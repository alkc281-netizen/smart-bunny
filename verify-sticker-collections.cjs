const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();let requests=0,focusReturns=0;
function el(tag='div'){
 return {tagName:tag,children:[],dataset:{},attributes:{},style:{setProperty(){}},className:'',textContent:'',classList:{toggle(){}},
 append(...items){for(const item of items){this.children.push(item);item.parent=this}},replaceChildren(){this.children=[]},
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)},setAttribute(k,v){this.attributes[k]=v},
 addEventListener(){},querySelector(){return null},closest(){return null},showModal(){this.open=true},close(){this.open=false;this.onclose?.()},
 focus(){this.focused=true},getBoundingClientRect(){return {left:0,top:0,right:400,bottom:600}}};
}
const opener={isConnected:true,focus(){focusReturns++}};
const document={activeElement:opener,getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id)},createElement:el,createTextNode:text=>({textContent:text,children:[]}),querySelectorAll:()=>[],addEventListener(){}};
const ctx=vm.createContext({document,console,crypto:require('node:crypto').webcrypto,AbortSignal,fetch(){requests++;return new Promise(()=>{})},localStorage:{getItem(){return null},setItem(){}},window:{addEventListener(){}},performance:{now:()=>0},setTimeout(){return 0},clearTimeout(){},setInterval(){return 0},clearInterval(){},Audio:class{addEventListener(){}pause(){}play(){return Promise.resolve()}}});
const run=code=>vm.runInContext(code,ctx);
for(const file of ['app.js','russian-curriculum.js','russian.js','players.js'])run(fs.readFileSync(file,'utf8'));
run('stickerArt=()=>{}'); // Image loading is independent of the description dialog.

const catalog=JSON.parse(fs.readFileSync('sticker-catalog.json','utf8'));
const prices=Object.fromEntries(catalog.stickers.filter(s=>s.enabled&&s.cost).map(s=>[s.id,s.cost]));
run(`activePlayer={id:'test',coins:9,rounds:15,correct:143,topics:['zhi','cha'],schoolClasses:[1,2],stickers:{mario:{boardX:345,boardY:678}},rewards:{prices:${JSON.stringify(prices)},conditions:{}}}`);
run('stickerArt=(parent,key)=>{const img=playerElement("span",key,parent);img.className="art-test"}');
const parent=el(),before=run('JSON.stringify(activePlayer)'),networkBefore=requests;
ctx.parent=parent;run('renderMarioCollection(parent)');
function descendants(n){return [n,...n.children.flatMap(descendants)]}
function find(cls){return descendants(parent).find(n=>n.className===cls)}
const groups=run('stickerCollections'),expectedGroups=[];
for(const group of groups){const keys=Array.from(group.keys).filter(k=>Object.hasOwn(prices,k));if(!keys.length)continue;const cover=['mario','chip','darkwing','dddonald','mmmickey'].find(k=>group.keys.includes(k))||(keys.some(k=>k.startsWith('dd'))?'dddonald':keys[0]);let family=expectedGroups.find(f=>f.cover===cover);if(!family){family={cover,keys:[]};expectedGroups.push(family)}family.keys.push(...keys)}
const gallery=find('sticker-collection-covers'),content=find('sticker-collection-content');
assert.equal(gallery.children.length,expectedGroups.length);assert.equal(content.hidden,true);assert.equal(descendants(parent).filter(n=>n.className==='mario-sticker-card').length,0);
const snapshots=new Map();
function snapshot(n){return {tag:n.tagName,cls:n.className,text:n.textContent,children:n.children.map(snapshot)}}
for(let i=0;i<gallery.children.length;i++){
 const cover=gallery.children[i];cover.onclick();assert.equal(gallery.hidden,true);assert.equal(content.hidden,false);
 const cards=descendants(content).filter(n=>n.className==='mario-sticker-card');assert.equal(cards.length,expectedGroups[i].keys.length);
 assert.deepEqual(cards.map(card=>card.children.find(n=>n.tagName==='h4').textContent),expectedGroups[i].keys.map(k=>catalog.stickers.find(s=>s.id===k).name));
 cards.forEach((card,j)=>snapshots.set(expectedGroups[i].keys[j],snapshot(card)));
 if(expectedGroups[i].cover==='chip')assert.equal(cover.children[0].children.length,2);
 content.children[0].onclick();assert.equal(gallery.hidden,false);assert.equal(content.hidden,true);assert.equal(content.children.length,0);assert.equal(cover.focused,true);
}
// Selected collection survives a profile refresh, without a server write.
gallery.children.at(-1).onclick();parent.replaceChildren();run('renderMarioCollection(parent)');assert.equal(find('sticker-collection-covers').hidden,true);assert.equal(descendants(find('sticker-collection-content')).filter(n=>n.className==='mario-sticker-card').length,expectedGroups.at(-1).keys.length);
assert.equal(run('JSON.stringify(activePlayer)'),before);assert.equal(requests,networkBefore);
console.log('PASS hero covers, paired Chip/Dale, Donald extras together, lazy rendering, open/back/focus, refresh, no progress writes');
