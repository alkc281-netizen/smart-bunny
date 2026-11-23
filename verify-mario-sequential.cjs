// Exercise the real manual-game launch/save handlers with isolated old saves.
const fs=require('node:fs'),assert=require('node:assert/strict');
let source=fs.readFileSync(__dirname+'/verify-mario-input.cjs','utf8').split('(async()=>{')[0];
source=source.replace('async function harness(){','async function harness(){\n let nativeState={marker:"original-title"};const restored=[];');
source=source.replace('snapshot:()=>({}),restore(){}','snapshot:()=>structuredClone(nativeState),restore(value){nativeState=structuredClone(value);restored.push(nativeState);}');
source=source.replace('startedLevels.push(level);return runtime;','nativeState={marker:"original-title"};startedLevels.push(level);return runtime;');
source=source.replace('vm.createContext({window,document,console,$,','vm.createContext({window,document,console,$,structuredClone,');
source=source.replace("vm.runInContext(fs.readFileSync(__dirname+'/mario-manual.js','utf8'),c);",`vm.runInContext(fs.readFileSync(__dirname+'/mario-manual.js','utf8').replace('window.bunnyMario={','window.saveTest={seed:(key,value)=>memory.set(key,value),read:key=>memory.get(key)};window.bunnyMario={'),c);`);
source=source.replace('startedLevels,c,$,released:','startedLevels,c,$,restored,state:()=>nativeState,released:');
const tests=`
(async()=>{
 const h=await harness(),api=h.window.bunnyMario,saves=h.window.saveTest;
 const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
 h.c.home();await settle();
 const original={version:1,state:{marker:'old-original-save',world:2,level:1,x:700}};
 const legacy={version:1,state:{marker:'old-selected-level',world:7,level:3}};
 saves.seed('test:original',original);saves.seed('test:8-4',legacy);
 await api.open();await settle();
 assert.equal(h.c.phase,'player-mario');assert.equal(api.isPlaying(),true);
 assert.equal(h.startedLevels.at(-1),null);assert.equal(h.state().marker,'old-original-save');
 assert.equal(saves.read('test:original').state.x,700,'Updating cannot reset the original game');
 assert.equal(saves.read('test:8-4'),legacy,'Old per-level saves are retained');
 assert.equal(h.panel.querySelectorAll('button').filter(b=>b.dataset.marioLevel!==undefined).length,0);
 h.c.home();await settle();await api.open(31);await settle();
 assert.equal(h.startedLevels.at(-1),null,'Legacy level arguments cannot launch later levels');
 assert.equal(h.state().marker,'old-original-save','Reopening continues the same game');
 h.c.home();await settle();h.c.activePlayer={id:'other'};api.playerChanged();await settle();
 saves.seed('other:original',{version:1,state:{marker:'other-child-save',world:1,level:0}});
 await api.open();await settle();assert.equal(h.state().marker,'other-child-save');
 assert.equal(saves.read('test:original').state.marker,'old-original-save','Player saves stay isolated');
 h.c.home();await settle();h.c.activePlayer={id:'new'};api.playerChanged();await settle();
 saves.seed('new:8-4',legacy);await api.open();await settle();
 assert.equal(h.state().marker,'original-title','Without an original save, start at the native menu, not a selected-world checkpoint');
 assert.equal(saves.read('new:8-4'),legacy);
 assert.ok(h.startedLevels.every(level=>level===null));
 console.log('PASS sequential manual play: direct launch; original-game continuation; no world/level picker or legacy argument jumps; retained old saves; player isolation; native title when no original save');
})().catch(error=>{console.error(error);process.exitCode=1});
`;
new Function('require','__dirname','structuredClone',source+tests)(require,__dirname,structuredClone);
