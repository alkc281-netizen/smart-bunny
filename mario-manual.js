'use strict';

(() => {
  const adminButton=playerButton($('game-menu'),'🎮 Играть в Марио',open);
  const earnedButton=playerButton($('player-nav'),'🎮 Награда за задания',open);
  const roundButton=playerButton($('finished'),'🎮 Играть в Марио · 10 минут',open);
  adminButton.id='mario-admin-play';earnedButton.id='mario-earned-play';roundButton.id='round-mario';roundButton.className='wide';
  let access=null,accessVersion=0,screenOpen=false,owner=null,generation=0;
  let runtime=null,loadedLevel=0,level=0,lease=null,deadline=0,verifiedUntil=0;
  let playing=false,loading=false,frameRequest=0,lastFrame=null,heartbeatFlight=null,heartbeatVersion=-1;
  let canvas,status,pauseButton,startButton,restartButton,levelSelect,clock;
  const pointers=new Map(),keys=new Map(),memory=new Map();
  const frameMs=1000/60.0988138974405;

  function refreshButtons() {
    const same=Boolean(activePlayer&&access?.player===activePlayer.id);
    const allowed=same&&(access.admin||access.tickets>0||access.canResume);
    adminButton.hidden=!(same&&parentSession&&access.admin);
    earnedButton.hidden=!(allowed&&!parentSession);
    roundButton.hidden=!(allowed&&phase==='finished');
    roundButton.textContent=same&&access.admin?'🎮 Играть в Марио':same&&access.canResume?'🎮 Продолжить Марио':'🎮 Награда: Марио · 10 минут';
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
    const key=owner+':'+loadedLevel;
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
    pointers.clear();keys.clear();
    for(const button of document.querySelectorAll('.mario-touch-controls [data-mask]'))button.setAttribute('aria-pressed','false');
  }

  function pause(text='Пауза') {
    playing=false;clearInput();
    if(frameRequest)cancelAnimationFrame(frameRequest);
    frameRequest=0;lastFrame=null;runtime?.silence();stopMusic();
    if(pauseButton)pauseButton.textContent='▶ Продолжить';
    if(status&&screenOpen)status.textContent=text;
  }

  function leave() {
    if(!screenOpen)return;
    saveState();pause();screenOpen=false;generation++;runtime=null;lease=null;
    $('app').classList.remove('manual-playing');
    window.bunnyReplay?.stopManual();
  }

  function bindControls(container) {
    const update=()=>{
      const held=[...pointers.values(),...keys.values()].reduce((mask,value)=>mask|value,0);
      for(const button of container.querySelectorAll('[data-mask]'))button.setAttribute('aria-pressed',String(Boolean(held&Number(button.dataset.mask))));
    };
    container.onpointerdown=event=>{
      const button=event.target.closest('[data-mask]');
      if(!playing||!button||event.button!==0)return;
      event.preventDefault();pointers.set(event.pointerId,Number(button.dataset.mask));
      button.setPointerCapture(event.pointerId);update();
    };
    container.onpointermove=event=>{
      if(!pointers.has(event.pointerId))return;
      event.preventDefault();
      const button=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-mask]');
      pointers.set(event.pointerId,button&&container.contains(button)?Number(button.dataset.mask):0);update();
    };
    const release=event=>{if(pointers.delete(event.pointerId)){event.preventDefault();update();}};
    container.onpointerup=container.onpointercancel=container.onlostpointercapture=release;
    container.oncontextmenu=event=>event.preventDefault();
  }

  function tick(now) {
    frameRequest=0;
    if(!playing||!screenOpen||!runtime)return;
    if(document.hidden){pause('Пауза. Нажми «Продолжить», когда вернёшься.');saveState();return;}
    if(now>=deadline){expire();return;}
    if(now>=verifiedUntil){pause('Проверяем доступ. Нажми «Продолжить».');heartbeat();return;}
    const count=lastFrame===null?1:Math.min(3,Math.floor((now-lastFrame)/frameMs));
    if(count>0){
      lastFrame=lastFrame===null?now:Math.max(now-2*frameMs,lastFrame+count*frameMs);
      const mask=[...pointers.values(),...keys.values()].reduce((value,button)=>value|button,0);
      try {for(let i=0;i<count;i++)runtime.step(mask);}catch{pause('Не удалось продолжить. Попробуй «Заново».');return;}
    }
    frameRequest=requestAnimationFrame(tick);
  }

  function applyLease(result,sent) {
    lease=result.id;
    deadline=result.admin?Infinity:sent+result.remaining*1000;
    verifiedUntil=performance.now()+6500;
    access={...result,player:owner};refreshButtons();
    updateClock();
  }

  async function heartbeat() {
    if(!lease||!screenOpen)return null;
    if(heartbeatFlight&&heartbeatVersion===generation)return heartbeatFlight;
    const current=generation,player=owner,sent=performance.now(),id=lease;
    heartbeatVersion=current;
    heartbeatFlight=(async()=>{
      try {
        const result=await apiRequest('mario',{action:'heartbeat',id});
        if(current!==generation||player!==activePlayer?.id||!screenOpen)return false;
        applyLease(result,sent);return true;
      }catch(error){
        if(current===generation&&screenOpen){
          if(error.status===403)expire();else pause('Нет связи с сервером. Нажми «Продолжить» после восстановления связи.');
          if(error.status===401)loadPlayerSession().catch(()=>{});
        }
        return false;
      }finally{if(heartbeatVersion===current)heartbeatFlight=null;}
    })();
    return heartbeatFlight;
  }

  function updateClock() {
    if(!screenOpen||!clock)return;
    if(!lease){clock.textContent='';return;}
    if(deadline===Infinity){clock.textContent='Администратор · без ограничения';return;}
    const seconds=Math.max(0,Math.ceil((deadline-performance.now())/1000));
    clock.textContent='Осталось '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
    if(!seconds)expire();
  }

  function expire() {
    if(!screenOpen||!lease)return;
    saveState();pause('10 минут закончились. Заверши ещё один учебный раунд, чтобы продолжить.');
    lease=null;pauseButton.disabled=true;startButton.hidden=false;startButton.disabled=false;
    startButton.textContent='🎮 Следующий заработанный запуск';
    clock.textContent='Время закончилось';
    refreshAccess().then(result=>{
      if(!screenOpen||lease)return;
      const more=result&&(result.admin||result.tickets>0);
      startButton.textContent=more?'▶ Следующие заработанные 10 минут':'← К заданиям';
      startButton.onclick=more?()=>loadGame():home;
    });
  }

  function resume() {
    if(!screenOpen||!runtime||!lease||loading)return;
    ensureAudio();
    heartbeat().then(ok=>{
      if(!ok||!screenOpen||!runtime)return;
      playing=true;lastFrame=null;clearInput();pauseButton.textContent='⏸ Пауза';
      status.textContent='Играй!';
      if(autoMusic){selectedMusic=0;$('song').value='0';}
      startMusic();if(!frameRequest)frameRequest=requestAnimationFrame(tick);
    });
  }

  async function loadGame(fresh=false) {
    if(loading||!screenOpen)return;
    ensureAudio();pause('Готовим уровень…');
    loading=true;const current=++generation,player=owner,previousLease=lease;
    await saveState();
    if(current!==generation||!screenOpen||activePlayer?.id!==player)return;
    levelSelect.disabled=true;startButton.disabled=true;pauseButton.disabled=true;restartButton.disabled=true;
    try {
      const context=canvas.getContext('2d'),image=context.createImageData(256,240),pixels=new Uint32Array(image.data.buffer);
      const render=buffer=>{for(let i=0;i<pixels.length;i++)pixels[i]=0xff000000|buffer[i];context.putImageData(image,0,0);};
      const next=await window.bunnyReplay.manual(level,render);
      if(!next||current!==generation||activePlayer?.id!==player||!screenOpen)return;
      runtime=next;loadedLevel=level;
      if(!fresh){const saved=await checkpoint('get');if(current!==generation)return;
        if(saved?.version===1)try{runtime.restore(saved.state);}catch{}
      }
      const sent=performance.now();
      const result=await apiRequest('mario',previousLease?{action:'heartbeat',id:previousLease}:{action:'start'});
      if(current!==generation||activePlayer?.id!==player||!screenOpen)return;
      applyLease(result,sent);startButton.hidden=true;pauseButton.disabled=false;restartButton.disabled=false;
      playing=true;lastFrame=null;status.textContent='Играй!';pauseButton.textContent='⏸ Пауза';
      if(autoMusic){selectedMusic=0;$('song').value='0';}startMusic();
      frameRequest=requestAnimationFrame(tick);
      saveState();
    }catch(error){
      if(current===generation&&screenOpen){
        if(error.status===403&&lease)expire();
        else{pause(error.message||'Не удалось запустить Марио.');startButton.hidden=false;startButton.disabled=false;refreshAccess();}
        if(error.status===401)loadPlayerSession().catch(()=>{});
      }
    }finally{if(current===generation){loading=false;levelSelect.disabled=false;startButton.disabled=false;}}
  }

  async function open() {
    if(!activePlayer)return;
    ensureAudio();const player=activePlayer.id;
    const allowed=await refreshAccess();
    if(activePlayer?.id!==player)return;
    if(!allowed||!(allowed.admin||allowed.tickets||allowed.canResume)){message('Сначала полностью заверши учебный раунд.');return;}
    const panel=playerScreen('🎮 Марио','', 'player-mario');
    screenOpen=true;owner=player;generation++;loading=false;lease=null;runtime=null;playing=false;
    $('app').classList.add('manual-playing');
    const toolbar=playerElement('div','',panel);toolbar.className='manual-toolbar';
    const label=playerElement('label','Старт ',toolbar);levelSelect=playerElement('select','',label);
    for(let index=0;index<3;index++)playerElement('option','1-'+(index+1),levelSelect).value=index;
    try{const saved=Number(localStorage.getItem(player+':mario-level')||0);level=[0,1,2].includes(saved)?saved:0;}catch{level=0;}levelSelect.value=level;
    levelSelect.onchange=()=>{pause();level=Number(levelSelect.value);try{localStorage.setItem(owner+':mario-level',String(level));}catch{}if(runtime)loadGame();};
    pauseButton=playerButton(toolbar,'⏸ Пауза',()=>playing?(pause(),saveState()):resume());pauseButton.disabled=true;pauseButton.id='manual-pause';
    restartButton=playerButton(toolbar,'↻ Заново',()=>loadGame(true));restartButton.disabled=true;
    playerButton(toolbar,'🔊',()=>$('mute').click()).setAttribute('aria-label','Включить или выключить звук');
    playerButton(toolbar,'← К заданиям',home);
    clock=playerElement('p','',panel);clock.id='manual-clock';
    startButton=playerButton(panel,allowed.admin?'▶ Начать игру':allowed.canResume?'▶ Продолжить заработанную игру':'▶ Начать заработанные 10 минут',()=>loadGame());
    startButton.id='manual-start';
    status=playerElement('p',allowed.admin?'Свободная игра администратора.':
      (allowed.canResume?'Продолжи оставшееся время. ':'')+'Каждый полный раунд даёт 10 минут. Время идёт с запуска, включая паузу. Новых запусков: '+allowed.tickets+'.',panel);
    status.id='manual-status';status.setAttribute('role','status');
    const layout=playerElement('div','',panel);layout.className='manual-layout';
    const view=playerElement('div','',layout);view.className='manual-view';
    canvas=playerElement('canvas','',view);canvas.width=256;canvas.height=240;canvas.id='manual-picture';canvas.setAttribute('aria-label','Super Mario Bros.');
    const pad=playerElement('div','',layout);pad.className='manual-dpad mario-touch-controls';pad.setAttribute('role','group');pad.setAttribute('aria-label','Движение Марио');
    for(const [name,mask,direction]of[['↑',8,'up'],['←',2,'left'],['↓',4,'down'],['→',1,'right']]){
      const button=playerButton(pad,name,()=>{});button.dataset.mask=mask;button.dataset.direction=direction;button.setAttribute('aria-label',({up:'Вверх',left:'Влево',down:'Вниз',right:'Вправо'})[direction]);
    }
    const actions=playerElement('div','',layout);actions.className='manual-action-pad mario-touch-controls';actions.setAttribute('role','group');actions.setAttribute('aria-label','Прыжок и бег');
    for(const [name,mask]of[['B · Бег / огонь',64],['A · Прыжок',128]]){const button=playerButton(actions,name,()=>{});button.dataset.mask=mask;}
    bindControls(pad);bindControls(actions);refreshButtons();
  }

  document.addEventListener('keydown',event=>{
    if(!screenOpen||['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;
    if(event.code==='Escape'||event.code==='KeyP'){event.preventDefault();if(!event.repeat){if(playing){pause();saveState();}else resume();}return;}
    const mask={ArrowRight:1,ArrowLeft:2,ArrowDown:4,ArrowUp:8,KeyZ:64,KeyX:128,Space:128}[event.code];
    if(playing&&mask){event.preventDefault();keys.set(event.code,mask);}
  });
  document.addEventListener('keyup',event=>{if(keys.delete(event.code))event.preventDefault();});
  window.addEventListener('blur',()=>{if(screenOpen){pause('Пауза. Нажми «Продолжить».');saveState();}});
  window.addEventListener('offline',()=>{if(screenOpen){pause('Нет связи с сервером. Нажми «Продолжить» после восстановления связи.');saveState();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&screenOpen){pause('Пауза. Нажми «Продолжить».');saveState();}});
  window.addEventListener('pagehide',()=>{if(screenOpen){pause();saveState();}});
  setInterval(()=>{if(screenOpen&&lease)heartbeat();},4000);
  setInterval(updateClock,250);
  setInterval(()=>{if(screenOpen&&playing)saveState();},15000);
  window.bunnyMario={open,refreshAccess,refreshButtons,isPlaying:()=>playing,
    screenChanged(){if(screenOpen&&phase!=='player-mario')leave();},
    playerChanged(){leave();access=null;accessVersion++;refreshButtons();refreshAccess();},
  };
  refreshButtons();if(activePlayer)refreshAccess();
})();
