'use strict';

(() => {
  const replayFrameMs = 1000 / 60.0988138974405;
  const assets = 'assets/emulation/';
  const levelTitle=level=>`${Math.floor(level/4)+1}-${level%4+1}`;
  let routeManifest;
  function romSignature(bytes){let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;return hash.toString(16).padStart(8,'0');}
  async function loadRouteManifest(){
    if(!routeManifest)routeManifest=fetch(assets+'routes/manifest.json',{cache:'no-cache'}).then(response=>{if(!response.ok)throw Error('Маршруты недоступны. Проверь соединение.');return response.json();}).catch(error=>{routeManifest=null;throw error;});
    return routeManifest;
  }
  async function loadRoutePacket(record,folder='routes/'){
    let response;
    if(typeof DecompressionStream==='function'){
      response=await fetch(assets+folder+record.compressed);
      if(!response.ok)throw Error('Не удалось загрузить маршрут.');
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
    }
    response=await fetch(assets+folder+record.file);
    if(!response.ok)throw Error('Не удалось загрузить маршрут.');
    return response.json();
  }
  function expandRuns(runs,maximum,limit){
    if(!Array.isArray(runs))throw Error('Некорректный маршрут.');
    const values=[];
    for(const pair of runs){if(!Array.isArray(pair)||pair.length!==2||!Number.isInteger(pair[0])||pair[0]<1||!Number.isInteger(pair[1])||pair[1]<0||pair[1]>maximum||values.length+pair[0]>limit)throw Error('Некорректный маршрут.');for(let i=0;i<pair[0];i++)values.push(pair[1]);}
    return values;
  }
  const levelSelect = $('nes-level');
  const progressLabel = $('nes-caption');
  const status = $('nes-status');
  const romInput = $('nes-rom');
  const screen = $('nes-screen');
  const stage = $('mario-stage');
  const toggle = $('nes-toggle');
  const setup = $('nes-setup');
  const canvas = $('nes-picture');
  const context = canvas.getContext('2d');
  if (!context) return;

  const image = context.createImageData(256,240);
  const pixels = new Uint32Array(image.data.buffer);
  let dependencies;
  let rom;
  const verifiedLevels = new Map();
  let verified;
  let session;
  let target = 0;
  let frame = 0;
  let lastFrame = null;
  let frameRequest = 0;
  let chosen = false;
  let marioTheme = false;
  let loadVersion = 0;
  let currentCompleted = 0;
  let currentTotal = 0;
  let manualActive = false;
  let effectsBus;
  let nextAudioTime = 0;
  const effectSources = new Set();
  let sampleCount = 0;
  const leftSamples = new Float32Array(4096);
  const rightSamples = new Float32Array(4096);
  // Discovery clips run in another NES instance. The learning route stays intact.
  const secrets = [
    {id:'oneup11',level:0,title:'Скрытый гриб 1‑UP',hint:'1‑1 · После четвёртой трубы прыгни под невидимым блоком. Зелёный гриб добавит жизнь.',proof:'life'},
    {id:'coins11',level:0,title:'Комната с монетами',hint:'1‑1 · Встань на четвёртую трубу и нажми вниз. Собери монеты и выйди через правую трубу.',proof:'room'},
    {id:'oneup12',level:1,title:'Гриб над шестью монетами',hint:'1‑2 · Над площадкой с шестью монетами спрятан блок с зелёным грибом 1‑UP.',proof:'reveal'},
    {id:'mushroom13',level:2,title:'Бонус на высоте',hint:'1‑3 · Из блока на высокой площадке можно достать супергриб. Он превращает маленького Марио в большого.',proof:'grow'},
    {id:'coins14',level:3,title:'Невидимые монеты в замке',hint:'1‑4 · В просторном зале прыгай под невидимыми блоками: в них спрятаны монеты.',proof:'coins'},
    {id:'oneup21',level:4,title:'Гриб над невидимой ступенькой',hint:'2‑1 · Два скрытых блока ведут к 1‑UP. Гриб появляется после 21 монеты на 1‑3 или продолжения игры.',proof:'life'},
    {id:'cloud21',level:4,title:'Лоза к облачным монетам',hint:'2‑1 · Найди лозу в верхнем кирпиче, поднимись по ней и прыгни на движущуюся платформу за монетами.',proof:'cloud'},
    {id:'coins21',level:4,title:'Подземный запас монет',hint:'2‑1 · После лозы есть труба в монетную комнату. Собери монеты и выйди через правую трубу.',proof:'roomCoins'},
  ];
  const discoveryKey='bunny-mario-discoveries';
  const secretCache=new Map();
  let secretEpoch=0,secretRun=null,secretAttempted=false;
  const secretNotice=$('nes-secret-notice'),secretText=$('nes-secret-text');
  const secretsButton=$('nes-secrets'),secretDialog=$('nes-secret-dialog');
  const secretList=$('nes-secret-list'),secretViewer=$('nes-secret-viewer');
  const secretCanvas=$('nes-secret-picture'),secretContext=secretCanvas.getContext('2d');

  function discoveries(){
    try {const ids=JSON.parse(readPlayerPreference(discoveryKey,'[]'));return new Set(Array.isArray(ids)?ids.filter(id=>secrets.some(s=>s.id===id)):[]);}catch{return new Set();}
  }
  function refreshSecrets(){
    secretsButton.textContent=`📖 Секреты Марио · ${discoveries().size}/${secrets.length}`;
    secretsButton.disabled=currentTotal>0&&currentCompleted<currentTotal;
  }
  function rememberSecret(id,owner){
    if(!owner||activePlayer?.id!==owner)return;
    const found=discoveries();if(found.has(id))return;
    found.add(id);savePlayerPreference(discoveryKey,JSON.stringify([...found]));refreshSecrets();
  }
  function secretLive(run){
    return secretRun===run&&run.epoch===secretEpoch&&activePlayer?.id===run.owner&&!manualActive
      &&(run.inline?chosen&&marioTheme&&currentTotal>0&&currentCompleted<currentTotal:secretDialog.open);
  }
  function cancelSecret(restore=true){
    secretEpoch++;
    if(secretRun?.request)cancelAnimationFrame(secretRun.request);
    secretRun=null;secretNotice.hidden=true;stopEffectsPlayback();lastFrame=null;
    if(restore&&session&&verified){paint(frame===0?verified.startImage:session.nes.ppu.buffer);updateCaption();schedulePlayback();}
  }
  async function prepareSecret(record,engine,bytes,run){
    if(secretCache.has(record.id))return secretCache.get(record.id);
    const packet=await loadRoutePacket({file:record.id+'.json',compressed:record.id+'.json.gz'},'secrets/');
    if(!secretLive(run))return null;
    if(packet.version!==1||packet.id!==record.id||packet.level!==levelTitle(record.level)||packet.proof!==record.proof||packet.romSignature!==romSignature(bytes))throw Error('Эпизод не подходит к этому файлу игры.');
    const buttons=expandRuns(packet.inputs,255,900),picture=expandRuns(packet.startImage,0xffffff,256*240);
    if(!Number.isInteger(packet.end)||packet.end<1||buttons.length!==packet.end+1||picture.length!==256*240)throw Error('Неполный эпизод.');
    const probe=makeSession(engine,bytes,()=>{},()=>{});probe.restore(packet.startState,buttons[0]);
    const m=probe.nes.cpu.mem,before={lives:m[0x75a],coins:m[0x75e],status:m[0x756],area:m[0x750]};let reveal=false,room=false,underground=false,cloud=false,vine=false,deadline=performance.now()+8;
    for(let i=1;i<buttons.length;i++){
      if(!secretLive(run))return null;
      probe.step(buttons[i]);
      if(m[0x75f]!==Math.floor(record.level/4)||m[0x75c]!==record.level%4||m[0x770]!==1||[4,5,11].includes(m[0xe]))throw Error('Эпизод не прошёл проверку.');
      reveal ||=m[0x39]===3&&m[0x1b]===46&&m[0x14]!==0;room ||=m[0x750]!==before.area;underground ||=m[0x74e]===2;cloud ||=m[0x743]>0&&m[0x772]===3&&m[0xe]===8;vine ||=m[0x399]>0&&m[0x1b]===47&&m[0x1d]===3;
      if(performance.now()>deadline){await new Promise(resolve=>setTimeout(resolve,0));deadline=performance.now()+8;}
    }
    const coins=(m[0x75e]-before.coins+100)%100;
    const valid=record.proof==='life'?reveal&&m[0x75a]===before.lives+1:record.proof==='room'?room&&m[0x750]===before.area&&coins>=10:record.proof==='roomCoins'?underground&&m[0x74e]===1&&m[0xe]===8&&coins>=8:record.proof==='cloud'?cloud&&vine&&coins>=7:record.proof==='reveal'?reveal:record.proof==='grow'?m[0x756]>before.status:coins>=3;
    if(!valid)throw Error('Бонус не подтверждён в эмуляторе.');
    const result={packet,buttons,picture};secretCache.set(record.id,result);return result;
  }
  async function startSecret(record,inline){
    cancelSecret(false);stopPlayback();
    const run={record,inline,owner:activePlayer?.id,epoch:secretEpoch,request:0,frame:0,last:null,runtime:null};secretRun=run;
    const label=inline?secretText:$('nes-secret-viewer-text');
    label.textContent=record.hint+' Готовим показ…';
    if(inline)secretNotice.hidden=false;else secretViewer.hidden=false;
    try {
      const bytes=rom||new Uint8Array(await readHomeRom()),engine=await loadReplayEngine();
      validateRomHeader(bytes);
      if(!secretLive(run))return;
      const data=await prepareSecret(record,engine,bytes,run);
      if(!data||!secretLive(run))return;
      rom=bytes;run.data=data;
      const render=inline?paint:buffer=>{
        const picture=secretContext.createImageData(256,240),out=new Uint32Array(picture.data.buffer);
        for(let i=0;i<out.length;i++)out[i]=0xff000000|buffer[i];secretContext.putImageData(picture,0,0);
      };
      run.runtime=makeSession(engine,bytes,render,recordSample);run.runtime.restore(data.packet.startState,data.buttons[0]);isolateEffects(run.runtime.nes);render(data.picture);
      label.textContent=record.hint;
      run.request=requestAnimationFrame(now=>advanceSecret(run,now));
    }catch(error){
      if(secretRun!==run)return;
      cancelSecret();
      if(!inline)$('nes-secret-viewer-text').textContent=error.message||'Не удалось показать секрет.';
      // A missing optional episode must never block the next learning question.
    }
  }
  function advanceSecret(run,now){
    run.request=0;
    if(!secretLive(run)){if(secretRun===run)cancelSecret();return;}
    if(document.hidden||phase==='settings'||phase==='show'){run.last=null;stopEffectsPlayback();}
    else {
      const count=run.last===null?0:Math.min(3,Math.floor((now-run.last)/replayFrameMs));
      if(run.last===null)run.last=now+900; // Read the hint before the action starts.
      if(count>0){
        run.last=Math.max(now-2*replayFrameMs,run.last+count*replayFrameMs);sampleCount=0;
        for(let i=0;i<count&&run.frame<run.data.packet.end;i++)run.runtime.step(run.data.buttons[++run.frame]);
        playEffectSamples();
      }
      if(run.frame===run.data.packet.end){
        if(run.inline){rememberSecret(run.record.id,run.owner);cancelSecret();}
        else {$('nes-secret-viewer-text').textContent=run.record.hint+' Показ завершён.';secretRun=null;stopEffectsPlayback();}
        return;
      }
    }
    run.request=requestAnimationFrame(next=>advanceSecret(run,next));
  }
  function maybeShowSecret(){
    if(secretAttempted||manualActive||!chosen||!marioTheme||!session||!activePlayer||currentTotal<2||currentCompleted<Math.min(5,Math.floor(currentTotal/2))||currentCompleted>=currentTotal)return;
    const candidates=secrets.filter(s=>s.level===Number(levelSelect.value));if(!candidates.length)return;
    secretAttempted=true;
    const found=discoveries(),record=candidates.find(s=>!found.has(s.id))||candidates[currentTotal% candidates.length];
    void startSecret(record,true);
  }
  secretsButton.onclick=()=>{
    if(currentTotal>0&&currentCompleted<currentTotal)return;
    cancelSecret();secretList.replaceChildren();secretViewer.hidden=true;
    const found=discoveries();
    for(const record of secrets){
      const button=playerButton(secretList,`${found.has(record.id)?'▶':'🔒'} ${levelTitle(record.level)} · ${record.title}`,()=>{ensureAudio();void startSecret(record,false);});button.disabled=!found.has(record.id);
    }
    secretDialog.showModal();
  };
  $('nes-secret-skip').onclick=()=>cancelSecret();
  $('nes-secret-close').onclick=()=>secretDialog.close();
  secretDialog.addEventListener('close',()=>cancelSecret());
  refreshSecrets();

  function loadEngine() {
    return new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = assets + 'jsnes-2.1.0.min.js';
      script.onload = () => window.jsnes ? resolve(window.jsnes) : reject(Error('Эмулятор не загрузился.'));
      script.onerror = () => { script.remove(); reject(Error('Эмулятор доступен по домашнему адресу игры.')); };
      document.head.append(script);
    });
  }

  function loadReplayEngine() {
    if (!dependencies) {
      const engine = window.jsnes ? Promise.resolve(window.jsnes) : loadEngine();
      dependencies = engine.catch(error => { dependencies=null; throw error; });
    }
    return dependencies;
  }

  function makeSession(engine,rom,render,onAudioSample,mirrorControls=false) {
    const nes = new engine.NES({onFrame:render,onAudioSample,onStatusUpdate:()=>{},sampleRate:44100});
    nes.loadROM(rom);
    const directions = ['RIGHT','LEFT','DOWN','UP','START','SELECT','B','A']
      .map(name => engine.Controller['BUTTON_'+name]);
    let previous = 0;
    return {
      nes,
      restore(state,buttons) {
        nes.fromJSON(structuredClone(state));
        for(let i=0;i<directions.length;i++){
          nes[buttons&(1<<i)?'buttonDown':'buttonUp'](1,directions[i]);
          if(mirrorControls)nes[buttons&(1<<i)?'buttonDown':'buttonUp'](2,directions[i]);
        }
        previous=buttons;
      },
      release() { for(const button of directions){nes.buttonUp(1,button);if(mirrorControls)nes.buttonUp(2,button);}previous=0; },
      step(buttons) {
        for (let i=0;i<8;i++) {
          const mask=1<<i;
          if ((buttons&mask)===(previous&mask)) continue;
          nes[buttons&mask?'buttonDown':'buttonUp'](1,directions[i]);
          // In manual two-player mode the same screen pad controls whoever is
          // taking their turn. The ROM still decides which player is active.
          if(mirrorControls)nes[buttons&mask?'buttonDown':'buttonUp'](2,directions[i]);
        }
        previous=buttons;
        nes.frame();
      },
    };
  }

  function isolateEffects(nes) {
    const apu=nes.papu;
    const sample=apu.sample;
    // The SMB sound engine uses these RAM buffers to give effects priority over music.
    // Its triangle and DMC channels never carry effects.
    const square1Left=apu.stereoPosLSquare1, square1Right=apu.stereoPosRSquare1;
    const square2Left=apu.stereoPosLSquare2, square2Right=apu.stereoPosRSquare2;
    const noiseLeft=apu.stereoPosLNoise, noiseRight=apu.stereoPosRNoise;
    apu.stereoPosLTriangle=apu.stereoPosRTriangle=apu.stereoPosLDMC=apu.stereoPosRDMC=0;
    apu.prevSampleL=apu.prevSampleR=apu.square_table[0]+apu.tnd_table[0]-apu.dcValue;
    apu.smpAccumL=apu.smpAccumR=0;
    apu.sample=function () {
      const ram=nes.cpu.mem;
      const square1=ram[0xf1] || ram[0x07b2];
      const square2=ram[0xf2];
      const noise=ram[0xf3];
      this.stereoPosLSquare1=square1 ? square1Left : 0;
      this.stereoPosRSquare1=square1 ? square1Right : 0;
      this.stereoPosLSquare2=square2 ? square2Left : 0;
      this.stereoPosRSquare2=square2 ? square2Right : 0;
      this.stereoPosLNoise=noise ? noiseLeft : 0;
      this.stereoPosRNoise=noise ? noiseRight : 0;
      sample.call(this);
    };
  }

  function setEffectsVolume(value) {
    if (effectsBus) effectsBus.gain.value=value;
  }

  function recordSample(left,right) {
    if (sampleCount>=leftSamples.length) return;
    leftSamples[sampleCount]=left;
    rightSamples[sampleCount++]=right;
  }

  function stopEffectsPlayback() {
    for (const source of effectSources) source.stop();
    effectSources.clear();
    nextAudioTime=0;
  }

  function playEffectSamples() {
    if (!sampleCount || !audioCtx || audioCtx.state!=='running') return;
    if (!effectsBus) {
      effectsBus=audioCtx.createGain();
      effectsBus.connect(audioCtx.destination);
      setEffectsVolume(mute ? 0 : fxVolume);
    }
    const buffer=audioCtx.createBuffer(2,sampleCount,44100);
    buffer.copyToChannel(leftSamples.subarray(0,sampleCount),0);
    buffer.copyToChannel(rightSamples.subarray(0,sampleCount),1);
    const now=audioCtx.currentTime;
    if (nextAudioTime>now+.10) stopEffectsPlayback();
    if (nextAudioTime<=now) nextAudioTime=now+.025;
    const source=audioCtx.createBufferSource();
    source.buffer=buffer;
    source.connect(effectsBus);
    source.onended=()=>{
      effectSources.delete(source);
      source.disconnect();
    };
    effectSources.add(source);
    source.start(nextAudioTime);
    nextAudioTime+=buffer.duration;
  }

  function validateRomHeader(rom) {
    const expected = [0x4e,0x45,0x53,0x1a,2,1];
    if (rom.length < 40976 || expected.some((byte,i) => rom[i]!==byte)
        || (rom[6]&0xf4) || (rom[7]&0xf0)) {
      throw Error('Нужен оригинальный файл Super Mario Bros. (World/USA–Japan) в формате .nes.');
    }
  }

  async function verifyRoute(engine,rom,level,version) {
    if(!Number.isInteger(level)||level<0||level>31)throw Error('Выберите уровень от 1-1 до 8-4.');
    const manifest=await loadRouteManifest();
    if(manifest.version!==1||manifest.romSignature!==romSignature(rom))throw Error('Этот маршрут подготовлен для другого файла игры. Выберите оригинальный Super Mario Bros. (World).');
    const record=manifest.levels.find(item=>item.id===levelTitle(level));
    if(!record)throw Error('Маршрут уровня пока недоступен.');
    const packet=await loadRoutePacket(record);
    if(version!==loadVersion)return null;
    if(packet.version!==1||packet.id!==record.id||packet.romSignature!==manifest.romSignature||packet.goal!==record.goal||packet.end!==record.end||!Number.isInteger(packet.goal)||!Number.isInteger(packet.end)||packet.goal<1||packet.end<packet.goal)throw Error('Некорректный маршрут уровня.');
    const buttons=expandRuns(packet.inputs,255,20000),startImage=expandRuns(packet.startImage,0xffffff,256*240);
    if(buttons.length!==packet.end+1||startImage.length!==256*240)throw Error('Неполный маршрут уровня.');
    const probe=makeSession(engine,rom,()=>{},()=>{});
    probe.restore(packet.startState,buttons[0]);
    const matches=()=>{const m=probe.nes.cpu.mem;return m[0x075f]===Math.floor(level/4)&&m[0x075c]===level%4;};
    if(!matches()||probe.nes.cpu.mem[0x0770]!==1||probe.nes.cpu.mem[0x0e]!==8)throw Error('Неверное начало уровня.');
    let deadline=performance.now()+8;
    for(let i=1;i<buttons.length;i++){
      if(version!==loadVersion)return null;
      probe.step(buttons[i]);
      const m=probe.nes.cpu.mem;
      if(!matches()||(m[0x0770]===1&&m[0x0e]===11))throw Error('Маршрут сбился. Попробуйте загрузить уровень снова.');
      const goal=packet.goalKind==='castle'?m[0x0770]===2:m[0x0770]===1&&(m[0x0e]===4||m[0x0e]===5);
      if(i<packet.goal&&goal)throw Error('Финиш наступил раньше последнего задания.');
      if(i===packet.goal&&!goal)throw Error('Не подтверждён финиш уровня.');
      if(performance.now()>deadline){await new Promise(resolve=>setTimeout(resolve,0));deadline=performance.now()+8;}
    }
    const m=probe.nes.cpu.mem;
    if(packet.goalKind==='castle' ? !(m[0x0770]===2&&m[0x0772]===4) : !(m[0x0770]===1&&m[0x0e]===5))throw Error('Не подтверждено завершение уровня.');
    return {engine,rom,buttons,start:0,startState:packet.startState,startImage,flag:packet.goal,end:packet.end};
  }

  async function bootManualLevel(runtime,level,version){
    if(!Number.isInteger(level)||level<0||level>31)throw Error('Выберите уровень от 1-1 до 8-4.');
    const world=Math.floor(level/4),number=level%4;
    for(let i=0;i<120;i++){runtime.step(0);if(runtime.nes.cpu.mem[0x0770]===0&&runtime.nes.cpu.mem[0x0772]===3)break;}
    const m=runtime.nes.cpu.mem;
    if(m[0x0770]!==0||m[0x0772]!==3)throw Error('Не удалось открыть оригинальное меню NES.');
    const area=[0,1,3,4].includes(world)&&number>=2?number+1:number;
    m[0x075f]=m[0x0766]=world;m[0x075c]=m[0x0763]=number;m[0x0760]=m[0x0767]=area;
    runtime.step(16);
    let deadline=performance.now()+8;
    for(let i=0;i<1000;i++){
      if(version!==loadVersion||!manualActive)return false;
      runtime.step(0);
      if(m[0x0770]===1&&m[0x0772]===3&&m[0x0e]===8&&m[0x075f]===world&&m[0x075c]===number){runtime.release();return true;}
      if(performance.now()>deadline){await new Promise(resolve=>setTimeout(resolve,0));deadline=performance.now()+8;}
    }
    throw Error('Не удалось запустить уровень '+levelTitle(level)+'.');
  }

  function paint(buffer) {
    for (let i=0;i<pixels.length;i++) pixels[i]=0xff000000|buffer[i];
    context.putImageData(image,0,0);
  }

  function stopPlayback() {
    if(frameRequest)cancelAnimationFrame(frameRequest);
    frameRequest=0;
    lastFrame=null;
    stopEffectsPlayback();
  }

  function updateCaption() {
    progressLabel.textContent=currentTotal>0 && currentCompleted===currentTotal && frame===verified?.end
      ? 'Финиш!' : frame>=target ? 'Ждёт задания' : 'Марио бежит';
  }

  function schedulePlayback() {
    if (!secretRun && !manualActive && !frameRequest && chosen && marioTheme && session && frame<target && !document.hidden) {
      frameRequest=requestAnimationFrame(advance);
    }
  }

  function advance(now) {
    frameRequest=0;
    if (secretRun || manualActive || !chosen || !marioTheme || !session || document.hidden) return;
    if (phase==='settings' || phase==='show') {
      lastFrame=null;
      stopEffectsPlayback();
      schedulePlayback();
      return;
    }
    const count=lastFrame===null?1:Math.min(3,Math.floor((now-lastFrame)/replayFrameMs));
    if (count>0) {
      lastFrame=lastFrame===null?now:Math.max(now-2*replayFrameMs,lastFrame+count*replayFrameMs);
      sampleCount=0;
      for (let i=0;i<count && frame<target;i++) session.step(verified.buttons[++frame]);
      playEffectSamples();
    }
    updateCaption();
    schedulePlayback();
  }

  function resetSession() {
    cancelSecret(false);
    stopPlayback();
    session=makeSession(verified.engine,verified.rom,paint,recordSample);
    session.restore(verified.startState,verified.buttons[verified.start]);
    isolateEffects(session.nes);
    paint(verified.startImage);
    frame=target=verified.start;
    updateCaption();
  }

  function updateVisibility() {
    $('nes-controls').hidden=!marioTheme;
    screen.hidden=!(marioTheme && chosen && verified);
    stage.setAttribute('data-nes',String(!screen.hidden));
    if (screen.hidden) {cancelSecret(false);stopPlayback();}
    else schedulePlayback();
  }

  function setSetupOpen(open) {
    setup.hidden=!open;
    toggle.setAttribute('aria-expanded',String(open));
  }

  function applyProgress() {
    if (!verified) return;
    if (currentCompleted===0) {
      if (frame!==verified.start || target!==verified.start || frameRequest) resetSession();
      return;
    }
    if (currentTotal<=0) return;
    target=currentCompleted>=currentTotal ? verified.end
      : verified.start+Math.floor((verified.flag-1-verified.start)*currentCompleted/currentTotal);
    updateCaption();
    schedulePlayback();
  }

  toggle.onclick=()=>{
    ensureAudio();
    if (chosen) {
      chosen=false;
      toggle.textContent='📺 Настоящий уровень';
      setSetupOpen(false);
      updateVisibility();
      return;
    }
    if (verified) {
      chosen=true;
      toggle.textContent='← К рисунку';
      updateVisibility();
      return;
    }
    if (!setup.hidden || (!rom && location.protocol==='file:')) {
      setSetupOpen(setup.hidden);
      return;
    }
    return loadHomeRom();
  };

  levelSelect.onchange=()=>{
    const reopen=chosen;
    chosen=false;
    verified=null;
    toggle.textContent='📺 Настоящий уровень';
    updateVisibility();
    if (reopen) return loadHomeRom();
  };

  async function readHomeRom() {
    const abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),5000);
    try {
      const response=await fetch(assets+'smb-world.nes',{signal:abort.signal,redirect:'error'});
      if (!response.ok) throw Error();
      const buffer=await response.arrayBuffer();
      if (buffer.byteLength!==40976) throw Error();
      return buffer;
    } catch {
      throw Error('Файл на домашнем сервере недоступен. Выберите файл на этом устройстве.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadHomeRom() {
    toggle.disabled=true;
    toggle.textContent='Готовим уровень…';
    try {
      await loadRom(readHomeRom,true);
    } finally {
      toggle.disabled=false;
      if (!chosen) {
        toggle.textContent='📺 Настоящий уровень';
        setSetupOpen(true);
      }
    }
  }

  async function loadRom(readRom,reuseRom=false) {
    const version=++loadVersion;
    const level=Number(levelSelect.value);
    levelSelect.disabled=true;
    status.textContent='Проверяем маршрут до конца уровня…';
    try {
      const gameRom=(reuseRom && rom) || new Uint8Array(await readRom());
      validateRomHeader(gameRom);
      const engine=await loadReplayEngine();
      const cached=gameRom===rom && verifiedLevels.get(level);
      const result=cached || await verifyRoute(engine,gameRom,level,version);
      if (!result||version!==loadVersion) return;
      chosen=true;
      if (gameRom!==rom) {verifiedLevels.clear();secretCache.clear();}
      rom=gameRom;
      verified=result;
      verifiedLevels.delete(level);verifiedLevels.set(level,result);
      if(verifiedLevels.size>4)verifiedLevels.delete(verifiedLevels.keys().next().value);
      $('nes-level-label').textContent=`Мир ${levelTitle(level)}`;
      canvas.setAttribute('aria-label',`Super Mario Bros., мир ${levelTitle(level)}`);
      resetSession();
      applyProgress();
      status.textContent='';
      toggle.textContent='← К рисунку';
      setSetupOpen(false);
      updateVisibility();
    } catch (error) {
      if (version===loadVersion) status.textContent=error.message||'Не удалось запустить уровень.';
    } finally {
      if (version===loadVersion) levelSelect.disabled=false;
    }
  }

  romInput.onchange=()=>{
    const file=romInput.files?.[0];
    romInput.value='';
    if (!file) return;
    return loadRom(()=>{
      if (file.size>131072) throw Error('Выберите файл Super Mario Bros. для NES.');
      return file.arrayBuffer();
    });
  };

  document.addEventListener('visibilitychange',()=>{
    if(secretRun)secretRun.last=null;
    if(document.hidden)stopPlayback();
    else schedulePlayback();
  });

  window.bunnyReplay={
    setEffectsVolume,
    async manual(level,render) {
      cancelSecret(false);secretDialog.close();
      manualActive=true;stopPlayback();
      const version=++loadVersion;
      const gameRom=rom||new Uint8Array(await readHomeRom());
      validateRomHeader(gameRom);
      const engine=await loadReplayEngine();
      if (version!==loadVersion || !manualActive) return null;
      rom=gameRom;
      // Manual play boots the original ROM and keeps every APU channel. Only
      // the learning-round replay uses prepared levels and music isolation.
      const runtime=makeSession(engine,gameRom,render,recordSample,true);
      if(level!==null&&!await bootManualLevel(runtime,level,version))return null;
      return {
        step(buttons) {sampleCount=0;runtime.step(buttons);playEffectSamples();},
        isPaused() {return Boolean(runtime.nes.cpu.mem[0x0776]&1);},
        releaseInput() {runtime.release();},
        snapshot() {runtime.release();return runtime.nes.toJSON();},
        restore(state) {runtime.restore(state,0);runtime.release();},
        silence:stopEffectsPlayback,
      };
    },
    stopManual() {manualActive=false;loadVersion++;stopEffectsPlayback();updateVisibility();},
    setTheme(value) {
      marioTheme=value;
      updateVisibility();
    },
    setProgress(completed,total) {
      if(completed===0){secretAttempted=false;cancelSecret();}
      else if(completed>=total)cancelSecret();
      currentCompleted=completed;
      currentTotal=total;
      applyProgress();
      refreshSecrets();maybeShowSecret();
    },
    playerChanged(){cancelSecret(false);secretDialog.close();secretAttempted=false;refreshSecrets();},
  };
})();
