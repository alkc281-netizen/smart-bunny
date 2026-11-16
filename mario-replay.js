'use strict';

(() => {
  const replayFrameMs = 1000 / 60.0988138974405;
  const assets = 'assets/emulation/';
  // Controller inputs for World 1-1, recorded against JSNES 2.1.0.
  // Each pair is [frame count, button mask] in RLDUTSBA order.
  const route = [
    [41,0], [1,16], [174,0], [128,65], [15,193], [17,65], [15,193], [41,65],
    [15,193], [17,65], [32,193], [72,65], [23,193], [65,65], [15,193], [105,65],
    [15,193], [33,65], [15,193], [65,65], [32,193], [40,0], [40,65], [40,193],
    [32,65], [8,193], [16,65], [15,193], [65,65], [15,193], [9,65], [15,193],
    [49,65], [15,193], [49,65], [32,193], [40,65], [15,193], [25,65], [15,193],
    [81,65], [15,193], [52,65],
  ];
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

  function makeSession(engine,rom,render) {
    const nes = new engine.NES({emulateSound:false,onFrame:render});
    nes.loadROM(rom);
    const directions = ['RIGHT','LEFT','DOWN','UP','START','SELECT','B','A']
      .map(name => engine.Controller['BUTTON_'+name]);
    let previous = 0;
    return {
      nes,
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

  function validateRomHeader(rom) {
    const expected = [0x4e,0x45,0x53,0x1a,2,1];
    if (rom.length < 40976 || expected.some((byte,i) => rom[i]!==byte)
        || (rom[6]&0xf4) || (rom[7]&0xf0)) {
      throw Error('Нужен оригинальный файл Super Mario Bros. (World/USA–Japan) в формате .nes.');
    }
  }

  async function verifyRoute(engine,rom,buttons,version) {
    const probe=makeSession(engine,rom,()=>{});
    let start=-1;
    let flag=-1;
    let deadline=performance.now()+8;
    for (let i=0;i<buttons.length;i++) {
      if (version!==loadVersion) return null;
      probe.step(buttons[i]);
      const ram=probe.nes.cpu.mem;
      // OperMode and OperMode_Task identify the active level after the title screen.
      // WorldNumber and LevelNumber confirm that it is World 1-1.
      const inLevel=ram[0x0770]===1 && ram[0x0772]===3 && ram[0x075f]===0 && ram[0x075c]===0;
      // GameEngineSubroutine: 8 plays the level, 4 slides the flag, 5 ends the level.
      const routine=ram[0x0e];
      if (start<0 && inLevel && ram[0x0774]===0 && routine===8) start=i;
      if (flag<0 && start>=0 && inLevel && routine===4 && ram[0x6d]>=8) flag=i;
      if (flag>=0 && inLevel && routine===5) {
        return {engine,rom,buttons,start,flag,end:i};
      }
      if (performance.now()>deadline) {
        await new Promise(resolve=>setTimeout(resolve,0));
        deadline=performance.now()+8;
      }
    }
    throw Error('Маршрут мира 1-1 на выбранном файле не дошёл до флага.');
  }

  function paint(buffer) {
    for (let i=0;i<pixels.length;i++) pixels[i]=0xff000000|buffer[i];
    context.putImageData(image,0,0);
  }

  function stopPlayback() {
    if(frameRequest)cancelAnimationFrame(frameRequest);
    frameRequest=0;
    lastFrame=null;
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
      schedulePlayback();
      return;
    }
    const count=lastFrame===null?1:Math.min(3,Math.floor((now-lastFrame)/replayFrameMs));
    if (count>0) {
      lastFrame=lastFrame===null?now:Math.max(now-2*replayFrameMs,lastFrame+count*replayFrameMs);
      for (let i=0;i<count && frame<target;i++) session.step(verified.buttons[++frame]);
    }
    updateCaption();
    schedulePlayback();
  }

  function resetSession() {
    stopPlayback();
    // Reproduce the title-screen inputs without drawing the boot frames.
    let renderFrame=false;
    session=makeSession(verified.engine,verified.rom,buffer=>{
      if(renderFrame)paint(buffer);
    });
    for (let i=0;i<verified.start;i++) session.step(verified.buttons[i]);
    renderFrame=true;
    session.step(verified.buttons[verified.start]);
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
    if (!setup.hidden || location.protocol==='file:') {
      setSetupOpen(setup.hidden);
      return;
    }
    return loadHomeRom();
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
    toggle.textContent='Загружаем уровень…';
    try {
      await loadRom(readHomeRom);
    } finally {
      toggle.disabled=false;
      if (!chosen) {
        toggle.textContent='📺 Настоящий уровень';
        setSetupOpen(true);
      }
    }
  }

  async function loadRom(readRom) {
    const version=++loadVersion;
    status.textContent='Проверяем маршрут от старта до флага…';
    try {
      const rom=new Uint8Array(await readRom());
      validateRomHeader(rom);
      const engine=await loadReplayEngine();
      const buttons=route.flatMap(([length,mask])=>Array(length).fill(mask));
      const result=await verifyRoute(engine,rom,buttons,version);
      if (!result||version!==loadVersion) return;
      chosen=true;
      verified=result;
      resetSession();
      applyProgress();
      status.textContent='';
      toggle.textContent='← К рисунку';
      setSetupOpen(false);
      updateVisibility();
    } catch (error) {
      if (version===loadVersion) status.textContent=error.message||'Не удалось запустить уровень.';
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
