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
const prices=Object.fromEntries(catalog.stickers.filter(s=>s.enabled&&s.cost).map(s=>[s.id,s.cost]));
run(`activePlayer={id:'test',coins:9,rounds:15,correct:143,topics:['zhi','cha'],schoolClasses:[1,2],stickers:{mario:{boardX:345,boardY:678}},rewards:{prices:${JSON.stringify(prices)},conditions:{}}}`);
run('stickerArt=(parent,key)=>{const img=playerElement("span",key,parent);img.className="art-test"}');
const parent=el(),before=run('JSON.stringify(activePlayer)'),networkBefore=requests;
ctx.parent=parent;run('renderMarioCollection(parent)');
function descendants(n){return [n,...n.children.flatMap(descendants)]}
const all=descendants(parent),tabs=all.filter(n=>n.attributes.role==='tab'),panels=all.filter(n=>n.attributes.role==='tabpanel');
assert.equal(tabs.length,5);assert.equal(panels.length,5);
function visible(i){assert.deepEqual(panels.map(p=>p.hidden),panels.map((_,j)=>j!==i));assert.deepEqual(tabs.map(t=>t.attributes['aria-selected']),tabs.map((_,j)=>String(j===i)))}
visible(0);
for(let i=0;i<tabs.length;i++){
 tabs[i].onclick();visible(i);
 const names=descendants(panels[i]).filter(n=>n.tagName==='h4').map(n=>n.textContent);
 const expected=run(`stickerCollections[${i}].keys.filter(k=>Object.hasOwn(activePlayer.rewards.prices,k)).map(k=>albumStickers[k][1])`);
 assert.deepEqual(names,Array.from(expected));
}
assert.equal(descendants(panels[3]).filter(n=>n.className==='mario-sticker-card').length,30);
parent.replaceChildren();run('renderMarioCollection(parent)');
assert.equal(descendants(parent).find(n=>n.attributes.role==='tabpanel'&&!n.hidden).children[0].textContent,'Дональд Дак · дополнения без фона');
assert.equal(run('JSON.stringify(activePlayer)'),before);assert.equal(requests,networkBefore);
const first=descendants(parent).find(n=>n.attributes.role==='tab');let focused=0;first.focus=()=>{focused++};
first.onkeydown({key:'Home',preventDefault(){}});assert.equal(focused,1);
console.log('PASS five collection tabs, one visible group, exact membership, all existing cards, selected group retained, keyboard navigation, no progress writes');
