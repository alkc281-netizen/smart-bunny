// Build short private episodes from the verified original-ROM routes.
// Usage: node tool/prepare-mario-secrets.cjs
// The 1-1 1-UP detour consists only of controller input, with a native life gain.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),assets=root+'/assets/emulation/';
const engine=require(assets+'jsnes-2.1.0.min.js'),rom=new Uint8Array(fs.readFileSync(assets+'smb-world.nes'));
const source=fs.readFileSync(root+'/mario-replay.js','utf8');
const make=vm.runInNewContext(source.slice(source.indexOf('  function makeSession('),source.indexOf('  function isolateEffects('))+';makeSession',{structuredClone});
const episodes=[
 {id:'oneup11',level:'1-1',start:350,runs:[[20,193],[15,2],[15,0],[48,128],[33,1],[94,0]],proof:'life'},
 {id:'coins11',level:'1-1',start:330,end:790,proof:'room'},
 {id:'oneup12',level:'1-2',start:535,end:705,proof:'reveal'},
 {id:'mushroom13',level:'1-3',start:310,end:450,proof:'grow'},
 {id:'coins14',level:'1-4',start:710,end:850,proof:'coins'},
];
function rle(values){const out=[];for(const v of values){if(out.length&&out.at(-1)[1]===v)out.at(-1)[0]++;else out.push([1,v]);}return out;}
const out=assets+'secrets/';fs.mkdirSync(out,{recursive:true});
for(const ep of episodes){
 const route=JSON.parse(fs.readFileSync(assets+'routes/'+ep.level+'.json')),input=route.inputs.flatMap(([n,b])=>Array(n).fill(b));
 let pixels;const run=make(engine,rom,b=>{pixels=Array.from(b);},()=>{});
 run.restore(route.startState,input[0]);for(let i=1;i<=ep.start;i++)run.step(input[i]);
 const buttons=[input[ep.start],...(ep.runs?ep.runs.flatMap(([n,b])=>Array(n).fill(b)):input.slice(ep.start+1,ep.end+1)),...Array(ep.wait||0).fill(0)];
 const packet={version:1,id:ep.id,level:ep.level,romSignature:route.romSignature,startState:structuredClone(run.nes.toJSON()),startImage:rle(pixels),inputs:rle(buttons),end:buttons.length-1,proof:ep.proof};
 const m=run.nes.cpu.mem,before={lives:m[0x75a],coins:m[0x75e],status:m[0x756],area:m[0x750]};let reveal=false,room=false;
 for(let i=1;i<buttons.length;i++){
  run.step(buttons[i]);assert.equal(m[0x75f],0);assert.equal(m[0x75c],Number(ep.level[2])-1);assert.equal(m[0x770],1);assert.notEqual(m[0xe],11);assert.notEqual(m[0xe],4);assert.notEqual(m[0xe],5);
  reveal ||=m[0x39]===3&&m[0x1b]===46&&m[0x14]!==0;room ||=m[0x750]!==before.area;
 }
 const evidence={lives:m[0x75a]-before.lives,coins:m[0x75e]-before.coins,grown:m[0x756]>before.status,reveal,room,returned:m[0x750]===before.area};
 assert.ok(ep.proof==='life'?evidence.lives===1&&reveal:ep.proof==='room'?room&&evidence.returned&&evidence.coins>=10:ep.proof==='reveal'?reveal:ep.proof==='grow'?evidence.grown:evidence.coins>=3,JSON.stringify(evidence));
 const data=Buffer.from(JSON.stringify(packet));fs.writeFileSync(out+ep.id+'.json',data);fs.writeFileSync(out+ep.id+'.json.gz',zlib.gzipSync(data,{level:9}));
 console.log('PASS',ep.id,packet.end,'frames',JSON.stringify(evidence));
}
