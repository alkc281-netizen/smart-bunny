'use strict';

(() => {
  const replayLimit = 4200;
  const replayFrameMs = 1000 / 60.0988138974405;
  const assets = 'assets/emulation/';
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

  function parseReplay(text) {
    if (!/^version 3\r?$/m.test(text) || !/^palFlag 0\r?$/m.test(text)) {
      throw Error('Не удалось прочитать запись маршрута.');
    }
    const frames = [];
    // Only the first part is needed for World 1-1.
    for (const line of text.slice(0,200000).split(/\r?\n/)) {
      if (!line.startsWith('|')) continue;
      const [, command, player] = line.split('|');
      if (!/^[RLDUTSBA. ]{8}$/.test(player) || (command !== '0' && frames.length > 0)) break;
      let buttons = 0;
      for (let i=0;i<8;i++) {
        if (player[i] !== '.' && player[i] !== ' ') buttons |= 1<<i;
      }
      frames.push(buttons);
      if (frames.length === replayLimit) break;
    }
    if (frames.length < 240) throw Error('Запись маршрута слишком короткая.');
    return frames;
  }

  function loadDependencies() {
    if (!dependencies) {
      const engine = window.jsnes ? Promise.resolve(window.jsnes) : loadEngine();
      const replay = fetch(assets+'smb-warpless.fm2').then(response => {
        if (!response.ok) throw Error('Запись маршрута доступна по домашнему адресу игры.');
        return response.text();
      }).then(parseReplay);
      dependencies = Promise.all([engine,replay]).catch(error => { dependencies=null; throw error; });
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
      // RAM symbols from the Super Mario Bros. disassembly: OperMode, WorldNumber,
      // LevelNumber, DisableScreenFlag, GameEngineSubroutine and Player_PageLoc.
      const ram=probe.nes.cpu.mem;
      const inLevel=ram[0x0770]===1 && ram[0x075f]===0 && ram[0x075c]===0;
      const routine=ram[0x0e];
      if (start<0 && inLevel && ram[0x0774]===0 && routine===8) start=i;
      if (start>=0 && inLevel && routine===4 && ram[0x6d]>=8) flag=i;
      if (flag>=0 && inLevel && routine===5) {
        return {engine,rom,buttons,start,end:i};
      }
      if (performance.now()>deadline) {
        await new Promise(resolve=>setTimeout(resolve,0));
        deadline=performance.now()+8;
      }
    }
    throw Error('Маршрут не дошёл до флага в эмуляторе. Проверьте версию файла игры.');
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

  toggle.onclick=()=>{
    if (chosen) {
      chosen=false;
      toggle.textContent='📺 Настоящий уровень';
      setup.hidden=true;
      toggle.setAttribute('aria-expanded','false');
      updateVisibility();
      return;
    }
    if (verified) {
      chosen=true;
      toggle.textContent='← К рисунку';
      updateVisibility();
      return;
    }
    setup.hidden=!setup.hidden;
    toggle.setAttribute('aria-expanded',String(!setup.hidden));
  };

  romInput.onchange=async()=>{
    const file=romInput.files?.[0];
    romInput.value='';
    if (!file) return;
    const version=++loadVersion;
    status.textContent='Проверяем маршрут от старта до флага…';
    try {
      if (file.size>131072) throw Error('Выберите файл Super Mario Bros. для NES.');
      const rom=new Uint8Array(await file.arrayBuffer());
      validateRomHeader(rom);
      const [engine,buttons]=await loadDependencies();
      const result=await verifyRoute(engine,rom,buttons,version);
      if (!result||version!==loadVersion) return;
      chosen=true;
      verified=result;
      currentCompleted=currentTotal=0;
      resetSession();
      toggle.textContent='← К рисунку';
      setup.hidden=true;
      toggle.setAttribute('aria-expanded','false');
      updateVisibility();
    } catch (error) {
      if (version===loadVersion) status.textContent=error.message||'Не удалось запустить уровень.';
    }
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
      if(!verified)return;
      if(completed===0){
        if(frame!==verified.start || target!==verified.start || frameRequest)resetSession();
        return;
      }
      if(total<=0)return;
      target=verified.start+Math.floor((verified.end-verified.start)*Math.min(1,completed/total));
      updateCaption();
      schedulePlayback();
    },
  };
})();
