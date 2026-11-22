const fs=require('node:fs'),assert=require('node:assert/strict');
let harness=fs.readFileSync(__dirname+'/verify-mario-input.cjs','utf8').split('(async()=>{')[0];
harness=harness.replace('async function harness(){','async function harness(){\n let nativePaused=false;const calls=[],intervals=[];let heldHeartbeat=null,holdHeartbeat=false;\n const server={remaining:600000,expires:600000,paused:false};');
harness=harness.replace('session?.step(mask);},isPaused:()=>false','session?.step(mask);if(mask&16)nativePaused=!nativePaused;},isPaused:()=>nativePaused');
harness=harness.replace("apiRequest:async()=>({player:'test',admin:true,id:'lease',tickets:0}),stopMusic(){},",`apiRequest:async(route,data)=>{
 if(data?.action){calls.push(data.action);if(data.action==='heartbeat'&&holdHeartbeat){holdHeartbeat=false;await new Promise(resolve=>heldHeartbeat=resolve);}
 if(data.action==='pause'&&!server.paused){server.remaining=Math.max(0,server.expires-now);server.paused=true;}
 if(data.action==='resume'&&server.paused){server.expires=now+server.remaining;server.paused=false;}}
 return {player:'test',admin:false,id:'lease',tickets:0,canResume:true,paused:server.paused,remaining:(server.paused?server.remaining:Math.max(0,server.expires-now))/1000};},stopMusic(){},`);
harness=harness.replace('setInterval(){},','setInterval(fn){intervals.push(fn)},');
harness=harness.replace("vm.runInContext(fs.readFileSync(__dirname+'/mario-manual.js','utf8'),c);",`vm.runInContext(fs.readFileSync(__dirname+'/mario-manual.js','utf8').replace('window.bunnyMario={','window.pauseTest={heartbeat,updateClock,quota:()=>({quotaPaused,frozenRemaining,deadline}),settled:()=>leaseOperations};window.bunnyMario={'),c);`);
harness=harness.replace('startedLevels,c,$,released:',`startedLevels,c,$,calls,server,intervals,advance:ms=>now+=ms,holdHeartbeat:()=>holdHeartbeat=true,releaseHeartbeat:()=>heldHeartbeat?.(),released:`);
harness=harness.replaceAll('i<15','i<60');
const tests=`
(async()=>{
 const h=await harness(),api=h.window.pauseTest,get=id=>h.panel.querySelector('#'+id);
 h.advance(90000);await api.heartbeat();api.updateClock();assert.equal(get('manual-clock').textContent,'Осталось 8:30');
 await get('manual-pause').click();h.tick(2);await api.settled();
 assert.equal(h.server.paused,true);assert.equal(api.quota().quotaPaused,true);const frozen=get('manual-clock').textContent;assert.match(frozen,/пауза/);
 const pauseCalls=h.calls.filter(a=>a==='pause').length;
 h.advance(3600000);api.updateClock();assert.equal(get('manual-clock').textContent,frozen,'The earned clock remains unchanged while paused');
 await api.heartbeat();assert.equal(get('manual-clock').textContent,frozen);h.tick(2);await api.settled();assert.equal(h.calls.filter(a=>a==='pause').length,pauseCalls,'No pause request every emulator frame');
 await get('manual-pause').click();h.tick(2);await api.settled();assert.equal(h.server.paused,false);assert.equal(api.quota().quotaPaused,false);assert.doesNotMatch(get('manual-clock').textContent,/пауза/);
 const resumed=h.server.expires;h.advance(10000);await api.heartbeat();api.updateClock();assert.equal(get('manual-clock').textContent,'Осталось 8:20');assert.equal(h.server.expires,resumed);
 // A delayed running heartbeat cannot unfreeze a newer local native pause.
 h.holdHeartbeat();const delayed=api.heartbeat();for(let i=0;i<10;i++)await Promise.resolve();
 await get('manual-pause').click();h.tick(2);assert.equal(api.quota().quotaPaused,true);
 const local=get('manual-clock').textContent;h.advance(3000);api.updateClock();assert.equal(get('manual-clock').textContent,local);
 h.releaseHeartbeat();await delayed;await api.settled();assert.equal(h.server.paused,true);assert.equal(api.quota().quotaPaused,true);
 // Hiding and leaving the screen also freeze the budget; reopening cannot create a ticket.
 await get('manual-pause').click();h.tick(2);await api.settled();h.document.hidden=true;h.document.dispatch('visibilitychange',{});await api.settled();assert.equal(h.server.paused,true);const left=h.server.remaining;
 h.advance(100000);api.updateClock();assert.equal(h.server.remaining,left);h.document.hidden=false;
 await get('manual-pause').click();h.tick(2);await api.settled();assert.equal(h.server.paused,false);
 h.c.home();await api.settled();assert.equal(h.server.paused,true,'Leaving the game freezes the server budget');
 console.log('PASS Mario client pause: native START freezes earned clock; 1-hour pause; server heartbeat agrees; resume preserves seconds; no request flooding; stale response cannot undo pause; background and exit pause; no timer refill');
})().catch(error=>{console.error(error);process.exitCode=1});
`;
new Function('require','__dirname',harness+tests)(require,__dirname);
