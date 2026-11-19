const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
async function check(origin){
 const elements={status:{textContent:''},open:{hidden:true}},redirects=[];
 const context=vm.createContext({URL,document:{getElementById:id=>elements[id]},fetch:async()=>({ok:true,json:async()=>({origin})}),location:{replace:url=>redirects.push(url)}});
 await vm.runInContext(fs.readFileSync(__dirname+'/docs/launch.js','utf8'),context);
 return {elements,redirects};
}
(async()=>{
 const good=await check('https://smart-bunny.example');assert.deepEqual(good.redirects,['https://smart-bunny.example/']);assert.equal(good.elements.open.hidden,false);
 for(const bad of [null,'http://home.example','https://user:password@home.example','https://home.example/?token=secret']){const r=await check(bad);assert.deepEqual(r.redirects,[]);assert.equal(r.elements.open.hidden,true);}
 console.log('PASS launcher: one HTTPS origin, no local profiles, safe fallback for pending/invalid configuration');
})().catch(e=>{console.error(e);process.exitCode=1});
