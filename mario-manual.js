'use strict';

(() => {
  const adminButton=playerButton($('game-menu'),'🎮 Играть в Марио',open);
  const missionButton=playerButton($('game-menu'),'🎮 Заработать время Марио',()=>window.bunnyMarioMission.open());
  const bonusInfo=playerElement('p','',$('player-nav'));bonusInfo.className='hint';
  const earnedButton=playerButton($('player-nav'),'🎮 Награда за задания',open);
  const roundButton=playerButton($('finished'),'🎮 Играть в Марио · 10 минут',open);
  adminButton.id='mario-admin-play';earnedButton.id='mario-earned-play';roundButton.id='round-mario';roundButton.className='wide';
  let access=null,accessVersion=0,screenOpen=false,owner=null,generation=0;
  let quotaPaused=false,frozenRemaining=0,timerRevision=0,leaseOperations=Promise.resolve();
  let runtime=null,lease=null,deadline=0,verifiedUntil=0;
  let playing=false,loading=false,frameRequest=0,lastFrame=null,heartbeatFlight=null,heartbeatVersion=-1;
  let canvas,status,pauseButton,startButton,clock;
  let pendingPress=0,audioPrimed=false;
  const tapFrames=new Map(),touchPanels=new WeakSet();
  const nativeTouch='ontouchstart' in window;
  const pointers=new Map(),keys=new Map(),memory=new Map();
  const frameMs=1000/60.0988138974405;

  function refreshButtons() {
    const same=Boolean(activePlayer&&access?.player===activePlayer.id);
    const allowed=same&&(access.admin||access.tickets>0||access.canResume);
    adminButton.hidden=!(same&&parentSession&&access.admin);
    missionButton.hidden=!activePlayer;
    bonusInfo.hidden=!(same&&!access.admin);
    bonusInfo.textContent=same?'🎮 Запас: '+Math.floor((access.earnedSeconds||0)/60)+' мин. · добавочные: '+Math.floor((access.bonusSeconds||0)/60)+' мин.':'';
    earnedButton.hidden=!(allowed&&!parentSession);
    roundButton.hidden=!(allowed&&phase==='finished');
    roundButton.textContent=same&&access.admin?'🎮 Играть в Марио':same&&access.canResume?'🎮 Продолжить Марио':'🎮 Использовать заработанное время';
  }

  async function refreshAccess() {
    const player=activePlayer?.id,version=++accessVersion;
    if (!player) {access=null;refreshButtons();return null;}
    try {
      const result=await apiRequest('mario');
      if (activePlayer?.id!==player||version!==accessVersion) return null;
      access={...result,player};refreshButtons();return access;
    } catch {
      if(version===accessVersion){access=null;refreshButtons();}return null;
    }
  }

  function checkpoint(action,value) {
    // Keep the existing original-game save. Old level-specific saves are not deleted.
    const key=owner+':original';
    if(action==='put')memory.set(key,value);
    return new Promise(resolve=>{
      if(!window.indexedDB){resolve(memory.get(key));return;}
      const request=indexedDB.open('bunny-mario-saves',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('states');
      request.onerror=()=>resolve(memory.get(key));
      request.onsuccess=()=>{
        const db=request.result;
        try {
          const tx=db.transaction('states',action==='put'?'readwrite':'readonly');
          const operation=action==='put'?tx.objectStore('states').put(value,key):tx.objectStore('states').get(key);
          let result;
          operation.onsuccess=()=>{result=operation.result;};
          tx.oncomplete=()=>{db.close();resolve(action==='put'?value:result||memory.get(key));};
          tx.onerror=tx.onabort=()=>{db.close();resolve(memory.get(key));};
        }catch{db.close();resolve(memory.get(key));}
      };
    });
  }

  function saveState() {
    if(!runtime||!owner)return Promise.resolve();
    try{return checkpoint('put',{version:1,state:runtime.snapshot()});}catch{return Promise.resolve();}
  }

  function clearInput() {
    pointers.clear();keys.clear();pendingPress=0;tapFrames.clear();
    runtime?.releaseInput();
    for(const button of document.querySelectorAll('.mario-touch-controls [data-mask]'))button.setAttribute('aria-pressed','false');
  }

  function report(text) {
    if(status&&screenOpen&&status.textContent!==text)status.textContent=text;
  }

  function pause(text='Пауза') {
    syncQuotaTimer(true);
    playing=false;clearInput();
    if(frameRequest)cancelAnimationFrame(frameRequest);
    frameRequest=0;lastFrame=null;runtime?.silence();stopMusic();
    if(pauseButton){pauseButton.textContent='START';pauseButton.setAttribute('aria-label','Продолжить игру');pauseButton.setAttribute('aria-pressed','true');}
    report(text);
  }

  function leave() {
    if(!screenOpen)return;
    saveState();pause();screenOpen=false;generation++;runtime=null;lease=null;
    $('app').classList.remove('manual-playing');
    window.bunnyReplay?.stopManual();
  }

  // Called directly from gestures, before any network or IndexedDB awaits.
  // Safari may suspend/interrupt Web Audio independently of the emulator.
  function unlockAudio() {
    if(mute)return;
    try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
    const wasSleeping=!audioCtx||audioCtx.state!=='running';
    if(!ensureAudio())return;
    if(!audioPrimed||wasSleeping){
      try{
        const source=audioCtx.createBufferSource();source.buffer=audioCtx.createBuffer(1,1,22050);
        source.connect(audioCtx.destination);source.onended=()=>source.disconnect();source.start();audioPrimed=true;
      }catch{}
    }
    setAudioLevel();
  }

  function heldMask() {
    return [...pointers.values()].reduce((mask,touch)=>mask|touch.mask,0)|[...keys.values()].reduce((mask,key)=>mask|key,0);
  }

  function updateControls() {
    const held=heldMask();
    for(const button of document.querySelectorAll('.mario-touch-controls [data-mask]'))
      button.setAttribute('aria-pressed',String(Boolean(held&Number(button.dataset.mask))));
  }

  function press(mask) {
    // Two NES frames let even a quick tap reach the ROM's input polling.
    // Sustained input still comes exclusively from fingers/keys held down.
    if(!(heldMask()&mask))tapFrames.set(mask,2);
  }

  function releaseContact(id,cancelled=false) {
    const contact=pointers.get(id);if(!contact)return;
    pointers.delete(id);
    if(cancelled&&!(heldMask()&contact.mask))tapFrames.delete(contact.mask);
    updateControls();
  }

  function moveContact(contact,x,y) {
    if(!contact.pad.classList.contains('manual-dpad'))return;
    const button=document.elementFromPoint(x,y)?.closest('[data-mask]');
    if(button&&contact.pad.contains(button)){
      const mask=Number(button.dataset.mask);
      if(mask!==contact.mask)press(mask);
      contact.button=button;contact.mask=mask;
    }else{
      const r=contact.button.getBoundingClientRect(),slop=16;
      if(x<r.left-slop||x>r.right+slop||y<r.top-slop||y>r.bottom+slop)contact.mask=0;
    }
    updateControls();
  }

  function bindControls(container) {
    container.onpointerdown=event=>{
      if(nativeTouch&&event.pointerType==='touch')return;
      const button=event.target.closest('[data-mask]')||event.target.closest('.manual-action')?.querySelector('button');
      if(!playing||!button||event.button!==0)return;
      event.preventDefault();unlockAudio();
      const mask=Number(button.dataset.mask);press(mask);
      pointers.set('pointer:'+event.pointerId,{mask,button,pad:container});
      // Capture on the stable pad, and also listen for release at window level.
      try{container.setPointerCapture(event.pointerId);}catch{}
      updateControls();
    };
    container.onpointermove=event=>{
      const id='pointer:'+event.pointerId,contact=pointers.get(id);if(!contact)return;
      if(event.buttons===0){releaseContact(id,true);return;}
      event.preventDefault();moveContact(contact,event.clientX,event.clientY);
    };
    container.onlostpointercapture=event=>releaseContact('pointer:'+event.pointerId,true);
  }

  function reconcileTouches(event,cancelled=false) {
    const live=new Set([...event.touches].map(touch=>'touch:'+touch.identifier));
    for(const id of [...pointers.keys()])
      if(id.startsWith('touch:')&&!live.has(id))releaseContact(id,cancelled);
  }

  function bindTouchControls(panel) {
    if(touchPanels.has(panel))return;
    touchPanels.add(panel);
    // Non-passive touch handling prevents Safari selection/callouts and uses
    // the real active-finger list instead of relying on pointer capture alone.
    panel.addEventListener('touchstart',event=>{
      if(!screenOpen)return;
      event.preventDefault();reconcileTouches(event);unlockAudio();
      const selection=window.getSelection();if(selection?.rangeCount)selection.removeAllRanges();
      for(const touch of event.changedTouches){
        const button=touch.target.closest('button')||touch.target.closest('.manual-action')?.querySelector('button');
        if(!button||!panel.contains(button)||button.disabled)continue;
        const pad=button.closest('.mario-touch-controls');
        if(pad&&playing){
          const mask=Number(button.dataset.mask);press(mask);
          pointers.set('touch:'+touch.identifier,{mask,button,pad});
        }else if(!pad)button.click();
      }
      updateControls();
    },{passive:false});
    panel.addEventListener('touchmove',event=>{
      if(!screenOpen)return;
      event.preventDefault();reconcileTouches(event);
      for(const touch of event.changedTouches){
        const contact=pointers.get('touch:'+touch.identifier);
        if(contact)moveContact(contact,touch.clientX,touch.clientY);
      }
    },{passive:false});
  }

  function tick(now) {
    frameRequest=0;
    if(!playing||!screenOpen||!runtime)return;
    if(document.hidden){pause('Пауза. Нажми START, когда вернёшься.');saveState();return;}
    if(now>=deadline){expire();return;}
    if(now>=verifiedUntil){pause('Проверяем доступ. Нажми START.');heartbeat();return;}
    const count=lastFrame===null?1:Math.min(3,Math.floor((now-lastFrame)/frameMs));
    if(count>0){
      lastFrame=lastFrame===null?now:Math.max(now-2*frameMs,lastFrame+count*frameMs);
      try {for(let i=0;i<count;i++){
        // Deliver held controls and short taps at the original NES frame rate.
        let mask=heldMask()|pendingPress;pendingPress=0;
        for(const [button,frames]of tapFrames){
          mask|=button;
          if(frames<=1)tapFrames.delete(button);else tapFrames.set(button,frames-1);
        }
        runtime.step(mask);
      }}catch{pause('Не удалось продолжить. Вернись к заданиям и открой игру ещё раз.');return;}
      const nativePaused=runtime.isPaused();
      syncQuotaTimer(nativePaused);
      pauseButton.setAttribute('aria-pressed',String(nativePaused));
      report(nativePaused?'Пауза NES':'');
    }
    frameRequest=requestAnimationFrame(tick);
  }

  function applyLease(result,sent) {
    lease=result.id;
    quotaPaused=Boolean(result.paused);
    frozenRemaining=result.admin?Infinity:Math.max(0,result.remaining*1000);
    deadline=result.admin||quotaPaused?Infinity:sent+frozenRemaining;
    verifiedUntil=performance.now()+6500;
    access={...result,player:owner};refreshButtons();
    updateClock();
  }

  function sendLease(action,revision=timerRevision) {
    const current=generation,player=owner,id=lease;
    if(!id)return Promise.resolve(false);
    const request=leaseOperations.catch(()=>{}).then(async()=>{
      const sent=performance.now();
      try {
        const result=await apiRequest('mario',{action,id});
        if(current!==generation||player!==activePlayer?.id||!screenOpen)return false;
        // A heartbeat already in flight must not undo a more recent local pause/resume.
        if(revision===timerRevision)applyLease(result,sent);
        else verifiedUntil=performance.now()+6500;
        if(action==='heartbeat'&&!playing&&!quotaPaused)syncQuotaTimer(true);
        return true;
      }catch(error){
        if(current===generation&&screenOpen){
          if(error.status===403)expire();
          else {
            // Stop locally without enqueuing another failing pause from this handler.
            if(!quotaPaused){frozenRemaining=Math.max(0,deadline-performance.now());quotaPaused=true;deadline=Infinity;timerRevision++;}
            playing=false;clearInput();if(frameRequest)cancelAnimationFrame(frameRequest);frameRequest=0;lastFrame=null;runtime?.silence();
            report('Нет связи с сервером. Нажми START после восстановления связи.');updateClock();
          }
          if(error.status===401)loadPlayerSession().catch(()=>{});
        }
        return false;
      }
    });
    // Pause/resume and periodic heartbeats reach the server in their original order.
    leaseOperations=request.then(()=>{},()=>{});
    return request;
  }

  function syncQuotaTimer(paused) {
    if(!lease)return Promise.resolve(false);
    if(access?.admin){quotaPaused=paused;return Promise.resolve(true);}
    if(quotaPaused===paused)return Promise.resolve(true);
    const now=performance.now();
    if(paused){frozenRemaining=Math.max(0,deadline-now);deadline=Infinity;}
    else deadline=now+frozenRemaining;
    quotaPaused=paused;timerRevision++;updateClock();
    return sendLease(paused?'pause':'resume');
  }

  async function heartbeat() {
    if(!lease||!screenOpen)return null;
    if(heartbeatFlight&&heartbeatVersion===generation)return heartbeatFlight;
    const current=generation;heartbeatVersion=current;
    heartbeatFlight=sendLease('heartbeat');
    try{return await heartbeatFlight;}finally{if(heartbeatVersion===current)heartbeatFlight=null;}
  }

  function updateClock() {
    if(!screenOpen||!clock)return;
    if(!lease){clock.textContent='';return;}
    if(access?.admin){clock.textContent='Администратор · без ограничения';return;}
    const seconds=Math.max(0,Math.ceil((quotaPaused?frozenRemaining:deadline-performance.now())/1000));
    clock.textContent='Осталось '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+(quotaPaused?' · пауза':'');
    if(!seconds)expire();
  }

  function expire() {
    if(!screenOpen||!lease)return;
    timerRevision++;lease=null;
    saveState();pause('Время закончилось. Пройди смешанную миссию, чтобы продолжить.');
    lease=null;pauseButton.disabled=true;startButton.hidden=false;startButton.disabled=false;
    startButton.textContent='🎮 Следующий заработанный запуск';
    clock.textContent='Время закончилось';
    refreshAccess().then(result=>{
      if(!screenOpen||lease)return;
      const more=result&&(result.admin||result.tickets>0);
      startButton.textContent=more?'▶ Использовать заработанное время':'← К заданиям';
      startButton.onclick=more?()=>loadGame():home;
    });
  }

  async function resume() {
    if(!screenOpen||!runtime||!lease||loading)return false;
    unlockAudio();const current=generation,player=owner;
    const ok=await heartbeat();
    if(!ok||current!==generation||player!==owner||!screenOpen||!runtime)return false;
    const timerOk=await syncQuotaTimer(runtime.isPaused());
    if(!timerOk||current!==generation||!screenOpen)return false;
    playing=true;lastFrame=null;clearInput();report('');
    if(!frameRequest)frameRequest=requestAnimationFrame(tick);
    return true;
  }

  async function systemButton(mask) {
    if(!screenOpen||!runtime||!lease||loading)return;
    unlockAudio();
    if(!playing){
      const nativePaused=runtime.isPaused();
      if(!await resume())return;
      // Returning from a browser/background pause must not immediately pause a running ROM.
      if(mask===16&&!nativePaused)return;
    }
    pendingPress|=mask;
    if(mask===16)saveState();
  }

  async function loadGame() {
    if(loading||!screenOpen)return;
    unlockAudio();pause('Готовим уровень…');
    loading=true;const current=++generation,player=owner,previousLease=lease;
    await saveState();
    if(current!==generation||!screenOpen||activePlayer?.id!==player)return;
    startButton.disabled=true;pauseButton.disabled=true;
    try {
      const context=canvas.getContext('2d'),image=context.createImageData(256,240),pixels=new Uint32Array(image.data.buffer);
      const render=buffer=>{for(let i=0;i<pixels.length;i++)pixels[i]=0xff000000|buffer[i];context.putImageData(image,0,0);};
      const next=await window.bunnyReplay.manual(null,render);
      if(!next||current!==generation||activePlayer?.id!==player||!screenOpen)return;
      runtime=next;
      const saved=await checkpoint('get');if(current!==generation)return;
      if(saved?.version===1)try{runtime.restore(saved.state);}catch{}
      await leaseOperations;
      if(current!==generation||!screenOpen)return;
      const sent=performance.now();
      const result=await apiRequest('mario',previousLease?{action:'heartbeat',id:previousLease}:{action:'start'});
      if(current!==generation||activePlayer?.id!==player||!screenOpen)return;
      applyLease(result,sent);startButton.hidden=true;pauseButton.disabled=false;
      const timerOk=await syncQuotaTimer(runtime.isPaused());
      if(!timerOk||current!==generation||!screenOpen)return;
      playing=true;lastFrame=null;report('');
      pauseButton.textContent='START';pauseButton.setAttribute('aria-label','START — начать игру или пауза NES');pauseButton.setAttribute('aria-pressed','false');
      frameRequest=requestAnimationFrame(tick);
      saveState();
    }catch(error){
      if(current===generation&&screenOpen){
        if(error.status===403&&lease)expire();
        else{pause(error.message||'Не удалось запустить Марио.');startButton.hidden=false;startButton.disabled=false;refreshAccess();}
        if(error.status===401)loadPlayerSession().catch(()=>{});
      }
    }finally{if(current===generation){loading=false;startButton.disabled=false;}}
  }

  async function open() {
    if(!activePlayer)return;
    unlockAudio();const player=activePlayer.id;
    const allowed=await refreshAccess();
    if(activePlayer?.id!==player)return;
    if(!allowed||!(allowed.admin||allowed.tickets||allowed.canResume)){message('Сначала пройди смешанную миссию по трём предметам. Добавочные минуты сохраняются.');return;}
    const panel=playerScreen('🎮 Марио','', 'player-mario');
    screenOpen=true;owner=player;generation++;timerRevision++;quotaPaused=false;frozenRemaining=0;loading=false;lease=null;runtime=null;playing=false;
    $('app').classList.add('manual-playing');
    const layout=playerElement('div','',panel);layout.className='manual-layout';
    const left=playerElement('div','',layout);left.className='manual-side manual-left';
    clock=playerElement('p','',left);clock.id='manual-clock';
    status=playerElement('p','',left);status.id='manual-status';status.setAttribute('role','status');
    const view=playerElement('div','',layout);view.className='manual-view';
    canvas=playerElement('canvas','',view);canvas.width=256;canvas.height=240;canvas.id='manual-picture';canvas.setAttribute('aria-label','Super Mario Bros.');
    const right=playerElement('div','',layout);right.className='manual-side manual-right';
    const top=playerElement('div','',right);top.className='manual-top';
    pauseButton=playerButton(top,'START',()=>systemButton(16));pauseButton.disabled=true;pauseButton.id='manual-pause';
    pauseButton.setAttribute('aria-label','START — начать игру или пауза NES');pauseButton.setAttribute('aria-pressed','false');
    const select=playerButton(top,'SELECT',()=>systemButton(32));select.id='manual-select';select.setAttribute('aria-label','SELECT — выбор в оригинальном меню NES');
    playerButton(left,'← К заданиям',home).id='manual-home';
    startButton=playerButton(left,'Повторить загрузку',()=>loadGame());startButton.id='manual-start';startButton.hidden=true;
    const pad=playerElement('div','',left);pad.className='manual-dpad mario-touch-controls';pad.setAttribute('role','group');pad.setAttribute('aria-label','Движение Марио');
    for(const [name,mask,direction]of[['↑',8,'up'],['←',2,'left'],['↓',4,'down'],['→',1,'right']]){
      const button=playerButton(pad,name,()=>{});button.dataset.mask=mask;button.dataset.direction=direction;button.setAttribute('aria-label',({up:'Вверх',left:'Влево',down:'Вниз',right:'Вправо'})[direction]);
    }
    const actions=playerElement('div','',right);actions.className='manual-action-pad mario-touch-controls';actions.setAttribute('role','group');actions.setAttribute('aria-label','Прыжок и бег');
    for(const [name,mask,note]of[['B',64,'Бег / огонь'],['A',128,'Прыжок']]){
      const action=playerElement('div','',actions);action.className='manual-action manual-action-'+name.toLowerCase();
      const button=playerButton(action,name,()=>{});button.dataset.mask=mask;button.setAttribute('aria-label',name+' · '+note);
      playerElement('span',note,action).className='manual-control-note';
    }
    // Block text selection/callouts only inside the manual game, not in lessons.
    panel.oncontextmenu=panel.onselectstart=event=>{if(screenOpen)event.preventDefault();};
    bindControls(pad);bindControls(actions);bindTouchControls(panel);refreshButtons();
    loadGame();
  }

  document.addEventListener('keydown',event=>{
    if(!screenOpen||['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;
    if(['Escape','KeyP','Enter','ShiftLeft','ShiftRight'].includes(event.code)){
      event.preventDefault();if(!event.repeat)systemButton(event.code.startsWith('Shift')?32:16);return;
    }
    const mask={ArrowRight:1,ArrowLeft:2,ArrowDown:4,ArrowUp:8,KeyZ:64,KeyX:128,Space:128}[event.code];
    if(playing&&mask){event.preventDefault();unlockAudio();if(!keys.has(event.code))press(mask);keys.set(event.code,mask);}
  });
  document.addEventListener('keyup',event=>{if(keys.delete(event.code))event.preventDefault();});
  for(const type of ['pointerup','pointercancel'])window.addEventListener(type,event=>{
    releaseContact('pointer:'+event.pointerId,type==='pointercancel');
  },true);
  for(const type of ['touchend','touchcancel'])window.addEventListener(type,event=>{
    if(!screenOpen)return;
    reconcileTouches(event,type==='touchcancel');
    if(event.cancelable&&event.target.closest?.('#player-panel'))event.preventDefault();
  },{capture:true,passive:false});
  document.addEventListener('selectionchange',()=>{
    if(screenOpen){const selection=window.getSelection();if(selection?.rangeCount)selection.removeAllRanges();}
  });
  window.addEventListener('blur',()=>{if(screenOpen){pause('Пауза. Нажми START.');saveState();}});
  window.addEventListener('offline',()=>{if(screenOpen){pause('Нет связи с сервером. Нажми START после восстановления связи.');saveState();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&screenOpen){pause('Пауза. Нажми START.');saveState();}});
  window.addEventListener('pagehide',()=>{if(screenOpen){pause();saveState();}});
  setInterval(()=>{if(screenOpen&&lease)heartbeat();},4000);
  setInterval(updateClock,250);
  setInterval(()=>{if(screenOpen&&playing)saveState();},15000);
  window.bunnyMario={open,refreshAccess,refreshButtons,isPlaying:()=>playing,
    isPaused:()=>quotaPaused||Boolean(runtime?.isPaused()),
    screenChanged(){if(screenOpen&&phase!=='player-mario')leave();},
    playerChanged(){leave();access=null;accessVersion++;refreshButtons();refreshAccess();},
  };
  refreshButtons();if(activePlayer)refreshAccess();
})();
