// Build private, ROM-bound starting states and input routes for all 32 levels.
// Source: HappyLee & Mars608, https://tasvideos.org/3728M (tool-assisted, warpless).
// No ROM, movie or prepared save state is published by this tool.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [movieFile,romFile,engineFile,output]=process.argv.slice(2);
if(!output)throw Error('Usage: node prepare-mario-worlds.cjs movie.fm2 rom.nes jsnes.js output-directory');
const engine=require(path.resolve(engineFile)),rom=fs.readFileSync(romFile),out=path.resolve(output);fs.mkdirSync(out,{recursive:true});
let text=fs.readFileSync(movieFile);if(text[0]===31)text=zlib.gunzipSync(text);
const movie=text.toString().split('\n').filter(line=>line.startsWith('|')).map(line=>{const fields=line.split('|');assert.equal(fields[3],'........','Only the original single-player movie is supported');return {command:Number(fields[1]),mask:[...fields[2]].reduce((mask,c,i)=>mask|(c==='.'||c===' '?0:1<<i),0)};});
assert.equal(movie[0].command,1,'The recording must start with power-on');assert.ok(movie.slice(1).every(frame=>frame.command===0),'Unexpected reset/disk commands');
// FCEUX's initial power-on row is not an input frame in JSNES.
const inputs=movie.slice(1).map(frame=>frame.mask),buttons=['RIGHT','LEFT','DOWN','UP','START','SELECT','B','A'].map(name=>engine.Controller['BUTTON_'+name]);
function rle(values){const runs=[];for(const value of values){if(runs.length&&runs.at(-1)[1]===value)runs.at(-1)[0]++;else runs.push([1,value]);}return runs;}
function signature(bytes){let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;return hash.toString(16).padStart(8,'0');}
let pixels,previous=0,active=null;const done=new Set(),records=[];
const nes=new engine.NES({onFrame:frame=>{pixels=frame;},onAudioSample(){},onStatusUpdate(){},sampleRate:44100});nes.loadROM(rom.toString('binary'));
for(let frame=0;frame<inputs.length+2400;frame++){
 const mask=inputs[frame]||0;for(let bit=0;bit<8;bit++)if((mask&1<<bit)!==(previous&1<<bit))nes[mask&1<<bit?'buttonDown':'buttonUp'](1,buttons[bit]);previous=mask;nes.frame();
 const m=nes.cpu.mem,world=m[0x75f],level=m[0x75c],id=(world+1)+'-'+(level+1),mode=m[0x770],task=m[0x772],routine=m[0xe];
 assert.ok(!(mode===1&&routine===11),'Mario died at frame '+frame+' in '+id);
 if(!active&&mode===1&&task===3&&routine===8&&!done.has(id)){
  assert.equal(world*4+level,records.length,'A level was skipped');
  active={id,world:world+1,level:level+1,start:frame,state:structuredClone(nes.toJSON()),picture:rle(pixels),goal:null,goalKind:level===3?'castle':'flag'};
 }
 if(!active)continue;
 assert.equal(id,active.id,'Left the level before verifying its completion');
 if(active.goal===null&&((level===3&&mode===2)||(level!==3&&mode===1&&task===3&&(routine===4||routine===5))))active.goal=frame;
 const ended=active.goal!==null&&(level===3?mode===2&&task===4:mode===1&&task===3&&routine===5);
 if(ended){
  const packet={version:1,id,romSignature:signature(rom),startState:active.state,startImage:active.picture,inputs:rle(Array.from({length:frame-active.start+1},(_,i)=>inputs[active.start+i]||0)),goal:active.goal-active.start,end:frame-active.start,goalKind:active.goalKind};
  assert.ok(packet.goal>0&&packet.end>=packet.goal);
  const json=Buffer.from(JSON.stringify(packet)),gz=zlib.gzipSync(json,{level:9});fs.writeFileSync(path.join(out,id+'.json'),json);fs.writeFileSync(path.join(out,id+'.json.gz'),gz);
  records.push({id,world:world+1,level:level+1,file:id+'.json',compressed:id+'.json.gz',goal:packet.goal,end:packet.end,goalKind:packet.goalKind,startFrame:active.start,endFrame:frame,bytes:json.length,gzipBytes:gz.length,sha256:crypto.createHash('sha256').update(json).digest('hex')});done.add(id);console.log('Prepared',id,'goal',packet.goal,'end',packet.end,'gzip',gz.length);active=null;
  if(records.length===32)break;
 }
}
assert.equal(records.length,32,'The movie did not finish all 32 levels');
const manifest={version:1,engine:'JSNES 2.1.0',romSignature:signature(rom),romSha256:crypto.createHash('sha256').update(rom).digest('hex'),movieSha256:crypto.createHash('sha256').update(text).digest('hex'),source:'https://tasvideos.org/3728M',authors:'HappyLee & Mars608',toolAssisted:true,levels:records};fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log('PASS 32/32: native completion, no deaths, no skipped levels');
