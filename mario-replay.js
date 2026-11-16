'use strict';

(() => {
  const replayFrameMs = 1000 / 60.0988138974405;
  const assets = 'assets/emulation/';
  // World 1 routes, recorded against JSNES 2.1.0. A prefix reuses a previous run.
  // Each pair is [frame count, button mask] in RLDUTSBA order.
  const levelRoutes = [
    {inputs:[
      [41,0], [1,16], [174,0], [128,65], [15,193], [17,65], [15,193], [41,65],
      [15,193], [17,65], [32,193], [72,65], [23,193], [65,65], [15,193], [105,65],
      [15,193], [33,65], [15,193], [65,65], [32,193], [40,0], [40,65], [40,193],
      [32,65], [8,193], [16,65], [15,193], [65,65], [15,193], [9,65], [15,193],
      [49,65], [15,193], [49,65], [32,193], [40,65], [15,193], [25,65], [15,193],
      [81,65], [15,193], [52,65],
    ]},
    {prefix:0, inputs:[
      [595,65], [542,0], [56,65], [15,193], [57,65], [15,193], [17,65], [15,193],
      [89,65], [15,193], [33,65], [8,193], [80,0], [40,2], [24,65], [15,193],
      [161,65], [15,193], [33,65], [15,193], [105,65], [32,193], [40,65], [15,193],
      [33,65], [15,193], [25,65], [15,193], [57,65], [40,193], [40,65], [40,193],
      [16,65], [15,193], [89,65], [40,193], [8,65], [32,193], [40,1], [32,2],
      [8,0], [213,65], [24,193], [16,65], [24,193], [56,65], [15,193], [60,65],
    ]},
    {area:3, inputs:[
      [41,0], [1,16], [174,0], [80,65], [15,193], [33,65], [15,193], [57,65],
      [15,193], [25,65], [32,193], [9,65], [49,193], [36,65], [12,193], [48,65],
      [15,193], [9,65], [15,193], [29,65], [4,193], [48,65], [39,193], [25,65],
      [8,193], [32,65], [15,193], [17,65], [8,193], [64,65], [8,193], [24,65],
      [24,193], [60,65], [12,193], [12,65], [27,193], [33,65], [24,0], [4,65],
      [20,193], [59,65],
    ]},
  ];
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

  function makeSession(engine,rom,render,onAudioSample) {
    const nes = new engine.NES({onFrame:render,onAudioSample,onStatusUpdate:()=>{},sampleRate:44100});
    nes.loadROM(rom);
    const directions = ['RIGHT','LEFT','DOWN','UP','START','SELECT','B','A']
      .map(name => engine.Controller['BUTTON_'+name]);
    let previous = 0;
    return {
      nes,
      restore(state,buttons) {
        nes.fromJSON(structuredClone(state));
        previous=buttons;
      },
      step(buttons) {
        for (let i=0;i<8;i++) {
          const mask=1<<i;
          if ((buttons&mask)===(previous&mask)) continue;
          nes[buttons&mask?'buttonDown':'buttonUp'](1,directions[i]);
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
    const route=levelRoutes[level];
    const runs=route.prefix===undefined ? route.inputs : levelRoutes[route.prefix].inputs.concat(route.inputs);
    const buttons=runs.flatMap(([length,mask])=>Array(length).fill(mask));
    let pixels;
    let startState;
    let startImage;
    const probe=makeSession(engine,rom,frame=>{pixels=frame;},()=>{});
    let start=-1;
    let flag=-1;
    let deadline=performance.now()+8;
    for (let i=0;i<buttons.length;i++) {
      if (version!==loadVersion) return null;
      const ram=probe.nes.cpu.mem;
      if (route.area!==undefined && start<0 && buttons[i]===16) {
        // Select the internal area just before START calls the game's area loader.
        ram[0x075c]=level;
        ram[0x0760]=route.area;
      }
      probe.step(buttons[i]);
      // OperMode and OperMode_Task identify the active level after the title screen.
      const inLevel=ram[0x0770]===1 && ram[0x0772]===3 && ram[0x075f]===0 && ram[0x075c]===level;
      // GameEngineSubroutine: 8 plays the level, 4 slides the flag, 5 ends the level.
      const routine=ram[0x0e];
      if (start<0 && inLevel && ram[0x0774]===0 && routine===8 && (level!==1 || ram[0x074e]===2)) {
        start=i;
        startState=structuredClone(probe.nes.toJSON());
        startImage=pixels.slice();
      }
      if (flag<0 && start>=0 && inLevel && routine===4) flag=i;
      if (flag>=0 && inLevel && routine===5) {
        return {engine,rom,buttons,start,startState,startImage,flag,end:i};
      }
      if (start>=0 && inLevel && routine===11) break;
      if (performance.now()>deadline) {
        await new Promise(resolve=>setTimeout(resolve,0));
        deadline=performance.now()+8;
      }
    }
    throw Error(`Маршрут мира 1-${level+1} на выбранном файле не дошёл до флага.`);
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
    if (!frameRequest && chosen && marioTheme && session && frame<target && !document.hidden) {
      frameRequest=requestAnimationFrame(advance);
    }
  }

  function advance(now) {
    frameRequest=0;
    if (!chosen || !marioTheme || !session || document.hidden) return;
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
    status.textContent='Проверяем маршрут от старта до флага…';
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
      verifiedLevels.set(level,result);
      $('nes-level-label').textContent=`Мир 1-${level+1}`;
      canvas.setAttribute('aria-label',`Super Mario Bros., мир 1-${level+1}`);
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
