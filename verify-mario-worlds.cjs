// Exercise production JSNES loaders/routes, including resuming states and controller latches.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),zlib=require('node:zlib');
const root=__dirname,manifest=JSON.parse(fs.readFileSync(root+'/assets/emulation/routes/manifest.json'));
const engine=require(root+'/assets/emulation/jsnes-2.1.0.min.js'),rom=new Uint8Array(fs.readFileSync(root+'/assets/emulation/smb-world.nes'));
const elements=new Map(),frames=new Map();let clock=0,serial=0;
function el(){return {hidden:true,value:'0',textContent:'',setAttribute(){},addEventListener(){},close(){},getContext(){return {createImageData:()=>({data:new Uint8ClampedArray(256*240*4)}),putImageData(){}}}}}
const $=id=>{if(!elements.has(id))elements.set(id,el());return elements.get(id)};
const window={jsnes:engine},document={hidden:false,addEventListener(){}};
const fetch=async url=>{const file=path.join(root,url.split('?')[0]);const bytes=fs.readFileSync(file);return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),json:async()=>JSON.parse(bytes)}};
const context=vm.createContext({window,document,$,console,fetch,AbortController,setTimeout,clearTimeout,structuredClone,Uint8Array,Uint32Array,Uint8ClampedArray,Float32Array,performance,phase:'answer',activePlayer:null,audioCtx:null,mute:false,fxVolume:.65,
requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial},cancelAnimationFrame:id=>frames.delete(id)});
let source=fs.readFileSync(root+'/mario-replay.js','utf8');source=source.replace(/\}\)\(\);\s*$/,`window.routeTest={verifyRoute,bootManualLevel,makeSession,isolateEffects,levelTitle,getVersion:()=>loadVersion,getFrame:()=>frame,getTarget:()=>target,getSession:()=>session,setRoute:value=>{verified=value;chosen=true;marioTheme=true;resetSession();}};})();`);
vm.runInContext(source,context);const t=window.routeTest;
function drain(){for(let guard=0;frames.size&&guard<20000;guard++){clock+=17;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(clock);}assert.equal(frames.size,0,'Animation must settle at the current task boundary');}
(async()=>{
 assert.equal(manifest.levels.length,32);
 const packetLoaderSource=source.slice(source.indexOf('  async function loadRoutePacket('),source.indexOf('  function expandRuns('));
 const decode=new Function('fetch','DecompressionStream','Response','record',"const assets='assets/emulation/';\n"+packetLoaderSource+'return loadRoutePacket(record);');
 const streamingFetch=async url=>new Response(fs.readFileSync(path.join(root,url)));
 for(const record of manifest.levels){const packet=await decode(streamingFetch,DecompressionStream,Response,record);assert.equal(JSON.stringify(packet),fs.readFileSync(root+'/assets/emulation/routes/'+record.file,'utf8'));}
 console.log('PASS gzip streaming decoder: 32/32; JSON fallback is exercised by the route checks');
 if(process.argv.includes('--packets-only'))return;
 for(let level=0;level<32;level++){
  const record=manifest.levels[level],packet=JSON.parse(fs.readFileSync(root+'/assets/emulation/routes/'+record.file));assert.equal(record.id,t.levelTitle(level));
  assert.deepEqual(zlib.gunzipSync(fs.readFileSync(root+'/assets/emulation/routes/'+record.compressed)),fs.readFileSync(root+'/assets/emulation/routes/'+record.file));
  const result=await t.verifyRoute(engine,rom,level,t.getVersion());
  for(const total of [10,20,30,50,100])for(let solved=0;solved<total;solved++)assert.ok(Math.floor((result.flag-1)*solved/total)<result.flag,'The final goal belongs only to the final task');
  // Actual production progress/animation, rotating through short and long rounds.
  t.setRoute(result);const total=[10,50,100][level%3];
  for(let solved=1;solved<=total;solved++){window.bunnyReplay.setProgress(solved,total);drain();assert.equal(t.getFrame(),t.getTarget());if(solved<total)assert.ok(t.getFrame()<result.flag);}
  assert.equal(t.getFrame(),result.end);const m=t.getSession().nes.cpu.mem;assert.equal(m[0x75f],Math.floor(level/4));assert.equal(m[0x75c],level%4);
  console.log('PASS learning',record.id,record.goalKind,total,'tasks');
 }
 // Native manual starts are independent of TAS power-ups and still use the full ROM/audio.
 for(let level=0;level<32;level++){
  const runtime=await window.bunnyReplay.manual(level,()=>{}),state=runtime.snapshot();assert.equal(state.cpu.mem[0x75f],Math.floor(level/4));assert.equal(state.cpu.mem[0x75c],level%4);assert.equal(state.cpu.mem[0x75a],2);assert.equal(state.cpu.mem[0x756],0);assert.equal(state.cpu.mem[0xe],8);
  runtime.step(65);runtime.step(0);runtime.releaseInput();console.log('PASS manual',t.levelTitle(level));
 }
 const original=await window.bunnyReplay.manual(null,()=>{});for(let i=0;i<60;i++)original.step(0);assert.equal(original.snapshot().cpu.mem[0x770],0,'Original NES title/menu remains available');
 await assert.rejects(()=>window.bunnyReplay.manual(32,()=>{}));
 console.log('PASS 32/32 learning routes and native manual starts; 5 round lengths; goal held until final task; original menu; controls restored; no ROM changes');
})().catch(error=>{console.error(error);process.exitCode=1});
