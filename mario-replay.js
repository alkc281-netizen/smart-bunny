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
  async function loadRoutePacket(record){
    let response;
    if(typeof DecompressionStream==='function'){
      response=await fetch(assets+'routes/'+record.compressed);
      if(!response.ok)throw Error('Не удалось загрузить маршрут.');
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
    }
    response=await fetch(assets+'routes/'+record.file);
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
    if (!manualActive && !frameRequest && chosen && marioTheme && session && frame<target && !document.hidden) {
      frameRequest=requestAnimationFrame(advance);
    }
  }

  function advance(now) {
    frameRequest=0;
    if (manualActive || !chosen || !marioTheme || !session || document.hidden) return;
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
    if (screen.hidden) stopPlayback();
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
      if (gameRom!==rom) verifiedLevels.clear();
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
    if(document.hidden)stopPlayback();
    else schedulePlayback();
  });

  window.bunnyReplay={
    setEffectsVolume,
    async manual(level,render) {
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
      currentCompleted=completed;
      currentTotal=total;
      applyProgress();
    },
  };
})();
