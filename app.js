'use strict';
// Smart Bunny game. Music and effects are served from local WAV assets.
const $=id=>document.getElementById(id);
const names={memory:'Запоминание чисел',compare:'Сравнение чисел',pattern:'Найди закономерность',add:'Сложение',multiply:'Умножение',divide:'Деление'};
const icons={memory:'🧠',compare:'⚖️',pattern:'🔮',add:'➕',multiply:'✖️',divide:'➗'};
const effects={coin:'smb_coin.wav',jump:'smb_jump-small.wav',wrong:'smb_bump.wav',retry:'smb_powerup_appears.wav',bonus:'smb_1-up.wav',tap:'smb_kick.wav',playerIntro:'smb_player_intro.wav',albumClear:'smb_album_clear.wav',win:'smb_stage_clear.wav',stickerClear:'smb_world_clear.wav',collectionClear:'smb_world_clear.wav'};
const music=[
 {name:'Overworld (Ground Theme)',file:'overworld.wav'},
 {name:'Underground Theme',file:'underground.wav'},
 {name:'Underwater Theme',file:'underwater.wav'},
 {name:'Castle Theme',file:'castle.wav'},
 {name:'Starman (Invincibility Theme)',file:'starman.wav'},
 {name:'Ending Theme',file:'ending.wav'},
 {name:'Mario 2 · Character Select',file:'smb2-character-select.wav'},
 {name:'Mario 2 · Overworld',file:'smb2-overworld.wav'},
 {name:'Mario 3 · World 1 Map',file:'smb3-world1-map.wav'},
 {name:'Mario 3 · Athletic',file:'smb3-athletic.wav'}
];
const mathRoundLengths=[10,50,100];
const memoryQuestionCount=50;
let mathRoundLength=mathRoundLengths[0];
const gameMusic={memory:2,compare:7,pattern:3,add:7,multiply:4,divide:1,russian:2};
let game=null,phase='menu',round=0,score=0,attempt=1,sequence='',answer='',entry='',taskToken=0,timeout=null;
let audioCtx=null,musicBus=null,musicNodes=[],musicGeneration=0,musicWanted=false,musicPreview=false,selectedMusic=0,autoMusic=true,enableMusic=true,enableVictory=true,mute=false,musicVolume=.35,fxVolume=.65,taskVolume=.65;
let pendingTask=null,settingsSnapshot=null,pendingAlbumSound=null;
const rand=(min,max)=>Math.floor(Math.random()*(max-min+1))+min;
const setVisible=(id,visible)=>$(id).hidden=!visible;
function cancelTask(){taskToken++;clearTimeout(timeout);timeout=null;pendingTask=null}
function wait(ms,fn){const token=++taskToken;clearTimeout(timeout);pendingTask={fn,deadline:performance.now()+ms};timeout=setTimeout(()=>{if(token===taskToken){pendingTask=null;timeout=null;fn()}},ms)}
function mood(name=''){$('rabbit').className='rabbit '+name}
function message(text){$('message').textContent=text}
function panels(){['game-menu','math-modes','math-menu','school-menu','school-table','answers','keypad','digits','settings','finished','russian-menu','russian-detail'].forEach(id=>setVisible(id,false))}
const audioBuffers=new Map(),retiringMusic=new Set(),players=new Map();
let loopManifest=null,audioHidden=false,musicProfile=null,roundAudio=null,audioFanfare=null,audioSettingsRevision=0;
const audioSettingsDefaults={autoMusic:true,selectedMusic:0,enableMusic:true,enableVictory:true,mute:false,musicVolume:.35,fxVolume:.65,taskVolume:.65};
const audioPreferenceKey=field=>'bunny-audio-'+field;
function ensureAudio(){
 if(audioHidden||document.hidden)return false;
 try{if(!audioCtx){const C=window.AudioContext||window.webkitAudioContext;audioCtx=new C();musicBus=audioCtx.createGain();musicBus.connect(audioCtx.destination)}
  if(audioCtx.state==='suspended'||audioCtx.state==='interrupted')audioCtx.resume().catch(()=>{});return true;
 }catch{return false}
}
function decodeAudio(data){return new Promise((resolve,reject)=>audioCtx.decodeAudioData(data,resolve,reject))}
function loadAudio(url){if(!audioBuffers.has(url)){const pending=fetch(url).then(r=>{if(!r.ok)throw new Error('Audio HTTP '+r.status);return r.arrayBuffer()}).then(decodeAudio).catch(e=>{audioBuffers.delete(url);throw e});audioBuffers.set(url,pending)}return audioBuffers.get(url)}
function loadLoops(){if(!loopManifest)loopManifest=fetch('assets/audio/music/loops.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Loop metadata HTTP '+r.status);return r.json()}).catch(e=>{loopManifest=null;throw e});return loopManifest}
function musicScreen(){return phase==='settings'?settingsSnapshot?.phase:phase}
function musicAllowed(){const screen=musicScreen();return screen!=='player-mario'&&Boolean((phase==='settings'&&musicPreview)||['menu','player-select','player-mario-select','player-album','math-length','math-menu','school-menu','russian-menu'].includes(screen)||game)}
function targetMusic(){if(!autoMusic)return selectedMusic;const screen=musicScreen();if(screen==='player-album')return 8;if(!game||screen==='menu'||screen==='player-select')return 6;if(game==='mission')return 9;return gameMusic[game]??7}
function setAudioLevel(){
 window.bunnyReplay?.setEffectsVolume?.(mute||audioHidden?0:fxVolume);
 for(const [player,name] of players)player.volume=mute||audioHidden?0:(['coin','wrong','retry','bonus'].includes(name)?taskVolume:fxVolume);
 if(musicBus&&audioCtx)musicBus.gain.setTargetAtTime(!mute&&!audioHidden&&enableMusic?musicVolume*(audioFanfare ? .15 : 1):0,audioCtx.currentTime,.035);
}
function retireMusic(fade=0){const now=audioCtx?.currentTime||0;for(const n of musicNodes){if(fade){n.gain.gain.cancelScheduledValues(now);n.gain.gain.setValueAtTime(n.gain.gain.value,now);n.gain.gain.linearRampToValueAtTime(0,now+fade)}retiringMusic.add(n);try{n.source.stop(now+fade)}catch{}}musicNodes=[]}
function stopMusic(){pendingAlbumSound=null;musicGeneration++;musicWanted=false;musicPreview=false;retireMusic();for(const n of retiringMusic){try{n.source.stop()}catch{}}$('track-label').textContent='Музыка остановлена'}
async function startMusic(preview=false){
 musicWanted=true;musicPreview=preview;
 if(!enableMusic||mute||!musicAllowed()){stopMusic();return}
 const index=targetMusic();
 if(audioHidden||document.hidden)return;
 if(!ensureAudio())return;
 // Preserve the exact source and playback position while the selected theme stays the same.
 if(musicNodes.some(node=>node.index===index)){musicGeneration++;setAudioLevel();$('track-label').textContent='♫ '+music[index].name;return}
 const token=++musicGeneration;
 $('track-label').textContent='Загрузка: '+music[index].name;
 try{
  await audioCtx.resume();
  const [buffer,manifest]=await Promise.all([loadAudio('assets/audio/music/'+music[index].file),loadLoops()]);
  if(token!==musicGeneration||audioHidden||document.hidden||!musicWanted||!musicAllowed()||mute||!enableMusic||index!==targetMusic())return;
  const loop=manifest.tracks.find(t=>t.file===music[index].file);
  if(!loop||!Number.isInteger(loop.loop_start_sample)||!Number.isInteger(loop.loop_end_sample_exclusive)||loop.sample_rate!==44100)throw Error('Invalid loop metadata');
  const start=loop.loop_start_sample/44100,end=loop.loop_end_sample_exclusive/44100;
  if(!(start>=0&&end>start&&end<=buffer.duration+1/buffer.sampleRate))throw Error('Loop outside audio buffer');
  const now=audioCtx.currentTime,source=audioCtx.createBufferSource(),gain=audioCtx.createGain();
  source.buffer=buffer;source.loop=true;source.loopStart=start;source.loopEnd=Math.min(end,buffer.duration);source.connect(gain);gain.connect(musicBus);
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(1,now+.12);retireMusic(.12);
  const node={source,gain,index};musicNodes.push(node);
  source.onended=()=>{retiringMusic.delete(node);source.disconnect();gain.disconnect();const i=musicNodes.indexOf(node);if(i>=0)musicNodes.splice(i,1)};
  setAudioLevel();source.start(now);$('track-label').textContent='♫ '+music[index].name;
 }catch(e){if(token===musicGeneration){$('track-label').textContent='Музыка недоступна — попробуй ещё раз';console.warn('Music playback:',e)}}
}
function warmAudio(){if(!ensureAudio())return;loadAudio('assets/audio/smb_stage_clear.wav').catch(()=>{});loadLoops().catch(()=>{})}
function resumeWantedMusic(){if(musicWanted&&musicAllowed())startMusic(musicPreview)}
function albumRewardSound(){} // Opening an album is a view, never a new reward event.
function playFanfare(name='win'){
 if(mute||!enableVictory||audioHidden||document.hidden||musicScreen()==='player-mario'||!ensureAudio())return;
 if(audioFanfare)return;
 const player={source:null,gain:null,cancelled:false,_volume:fxVolume,pause(){this.cancelled=true;try{this.source?.stop()}catch{}},get volume(){return this._volume},set volume(v){this._volume=v;if(this.gain)this.gain.gain.setTargetAtTime(v,audioCtx.currentTime,.015)}};
 audioFanfare=player;players.set(player,name);setAudioLevel();
 const finish=()=>{players.delete(player);if(audioFanfare===player)audioFanfare=null;player.source?.disconnect();player.gain?.disconnect();setAudioLevel();};
 loadAudio('assets/audio/'+effects[name]).then(buffer=>{
  if(player.cancelled||!players.has(player)||audioHidden||document.hidden||mute){finish();return}
  const source=audioCtx.createBufferSource(),gain=audioCtx.createGain();player.source=source;player.gain=gain;source.buffer=buffer;source.connect(gain);gain.connect(audioCtx.destination);gain.gain.value=fxVolume;
  source.onended=finish;source.start();
 }).catch(e=>{finish();console.warn('Fanfare playback:',e)});
 return player;
}
function playVictory(){return playFanfare('win')}
function sound(name){
 if(musicScreen()==='player-mario'||mute||audioHidden||document.hidden||!ensureAudio())return;
 if(['win','stickerClear','collectionClear'].includes(name))return playFanfare(name);
 if(audioFanfare||!effects[name])return;
 const audio=new Audio('assets/audio/'+effects[name]);audio.volume=['coin','wrong','retry','bonus'].includes(name)?taskVolume:fxVolume;players.set(audio,name);
 const done=()=>players.delete(audio);audio.addEventListener('ended',done,{once:true});audio.addEventListener('error',done,{once:true});audio.play().catch(done);return audio;
}
function stopEffects(includeVictory=false){for(const [player,name] of players){if(audioFanfare===player&&!includeVictory)continue;player.pause();players.delete(player);if(audioFanfare===player)audioFanfare=null;}setAudioLevel()}
function victorySound(){if(roundAudio&&!roundAudio.played)return;stopEffects(true);playVictory()}
function planRoundAudio(id,owner){roundAudio={id,owner,played:false}}
function completeRoundAudio(id,owner,event){
 if(!roundAudio||roundAudio.id!==id||roundAudio.owner!==owner||roundAudio.played)return;
 roundAudio.played=true;
 if(event?.kind==='collection'&&phase==='finished')message($('message').textContent+'\n🎉 Коллекция собрана: '+event.collections.map(group=>group.name).join(', ')+'!');
 stopEffects(true);playFanfare(event?.kind==='collection'?'collectionClear':event?.kind==='sticker'?'stickerClear':'win');
}
function syncAudioControls(){
 for(const field of ['autoMusic','enableMusic','enableVictory'])$({'autoMusic':'auto-music','enableMusic':'enable-music','enableVictory':'enable-victory'}[field]).checked=({autoMusic,enableMusic,enableVictory})[field];
 $('song').value=String(selectedMusic);$('song').disabled=autoMusic;
 for(const [id,value] of [['music',musicVolume],['fx',fxVolume],['task',taskVolume]]){$(id+'-volume').value=String(Math.round(value*100));$(id+'-value').textContent=Math.round(value*100)+'%'}
 $('mute').textContent=mute?'🔇 Выкл.':'🔊 Вкл.';
}
function audioSettings(){return {autoMusic,selectedMusic,enableMusic,enableVictory,mute,musicVolume,fxVolume,taskVolume}}
function saveAudioSetting(field){audioSettingsRevision++;window.bunnyAudioPreferences?.save(audioPreferenceKey(field),String(audioSettings()[field]));}
function loadAudioProfile(profile){
 if(musicProfile!==profile?.id){stopEffects(true);stopMusic();roundAudio=null;musicProfile=profile?.id??null;}
 const values={...audioSettingsDefaults};
 for(const field of Object.keys(values)){const raw=profile?.preferences?.[audioPreferenceKey(field)];if(raw===undefined)continue;if(typeof values[field]==='boolean'){if(raw==='true'||raw==='false')values[field]=raw==='true';}else{const n=Number(raw);if(Number.isFinite(n)&&n>=0&&n<=(field==='selectedMusic'?music.length-1:1)&&(field!=='selectedMusic'||Number.isInteger(n)))values[field]=n;}}
 ({autoMusic,selectedMusic,enableMusic,enableVictory,mute,musicVolume,fxVolume,taskVolume}=values);syncAudioControls();setAudioLevel();
}
function hideAudio(){if(audioHidden)return;audioHidden=true;musicGeneration++;stopEffects(true);setAudioLevel();audioCtx?.suspend?.().catch(()=>{});}
function showAudio(){if(document.hidden)return;audioHidden=false;setAudioLevel();if(!mute&&enableMusic&&musicAllowed())startMusic(musicPreview);}
document.addEventListener('visibilitychange',()=>document.hidden?hideAudio():showAudio());
window.addEventListener('pagehide',hideAudio);window.addEventListener('pageshow',showAudio);
// iOS may require a fresh gesture before AudioContext can resume after interruption.
document.addEventListener('pointerdown',()=>{if(!document.hidden&&!audioHidden&&['suspended','interrupted'].includes(audioCtx?.state)&&musicAllowed())startMusic(musicPreview)},{passive:true});

function home(){settingsSnapshot=null;cancelTask();updateMarioCourse(0,0);stopEffects();game=null;phase='menu';mood();panels();setVisible('game-menu',true);setVisible('stats',false);setVisible('progress',false);$('heading').textContent='🐰 Умный зайчик';$('hint').textContent='Выбери игру!';message('Готов играть?');startMusic()}
function roundQuestionCount(){
 if(game==='memory')return memoryQuestionCount;
 if(game==='russian')return russianDeck.length;
 if(game==='mission')return window.bunnyMissions.count();
 if(game==='school')return window.bunnySchool.count();
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
function begin(which,count=mathRoundLengths[0]){if(which!=='memory'&&which!=='russian')mathRoundLength=mathRoundLengths.includes(count)?count:mathRoundLengths[0];warmAudio();settingsSnapshot=null;cancelTask();stopEffects();game=which;round=0;score=0;updateMarioCourse(0,roundQuestionCount());phase='start';panels();setVisible('stats',true);setVisible('progress',true);$('heading').textContent=names[game];startMusic();newTask()}
function makeMathQuestion(mode){
 let a,b,c,question;
 if(mode==='compare'){
  a=rand(1,99);b=rand(1,99);while(a===b)b=rand(1,99);
  return {question:`${a} ? ${b}`,correct:a>b?'>':'<',choices:['<','>','=']};
 }
 if(mode==='pattern'){a=rand(1,12);b=rand(2,9);c=a+3*b;question=`${a} · ${a+b} · ${a+2*b} · ?`}
 if(mode==='add'){a=rand(1,35);b=rand(1,35);c=a+b;question=`${a} + ${b} = ?`}
 if(mode==='multiply'){a=rand(2,9);b=rand(2,9);c=a*b;question=`${a} × ${b} = ?`}
 if(mode==='divide'){b=rand(2,9);c=rand(2,9);a=b*c;question=`${a} ÷ ${b} = ?`}
 const options=new Set([c]);while(options.size<4)options.add(Math.max(0,c+rand(-12,12)+(options.size===3?17:0)));
 return {question,correct:String(c),choices:[...options].sort(()=>Math.random()-.5).map(String)};
}
function newTask(){if(game==='russian'){russianTask();return}if(game==='mission'){window.bunnyMissions.task();return}if(game==='school'){window.bunnySchool.task();return}cancelTask();mood();attempt=1;entry='';stats();panels();setVisible('stats',true);setVisible('progress',true);if(game==='memory'){sequence=String(rand(0,9))+rand(0,9)+rand(0,9);answer=sequence;showMemory();return}
const {question,correct,choices}=makeMathQuestion(game);answer=correct;message(question);
$('hint').textContent='Выбери правильный ответ';$('answers').replaceChildren();for(const v of choices){const b=document.createElement('button');b.textContent=v;b.onclick=()=>choose(v);$('answers').append(b)}setVisible('answers',true);phase='answer';setAudioLevel()}
function memoryDisplayTime(){return Math.max(500,1500-Math.floor(round/10)*250)}
function showMemory(){cancelTask();phase='show';panels();setVisible('digits',true);$('digits').textContent=sequence;$('hint').textContent=attempt===1?'Первая попытка':'Вторая попытка';message('Запомни три цифры!');setAudioLevel();wait(memoryDisplayTime(),()=>{phase='answer';entry='';setVisible('digits',false);setVisible('keypad',true);message('Введи цифры по порядку');setAudioLevel()})}
function key(v){if(game!=='memory'||phase!=='answer')return;sound('tap');if(v==='⌫')entry=entry.slice(0,-1);else if(v==='✕')entry='';else if(entry.length<3)entry+=v;message('Ответ: '+entry.padEnd(3,'_'));if(entry.length===3)choose(entry)}
function choose(value){if(game==='russian'){russianChoose(value);return}if(game==='mission'){window.bunnyMissions.answer(value);return}if(game==='school'){window.bunnySchool.answer(value);return}if(phase!=='answer')return;phase='feedback';setVisible('keypad',false);setVisible('answers',false);if(String(value)===String(answer)){if(attempt===1)score++;$('score').textContent='⭐ '+score;mood('happy');sound('coin');message(attempt===1?'🪙 Правильно! +1 балл':'🐰 Молодец! Правильно!');wait(1000,nextTask)}else if(game==='memory'&&attempt===1){attempt=2;mood('sad');sound('wrong');setVisible('digits',true);$('digits').textContent=sequence;message('Правильный порядок: '+sequence);wait(1800,()=>{mood();sound('retry');showMemory()})}else{mood('sad');sound('wrong');message('Правильный ответ: '+answer);wait(1200,nextTask)}}
function nextTask(){round++;const total=roundQuestionCount();if(round>=total){finish();return}updateMarioCourse(round,total);if(round%10===0){mood('happy');sound('bonus');message(`⭐ ${round} заданий пройдено!`);wait(950,newTask)}else newTask()}
function finish(){const total=roundQuestionCount();updateMarioCourse(total,total);if(game==='russian'){russianFinish();return}if(game==='mission'){window.bunnyMissions.finish();return}if(game==='school'){window.bunnySchool.finish();return}cancelTask();phase='finished';mood('party');panels();setVisible('finished',true);$('progress-fill').style.width='100%';$('counter').textContent='Раунд завершён';$('score').textContent='⭐ '+score;$('heading').textContent='🏆 Победа!';$('hint').textContent=names[game];message(`⭐ Баллов: ${score} из ${roundQuestionCount()}`);victorySound()}
function openSettings(){if(phase==='settings')return;
 const ids=['game-menu','math-modes','math-menu','school-menu','school-table','answers','keypad','digits','settings','finished','stats','progress','russian-menu','russian-detail'];
 settingsSnapshot={phase,visible:ids.map(id=>[id,!$(id).hidden]),heading:$('heading').textContent,hint:$('hint').textContent,message:$('message').textContent,messageClass:$('message').className,pending:pendingTask?{fn:pendingTask.fn,remaining:Math.max(0,pendingTask.deadline-performance.now())}:null};
 cancelTask();phase='settings';panels();setVisible('settings',true);$('heading').textContent='🎵 Музыкальное меню';$('hint').textContent='Настрой музыку и звуковые эффекты';message('Выбери мелодию');setAudioLevel()
}
function settingsBack(){if(!settingsSnapshot)return;const saved=settingsSnapshot;settingsSnapshot=null;phase=saved.phase;for(const [id,visible] of saved.visible)setVisible(id,visible);$('heading').textContent=saved.heading;$('hint').textContent=saved.hint;message(saved.message);$('message').className=saved.messageClass;musicPreview=false;startMusic();setAudioLevel();if(saved.pending)wait(saved.pending.remaining,saved.pending.fn)}
for(const [id,name] of Object.entries(names)){const b=document.createElement('button');b.textContent=icons[id]+' '+name;b.onclick=()=>id==='memory'?begin(id):chooseMathLength(id);$('math-games').append(b)}
{const b=document.createElement('button');b.textContent='🔢 Математика';b.onclick=()=>openMathMenu();$('game-menu').append(b)}
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
 window.bunnyReplay?.setTheme(theme === 'mario');
 $('rabbit').setAttribute('aria-label', theme === 'mario' ? 'Прыжок Марио' : 'Прыгнуть');
}
for (const button of themeButtons) {
 button.setAttribute('aria-pressed', String(button.dataset.theme === 'original'));
 button.onclick = () => applyTheme(button);
}

let marioArtReady=false;
function warmMarioArt() {
 if (marioArtReady || typeof Image === 'undefined') return;
 const sprites = ['hero', 'mushroom', 'koopa', 'shell', 'goomba'];
 Promise.all(sprites.map(name => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = resolve;
  image.onerror = reject;
  image.src = 'assets/sprites/mario/drawn/' + name + '.png';
 }))).then(() => {marioArtReady=true;setVisible('mario-theme', true)}).catch(() => {
  // The Nintendo graphics are installed only on the home server.
 });
}
window.bunnyAssets={warm:warmMarioArt};
warmMarioArt();
$('home').onclick=home;$('math-back').onclick=()=>openMathMenu();$('math-modes-back').onclick=home;$('replay').onclick=()=>game==='russian'?beginRussian(russianTopic):begin(game,mathRoundLength);$('open-settings').onclick=openSettings;$('settings-back').onclick=settingsBack;
$('auto-music').onchange=e=>{autoMusic=e.target.checked;syncAudioControls();saveAudioSetting('autoMusic');startMusic(phase==='settings')};
$('song').onchange=e=>{selectedMusic=Number(e.target.value);saveAudioSetting('selectedMusic');startMusic(phase==='settings')};
$('music-volume').oninput=e=>{audioSettingsRevision++;musicVolume=Number(e.target.value)/100;syncAudioControls();setAudioLevel()};
$('fx-volume').oninput=e=>{audioSettingsRevision++;fxVolume=Number(e.target.value)/100;syncAudioControls();setAudioLevel()};
$('task-volume').oninput=e=>{audioSettingsRevision++;taskVolume=Number(e.target.value)/100;syncAudioControls();setAudioLevel()};
for(const [id,field]of [['music-volume','musicVolume'],['fx-volume','fxVolume'],['task-volume','taskVolume']])$(id).onchange=()=>saveAudioSetting(field);
$('enable-music').onchange=e=>{enableMusic=e.target.checked;saveAudioSetting('enableMusic');startMusic(phase==='settings');setAudioLevel()};
$('enable-victory').onchange=e=>{enableVictory=e.target.checked;saveAudioSetting('enableVictory')};
$('preview').onclick=()=>{autoMusic=false;enableMusic=true;syncAudioControls();saveAudioSetting('autoMusic');saveAudioSetting('enableMusic');startMusic(true)};
$('test-victory').onclick=()=>{stopEffects(true);playVictory()};
$('mute').onclick=()=>{mute=!mute;syncAudioControls();saveAudioSetting('mute');if(mute){stopMusic();stopEffects(true)}else startMusic();setAudioLevel()};

home();

$('rabbit').setAttribute('role','button');$('rabbit').tabIndex=0;$('rabbit').setAttribute('aria-label','Прыгнуть');
function jump(){if($('app').classList.contains?.('mario')){marioAction('hero');return}if([...players.values()].includes('win'))return;mood();void $('rabbit').offsetWidth;mood('happy');sound('jump')}
$('rabbit').onclick=jump;$('rabbit').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();jump()}};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&!b.closest('#keypad,.mario-touch-controls')&&!['test-victory','mute','choose-player','album-page','mario-mushroom','mario-koopa','mario-goomba'].includes(b.id))sound('tap')});

function updateMarioCourse(completed,total) {
 const progress=total>0?Math.min(1,completed/total):0;
 window.bunnyReplay?.setProgress(completed,total);
 const stage=$('mario-stage');
 $('mario-track').style.setProperty?.('--course-position',(progress*100)+'%');
 stage.setAttribute('data-area',progress<1/3?'meadow':progress<2/3?'hills':'castle');
 stage.setAttribute('data-arrived',String(total>0&&completed>=total));
 $('mario-area').textContent=total>0&&completed>=total?'Финиш!':progress<1/3?'Поляна':progress<2/3?'Холмы':'Замок';
}

const marioMoves = {
 hero: [{transform:'translateY(0)'},{transform:'translateY(-25px) rotate(-8deg)'},{transform:'translateY(0)'}],
 mushroom: [{transform:'scale(1)'},{transform:'translateY(-9px) scale(1.19)'},{transform:'scale(1)'}],
 koopa: [{transform:'rotate(0)'},{transform:'rotate(14deg)'},{transform:'rotate(0)'}],
 goomba: [{transform:'scale(1)'},{transform:'scale(1.22,.56)'},{transform:'scale(.96,1.09)'},{transform:'scale(1)'}]
};
const marioAnimations = new WeakMap();
let marioTaps = [];
let marioSecretTimer;
let marioShellTimer;
function animateMario(element,frames,duration) {
 if (typeof element.animate!=='function'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 marioAnimations.get(element)?.cancel();
 marioAnimations.set(element,element.animate(frames,{duration,easing:'ease-in-out'}));
}
function showMarioSecret(text) {
 clearTimeout(marioSecretTimer);
 const stage=$('mario-stage');
 stage.setAttribute('data-surprise','true');
 $('mario-secret').textContent=text;
 marioSecretTimer=setTimeout(()=>{
  stage.setAttribute('data-surprise','false');
  $('mario-secret').textContent='';
 },2500);
}
function marioAction(character) {
 const now=performance.now();
 marioTaps=marioTaps.filter(tap=>now-tap.time<=4800).slice(-2);
 marioTaps.push({character,time:now});
 const sequence=marioTaps.map(tap=>tap.character).join('/');
 if(sequence==='hero/hero/hero'&&now-marioTaps[0].time<=1600) {
  marioTaps=[];
  animateMario($('mario-art'),[
   {transform:'translateY(0) rotate(0deg)'},
   {transform:'translateY(-27px) rotate(180deg)'},
   {transform:'translateY(0) rotate(360deg)'}
  ],600);
  showMarioSecret('⭐ Звёздный прыжок!');
  sound('bonus');
  return;
 }
 if(sequence==='mushroom/koopa/hero') {
  marioTaps=[];
  const stage=$('mario-stage');
  const night=stage.getAttribute('data-night')!=='true';
  stage.setAttribute('data-night',String(night));
  showMarioSecret(night?'🌙 Секретная звёздная ночь!':'☀️ Снова рассвет!');
  sound('bonus');
  return;
 }
 const actor=character==='hero'?$('mario-art'):$('mario-'+character).firstElementChild;
 if(character==='koopa'){
  const koopa=$('mario-koopa');
  clearTimeout(marioShellTimer);
  koopa.setAttribute('data-shell','true');
  marioShellTimer=setTimeout(()=>koopa.setAttribute('data-shell','false'),750);
 }
 animateMario(actor,marioMoves[character],430);
 sound(character==='hero'?'jump':character==='mushroom'?'retry':'tap');
}
for(const character of ['mushroom','koopa','goomba'])$('mario-'+character).onclick=()=>marioAction(character);

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
