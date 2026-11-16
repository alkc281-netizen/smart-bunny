'use strict';
// Smart Bunny game. Music and effects are served from local WAV assets.
const $=id=>document.getElementById(id);
const names={memory:'Запоминание чисел',compare:'Сравнение чисел',pattern:'Найди закономерность',add:'Сложение',multiply:'Умножение',divide:'Деление'};
const icons={memory:'🧠',compare:'⚖️',pattern:'🔮',add:'➕',multiply:'✖️',divide:'➗'};
const effects={coin:'smb_coin.wav',jump:'smb_jump-small.wav',wrong:'smb_bump.wav',retry:'smb_powerup_appears.wav',bonus:'smb_1-up.wav',tap:'smb_kick.wav',playerIntro:'smb_player_intro.wav',albumClear:'smb_album_clear.wav',win:'smb_stage_clear.wav'};
const music=[
 {name:'Overworld (Ground Theme)',file:'overworld.wav'},
 {name:'Underground Theme',file:'underground.wav'},
 {name:'Underwater Theme',file:'underwater.wav'},
 {name:'Castle Theme',file:'castle.wav'},
 {name:'Starman (Invincibility Theme)',file:'starman.wav'},
 {name:'Ending Theme',file:'ending.wav'}
];
const mathRoundLengths=[10,50,100];
const memoryQuestionCount=50;
let mathRoundLength=mathRoundLengths[0];
const gameMusic={memory:2,compare:1,pattern:3,add:0,multiply:4,divide:1,russian:2};
let game=null,phase='menu',round=0,score=0,attempt=1,sequence='',answer='',entry='',taskToken=0,timeout=null;
let audioCtx=null,musicBus=null,musicNodes=[],musicGeneration=0,musicWanted=false,musicPreview=false,selectedMusic=0,autoMusic=true,enableMusic=true,enableVictory=true,mute=false,musicVolume=.35,fxVolume=.65;
let pendingTask=null,settingsSnapshot=null,pendingAlbumSound=null;
const rand=(min,max)=>Math.floor(Math.random()*(max-min+1))+min;
const setVisible=(id,visible)=>$(id).hidden=!visible;
function cancelTask(){taskToken++;clearTimeout(timeout);timeout=null;pendingTask=null}
function wait(ms,fn){const token=++taskToken;clearTimeout(timeout);pendingTask={fn,deadline:performance.now()+ms};timeout=setTimeout(()=>{if(token===taskToken){pendingTask=null;timeout=null;fn()}},ms)}
function mood(name=''){$('rabbit').className='rabbit '+name}
function message(text){$('message').textContent=text}
function panels(){['game-menu','math-menu','answers','keypad','digits','settings','finished','russian-menu','russian-detail'].forEach(id=>setVisible(id,false))}
const audioBuffers=new Map();
const retiringMusic=new Set();
let loopManifest=null;
function ensureAudio(){try{if(!audioCtx){const C=window.AudioContext||window.webkitAudioContext;audioCtx=new C();musicBus=audioCtx.createGain();musicBus.connect(audioCtx.destination)}if(audioCtx.state==='suspended'||audioCtx.state==='interrupted')audioCtx.resume().catch(()=>{});return true}catch{return false}}
function decodeAudio(data){return new Promise((resolve,reject)=>audioCtx.decodeAudioData(data,resolve,reject))}
function loadAudio(url){if(!audioBuffers.has(url)){const pending=fetch(url).then(r=>{if(!r.ok)throw new Error('Audio HTTP '+r.status);return r.arrayBuffer()}).then(decodeAudio).catch(e=>{audioBuffers.delete(url);throw e});audioBuffers.set(url,pending)}return audioBuffers.get(url)}
function loadLoops(){if(!loopManifest)loopManifest=fetch('assets/audio/music/loops.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Loop metadata HTTP '+r.status);return r.json()}).catch(e=>{loopManifest=null;throw e});return loopManifest}
function musicScreen(){return phase==='settings'?settingsSnapshot?.phase:phase}
function musicAllowed(){
 const screen=musicScreen();
 return (phase==='settings'&&musicPreview)||screen==='player-album'||Boolean(game&&!['menu','finished'].includes(screen));
}
function setAudioLevel(){
 if(!musicBus||!audioCtx)return;
 const duck=(game==='memory'&&phase==='show')||[...players.values()].includes('albumClear');
 musicBus.gain.setTargetAtTime(!mute&&enableMusic?musicVolume*(duck ? .15 : 1):0,audioCtx.currentTime,.035);
}
function retireMusic(fade=0){const now=audioCtx?.currentTime||0;for(const n of musicNodes){if(fade){n.gain.gain.cancelScheduledValues(now);n.gain.gain.setValueAtTime(n.gain.gain.value,now);n.gain.gain.linearRampToValueAtTime(0,now+fade)}retiringMusic.add(n);try{n.source.stop(now+fade)}catch{}}musicNodes=[]}
function stopMusic(){pendingAlbumSound=null;musicGeneration++;musicWanted=false;musicPreview=false;retireMusic();$('track-label').textContent='Музыка остановлена';for(const n of retiringMusic){try{n.source.stop()}catch{}}}
async function startMusic(preview=false){
 const token=++musicGeneration,index=autoMusic&&musicScreen()==='player-album'?music.length-1:selectedMusic;musicWanted=true;musicPreview=preview;
 if(!enableMusic||mute||!musicAllowed()){musicWanted=false;retireMusic();return}
 if([...players.values()].includes('win'))return;
 if(!ensureAudio())return;
 $('track-label').textContent='Загрузка: '+music[index].name;
 try{
  await audioCtx.resume();
  const [buffer,manifest]=await Promise.all([loadAudio('assets/audio/music/'+music[index].file),loadLoops()]);
  if(token!==musicGeneration||!musicWanted||!musicAllowed()||mute||!enableMusic||[...players.values()].includes('win'))return;
  const loop=manifest.tracks.find(t=>t.file===music[index].file);
  if(!loop||!Number.isInteger(loop.loop_start_sample)||!Number.isInteger(loop.loop_end_sample_exclusive)||loop.sample_rate!==44100)throw new Error('Invalid loop metadata');
  const start=loop.loop_start_sample/loop.sample_rate,end=loop.loop_end_sample_exclusive/loop.sample_rate;
  if(!(start>=0&&end>start&&end<=buffer.duration+1/buffer.sampleRate))throw new Error('Loop outside audio buffer');
  const now=audioCtx.currentTime,source=audioCtx.createBufferSource(),gain=audioCtx.createGain();
  source.buffer=buffer;source.loop=true;source.loopStart=start;source.loopEnd=Math.min(end,buffer.duration);
  source.connect(gain);gain.connect(musicBus);gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(1,now+.04);
  retireMusic(.04);const node={source,gain};musicNodes.push(node);
  source.onended=()=>{retiringMusic.delete(node);source.disconnect();gain.disconnect();const i=musicNodes.indexOf(node);if(i>=0)musicNodes.splice(i,1)};
  setAudioLevel();source.start(now);$('track-label').textContent='♫ '+music[index].name;
 }catch(e){if(token===musicGeneration){musicWanted=false;retireMusic();$('track-label').textContent='Музыка недоступна — попробуй ещё раз';console.warn('Music playback:',e)}}
}
function warmAudio(){if(!ensureAudio())return;loadAudio('assets/audio/smb_stage_clear.wav').catch(()=>{});loadLoops().catch(()=>{});for(const tune of music)if(tune.file!=='ending.wav')loadAudio('assets/audio/music/'+tune.file).catch(()=>{})}
const players=new Map();
function resumeWantedMusic(){
 const reward=pendingAlbumSound;
 pendingAlbumSound=null;
 if(reward&&musicScreen()==='player-album')sound(reward);
 if(musicWanted&&musicAllowed())startMusic(musicPreview);
}
function albumRewardSound(name){
 if([...players.values()].includes('win'))pendingAlbumSound=name;
 else sound(name);
}
function playVictory(){
 if(mute||!enableVictory||[...players.values()].includes('win')||!ensureAudio())return;
 let source=null,gain=null,cancelled=false,volume=fxVolume;
 const player={pause(){cancelled=true;if(source){try{source.stop()}catch{}}},get volume(){return volume},set volume(v){volume=v;if(gain)gain.gain.setTargetAtTime(v,audioCtx.currentTime,.015)}};
 players.set(player,'win');
 loadAudio('assets/audio/smb_stage_clear.wav').then(buffer=>{
  if(cancelled||!players.has(player)||mute)return;
  source=audioCtx.createBufferSource();gain=audioCtx.createGain();source.buffer=buffer;source.connect(gain);gain.connect(audioCtx.destination);gain.gain.value=volume;
  source.onended=()=>{source.disconnect();gain.disconnect();players.delete(player);if(!cancelled)resumeWantedMusic()};source.start();
 }).catch(e=>{players.delete(player);console.warn('Victory playback:',e);resumeWantedMusic()});
 return player;
}
function sound(name){
 if(mute||!ensureAudio())return;
 if(name==='win')return playVictory();
 if([...players.values()].includes('win'))return;
 const file=effects[name];
 if(!file)return;
 const audio=new Audio('assets/audio/'+file);
 audio.volume=Math.min(1,fxVolume);
 players.set(audio,name);
 const finished=()=>{players.delete(audio);setAudioLevel()};
 audio.addEventListener('ended',finished,{once:true});
 audio.addEventListener('error',finished,{once:true});
 setAudioLevel();
 audio.play().catch(finished);
 return audio;
}
function stopEffects(includeVictory=false){
 for(const [audio,name] of players){
  if(name==='win'&&!includeVictory)continue;
  audio.pause();
  audio.currentTime=0;
  players.delete(audio);
 }
 setAudioLevel();
}
function victorySound(){stopMusic();stopEffects();if(![...players.values()].includes('win'))sound('win')}
function home(){settingsSnapshot=null;cancelTask();stopMusic();stopEffects();game=null;phase='menu';mood();panels();setVisible('game-menu',true);setVisible('stats',false);setVisible('progress',false);$('heading').textContent='🐰 Умный зайчик';$('hint').textContent='Выбери игру!';message('Готов играть?');$('track-label').textContent='Готов к игре'}
function roundQuestionCount(){
 if(game==='memory')return memoryQuestionCount;
 if(game==='russian')return russianDeck.length;
 return mathRoundLength;
}
function chooseMathLength(mode){
 home();
 phase='math-length';
 setVisible('game-menu',false);
 setVisible('math-menu',true);
 $('heading').textContent=icons[mode]+' '+names[mode];
 $('hint').textContent='Сколько заданий будет в раунде?';
 message('');
 const lengths=$('math-lengths');
 lengths.replaceChildren();
 for(const count of mathRoundLengths){
  const button=document.createElement('button');
  button.type='button';
  button.textContent=count+' заданий';
  button.onclick=()=>begin(mode,count);
  lengths.append(button);
 }
}
function stats(){const total=roundQuestionCount();$('counter').textContent='Задание '+Math.min(round+1,total)+' / '+total;$('score').textContent='⭐ '+score;$('progress-fill').style.width=(round/total*100)+'%'}
function begin(which,count=mathRoundLengths[0]){if(which!=='memory'&&which!=='russian')mathRoundLength=mathRoundLengths.includes(count)?count:mathRoundLengths[0];warmAudio();settingsSnapshot=null;cancelTask();stopEffects();game=which;round=0;score=0;phase='start';panels();setVisible('stats',true);setVisible('progress',true);$('heading').textContent=names[game];if(autoMusic)selectedMusic=gameMusic[game];$('song').value=String(selectedMusic);startMusic();newTask()}
function newTask(){if(game==='russian'){russianTask();return}cancelTask();mood();attempt=1;entry='';stats();panels();setVisible('stats',true);setVisible('progress',true);if(game==='memory'){sequence=String(rand(0,9))+rand(0,9)+rand(0,9);answer=sequence;showMemory();return}
let a,b,c,choices=[];if(game==='compare'){a=rand(1,99);b=rand(1,99);while(a===b)b=rand(1,99);answer=a>b?'>':'<';message(`${a} ? ${b}`);choices=['<','>','=']}
if(game==='pattern'){a=rand(1,12);b=rand(2,9);c=a+3*b;message(`${a} · ${a+b} · ${a+2*b} · ?`)}
if(game==='add'){a=rand(1,35);b=rand(1,35);c=a+b;message(`${a} + ${b} = ?`)}
if(game==='multiply'){a=rand(2,9);b=rand(2,9);c=a*b;message(`${a} × ${b} = ?`)}
if(game==='divide'){b=rand(2,9);c=rand(2,9);a=b*c;message(`${a} ÷ ${b} = ?`)}
if(game!=='compare'){answer=String(c);const options=new Set([c]);while(options.size<4)options.add(Math.max(0,c+rand(-12,12)+(options.size===3?17:0)));choices=[...options].sort(()=>Math.random()-.5).map(String)}
$('hint').textContent='Выбери правильный ответ';$('answers').replaceChildren();for(const v of choices){const b=document.createElement('button');b.textContent=v;b.onclick=()=>choose(v);$('answers').append(b)}setVisible('answers',true);phase='answer';setAudioLevel()}
function memoryDisplayTime(){return Math.max(500,1500-Math.floor(round/10)*250)}
function showMemory(){cancelTask();phase='show';panels();setVisible('digits',true);$('digits').textContent=sequence;$('hint').textContent=attempt===1?'Первая попытка':'Вторая попытка';message('Запомни три цифры!');setAudioLevel();wait(memoryDisplayTime(),()=>{phase='answer';entry='';setVisible('digits',false);setVisible('keypad',true);message('Введи цифры по порядку');setAudioLevel()})}
function key(v){if(game!=='memory'||phase!=='answer')return;sound('tap');if(v==='⌫')entry=entry.slice(0,-1);else if(v==='✕')entry='';else if(entry.length<3)entry+=v;message('Ответ: '+entry.padEnd(3,'_'));if(entry.length===3)choose(entry)}
function choose(value){if(game==='russian'){russianChoose(value);return}if(phase!=='answer')return;phase='feedback';setVisible('keypad',false);setVisible('answers',false);if(String(value)===String(answer)){if(attempt===1)score++;$('score').textContent='⭐ '+score;mood('happy');sound('coin');message(attempt===1?'🪙 Правильно! +1 балл':'🐰 Молодец! Правильно!');wait(1000,nextTask)}else if(game==='memory'&&attempt===1){attempt=2;mood('sad');sound('wrong');setVisible('digits',true);$('digits').textContent=sequence;message('Правильный порядок: '+sequence);wait(1800,()=>{mood();sound('retry');showMemory()})}else{mood('sad');sound('wrong');message('Правильный ответ: '+answer);wait(1200,nextTask)}}
function nextTask(){round++;const total=roundQuestionCount();if(round>=total){finish();return}if(round%10===0){mood('happy');sound('bonus');message(`⭐ ${round} заданий пройдено!`);wait(950,newTask)}else newTask()}
function finish(){if(game==='russian'){russianFinish();return}cancelTask();phase='finished';mood('party');panels();setVisible('finished',true);$('progress-fill').style.width='100%';$('counter').textContent='Раунд завершён';$('score').textContent='⭐ '+score;$('heading').textContent='🏆 Победа!';$('hint').textContent=names[game];message(`⭐ Баллов: ${score} из ${roundQuestionCount()}`);victorySound()}
function openSettings(){if(phase==='settings')return;
 const ids=['game-menu','math-menu','answers','keypad','digits','settings','finished','stats','progress','russian-menu','russian-detail'];
 settingsSnapshot={phase,visible:ids.map(id=>[id,!$(id).hidden]),heading:$('heading').textContent,hint:$('hint').textContent,message:$('message').textContent,messageClass:$('message').className,pending:pendingTask?{fn:pendingTask.fn,remaining:Math.max(0,pendingTask.deadline-performance.now())}:null};
 cancelTask();phase='settings';panels();setVisible('settings',true);$('heading').textContent='🎵 Музыкальное меню';$('hint').textContent='Настрой музыку и звуковые эффекты';message('Выбери мелодию');setAudioLevel()
}
function settingsBack(){if(!settingsSnapshot)return;const saved=settingsSnapshot;settingsSnapshot=null;phase=saved.phase;for(const [id,visible] of saved.visible)setVisible(id,visible);$('heading').textContent=saved.heading;$('hint').textContent=saved.hint;message(saved.message);$('message').className=saved.messageClass;musicPreview=false;if(!musicAllowed())stopMusic();else if(phase==='player-album')startMusic();setAudioLevel();if(saved.pending)wait(saved.pending.remaining,saved.pending.fn)}
for(const [id,name] of Object.entries(names)){const b=document.createElement('button');b.textContent=icons[id]+' '+name;b.onclick=()=>id==='memory'?begin(id):chooseMathLength(id);$('game-menu').append(b)}
for(const k of ['1','2','3','4','5','6','7','8','9','⌫','0','✕']){const b=document.createElement('button');b.textContent=k;b.onclick=()=>key(k);$('keypad').append(b)}
for(let i=0;i<music.length;i++){const o=document.createElement('option');o.value=String(i);o.textContent=`${i+1}. ${music[i].name}`;$('song').append(o)}$('song').disabled=true;
const themeButtons = document.querySelectorAll('[data-theme]');
function applyTheme(selected) {
 const theme = selected.dataset.theme;
 for (const button of themeButtons) {
  button.classList.toggle('selected', button === selected);
  button.setAttribute('aria-pressed', String(button === selected));
 }
 $('app').classList.toggle('modern', theme === 'modern');
 $('app').classList.toggle('mario', theme === 'mario');
 $('rabbit').setAttribute('aria-label', theme === 'mario' ? 'Прыжок Марио' : 'Прыгнуть');
}
for (const button of themeButtons) {
 button.setAttribute('aria-pressed', String(button.dataset.theme === 'original'));
 button.onclick = () => applyTheme(button);
}

if (typeof Image !== 'undefined') {
 const sprites = ['mario', 'jump', 'win', 'mushroom', 'koopa', 'goomba'];
 Promise.all(sprites.map(name => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = resolve;
  image.onerror = reject;
  image.src = 'assets/sprites/mario/all-stars/' + name + '.png';
 }))).then(() => setVisible('mario-theme', true)).catch(() => {
  // The Nintendo graphics are installed only on the home server.
 });
}
$('home').onclick=home;$('math-back').onclick=home;$('replay').onclick=()=>game==='russian'?beginRussian(russianTopic):begin(game,mathRoundLength);$('open-settings').onclick=openSettings;$('settings-back').onclick=settingsBack;
$('auto-music').onchange=e=>{autoMusic=e.target.checked;$('song').disabled=autoMusic;if(autoMusic&&(game||musicScreen()==='player-album')){if(game)selectedMusic=gameMusic[game];$('song').value=String(selectedMusic);startMusic(phase==='settings')}};
$('song').onchange=e=>{selectedMusic=Number(e.target.value);if(musicWanted||musicNodes.length||phase==='settings')startMusic(phase==='settings')};
$('music-volume').oninput=e=>{musicVolume=Number(e.target.value)/100;$('music-value').textContent=e.target.value+'%';setAudioLevel()};
$('fx-volume').oninput=e=>{fxVolume=Number(e.target.value)/100;for(const a of players.keys())a.volume=fxVolume;$('fx-value').textContent=e.target.value+'%'};
$('enable-music').onchange=e=>{enableMusic=e.target.checked;if(enableMusic)startMusic(phase==='settings');else stopMusic();setAudioLevel()};
$('enable-victory').onchange=e=>{enableVictory=e.target.checked};
$('preview').onclick=()=>{if(autoMusic){autoMusic=false;$('auto-music').checked=false;$('song').disabled=false}enableMusic=true;$('enable-music').checked=true;startMusic(true)};
$('test-victory').onclick=victorySound;
$('mute').onclick=()=>{mute=!mute;$('mute').textContent=mute?'🔇 Выкл.':'🔊 Вкл.';if(mute){stopMusic();stopEffects(true)}else if(musicAllowed()&&enableMusic)startMusic();setAudioLevel()};
home();

$('rabbit').setAttribute('role','button');$('rabbit').tabIndex=0;$('rabbit').setAttribute('aria-label','Прыгнуть');
function jump(){if([...players.values()].includes('win'))return;mood();void $('rabbit').offsetWidth;mood('happy');sound('jump')}
$('rabbit').onclick=jump;$('rabbit').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();jump()}};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&!b.closest('#keypad')&&!['test-victory','mute','choose-player','album-page'].includes(b.id))sound('tap')});

function formatMenuIcon(element) {
  const match = element.textContent.match(/^(\p{Extended_Pictographic}\uFE0F?)\s+(.+)$/u);
  if (!match) return;
  const icon = document.createElement('span');
  icon.className = 'menu-icon';
  icon.textContent = match[1];
  icon.setAttribute('aria-hidden', 'true');
  element.replaceChildren(icon, ' ' + match[2]);
}
const menuHeading = document.getElementById('heading');
for (const element of document.querySelectorAll('#heading, .theme-bar button, #game-menu button')) {
  formatMenuIcon(element);
}
if (typeof MutationObserver === 'function') {
  new MutationObserver(() => {
    if (!menuHeading.firstElementChild) formatMenuIcon(menuHeading);
  }).observe(menuHeading, { childList: true });
}
