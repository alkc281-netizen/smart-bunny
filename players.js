'use strict';

const albumStickers = {
  start: ['🐰', 'Первый раунд', 'За первую завершённую тренировку.'],
  books: ['📚', 'Книжный герой', 'За тренировку в трёх разных темах или играх.'],
  detective: ['🔍', 'Сыщик ошибок', 'За верный ответ с первой попытки в работе над ошибками.'],
  rocket: ['🚀', 'Ракета прогресса', 'За новый личный рекорд в одной теме или игре.'],
  coin: ['🪙', 'Монетка', 'Первая монетка за тренировку.'],
  mushroom: ['🍄', 'Супергриб', '10 заданий по двум пройденным темам русского.'],
  star: ['⭐', 'Звезда', 'Три верных ответа в работе над ошибками. Исправления тоже считаются.'],
  koopa: ['🐢', 'Купа', '5 заданий на сравнение чисел и 5 на сложение.'],
  mario: ['🍄', 'Марио', '5 заданий по математике и 5 по русскому.'],
  chip: ['🐿️', 'Чип', 'Миссия «План Чипа»: 10 заданий по двум пройденным темам русского.'],
  dale: ['🐿️', 'Дейл', 'Миссия «Находки Дейла»: 5 сравнений чисел и 5 сложений.'],
  darkwing: ['🦆', 'Чёрный Плащ', 'Миссия «Ночной патруль»: 5 заданий по математике и 5 по русскому.'],
};
const marioStickerArt = {mario:'hero', mushroom:'mushroom', koopa:'koopa'};
const characterStickerFrames = {
  chip:{file:'rescue-rangers.gif',x:23,y:110,width:36,height:35},
  dale:{file:'rescue-rangers.gif',x:125,y:110,width:34,height:35},
  darkwing:{file:'darkwing-duck.gif',x:62,y:297,width:53,height:57},
};
const stickerMissionTypes = {mushroom:'russian', koopa:'math', mario:'mixed', chip:'russian', dale:'math', darkwing:'mixed'};
const stickerCollections = [
  {name:'Коллекция Марио',keys:['mushroom','star','koopa','mario']},
  {name:'Чип и Дейл',keys:['chip','dale']},
  {name:'Чёрный Плащ',keys:['darkwing']},
];
const dailyMissionButton = playerButton($('game-menu'), '🪙 Миссия дня', openDailyMission);
dailyMissionButton.hidden = true;
const playerAvatars = ['🌸', '⭐', '🐰', '🦊'];
let activePlayer = null;
let playerList = [];
let selectedSticker = null;
let playerApiReady = false;
let parentSession = false;
let authConfigured = false;
let writingPlayer = false;
let playerScreenVersion = 0;
let playerOutbox = [];
try {
  const saved = JSON.parse(localStorage.getItem('bunny-player-outbox') || '[]');
  if (Array.isArray(saved)) playerOutbox = saved;
} catch {}

async function apiRequest(path, data) {
  const response = await fetch('/api/' + path + '?rewards=characters', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
    ...(data ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)} : {}),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw Error('Вход доступен по домашнему адресу игры.');
  }
  const result = await response.json();
  if (!response.ok) {
    const error = Error(result.error || 'Не удалось сохранить прогресс.');
    error.status = response.status;
    throw error;
  }
  return result;
}

async function playerRequest(path, data) {
  const owner = activePlayer?.id;
  try { return await apiRequest('players' + path, data); }
  catch (error) {
    if (owner && activePlayer?.id === owner &&
        (error.status === 401 || (error.status === 403 && path === '/' + owner))) {
      parentSession = false;
      chooseActivePlayer(null);
      openPlayerPicker();
      message('Войди в свой профиль, чтобы сохранить результаты.');
    }
    throw error;
  }
}

function readPlayerPreference(key, fallback) {
  try {
    if (!activePlayer) return localStorage.getItem(key) ?? fallback;
    if (key.startsWith('bunny-russian-history-')) {
      return localStorage.getItem(activePlayer.id + ':' + key) ?? fallback;
    }
    return activePlayer.preferences[key] ?? fallback;
  } catch { return fallback; }
}

function savePlayerPreference(key, value) {
  if (!activePlayer || key.startsWith('bunny-russian-history-')) {
    try { localStorage.setItem(activePlayer ? activePlayer.id + ':' + key : key, value); } catch {}
    return;
  }
  activePlayer.preferences[key] = value;
  enqueuePlayerUpdate({kind: 'preference', key, value});
}

function storePlayerOutbox() {
  try { localStorage.setItem('bunny-player-outbox', JSON.stringify(playerOutbox)); } catch {}
}

function enqueuePlayerUpdate(data) {
  playerOutbox.push({player: activePlayer.id, data});
  storePlayerOutbox();
  flushPlayerUpdates();
}

async function flushPlayerUpdates() {
  if (writingPlayer) return;
  writingPlayer = true;
  try {
    while (activePlayer) {
      const index = playerOutbox.findIndex(item => item.player === activePlayer.id);
      if (index < 0) break;
      const {player, data} = playerOutbox[index];
      const result = await playerRequest('/' + player, data);
      playerOutbox.splice(index, 1);
      storePlayerOutbox();
      if (activePlayer?.id === player) {
        // Preserve any newer preference changes still waiting to be saved.
        result.preferences = activePlayer.preferences;
        const previous = Object.keys(activePlayer.stickers);
        activePlayer = result;
        if (phase === 'player-album' && data.kind !== 'preference') {
          renderPlayerAlbum();
          if (data.kind === 'redeem') message(Object.hasOwn(result.stickers,data.sticker)
            ? 'Наклейка в альбоме. Теперь её можно приклеить!' : 'Пока не хватает монет.');
        }
        if (phase === 'finished' && data.kind === 'round') {
          const unlocked = Object.keys(result.stickers).filter(key => !previous.includes(key));
          $('round-album').textContent = unlocked.length ? '✨ Новая наклейка! Открыть альбом' : '📒 Мой альбом';
        }
      }
    }
  } catch (error) {
    if (error.status === 401) return;
    if (phase === 'player-album' || phase === 'player-select') {
      message('Сервер недоступен. Изменения ожидают отправки.');
    } else if (phase === 'finished' && activePlayer) {
      $('round-album').textContent = '📒 Альбом · сохранение ожидается';
    }
  } finally {
    writingPlayer = false;
  }
}

function refreshPlayerNav() {
  setVisible('player-nav', playerApiReady && !game);
  $('choose-player').textContent = activePlayer ? activePlayer.avatar + ' ' + activePlayer.name : '👤 Выбрать игрока';
  setVisible('open-album', Boolean(activePlayer));
  dailyMissionButton.hidden = !activePlayer?.rewards;
  $('logout-player').hidden = !activePlayer;
  $('parent-settings').hidden = !activePlayer || !parentSession;
}

const playerBasePanels = panels;
panels = function () {
  playerBasePanels();
  setVisible('player-panel', false);
  playerScreenVersion++;
  refreshPlayerNav();
};

function playerScreen(title, hint, screen) {
  home();
  setVisible('game-menu', false);
  setVisible('player-panel', true);
  phase = screen;
  $('heading').textContent = title;
  $('hint').textContent = hint;
  message('');
  const panel = $('player-panel');
  panel.replaceChildren();
  return panel;
}

function playerElement(tag, text, parent) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  parent.append(element);
  return element;
}

function playerButton(parent, text, action) {
  const button = playerElement('button', text, parent);
  button.type = 'button';
  button.onclick = action;
  return button;
}

function chooseActivePlayer(player) {
  if (player) {
    for (const item of playerOutbox) {
      if (item.player === player.id && item.data.kind === 'preference') {
        player.preferences[item.data.key] = item.data.value;
      }
    }
  }
  activePlayer = player;
  $('app').classList.toggle('auth-required', !player);
  loadRussianProgress();
  home();
  flushPlayerUpdates();
}

function authField(form, title, type, autocomplete) {
  const label = playerElement('label', title, form);
  const input = playerElement('input', '', label);
  input.type = type;
  input.required = true;
  input.autocomplete = autocomplete;
  if (type === 'password') { input.minLength = 8; input.maxLength = 128; }
  return input;
}

function authLoginField(form) {
  const input = authField(form, 'Логин', 'text', 'username');
  input.minLength = 3;
  input.maxLength = 32;
  input.autocapitalize = 'none';
  input.spellcheck = false;
  return input;
}

function rememberField(form) {
  const label = playerElement('label', '', form);
  label.className = 'auth-remember';
  const input = playerElement('input', '', label);
  input.type = 'checkbox';
  label.append(document.createTextNode(' Запомнить вход на этом устройстве'));
  return input;
}

async function loadPlayerSession() {
  const status = await apiRequest('auth/status');
  authConfigured = status.configured;
  parentSession = status.parent;
  playerList = await playerRequest('');
  playerApiReady = true;
  chooseActivePlayer(status.player);
  if (!status.player) {
    if (authConfigured) openPlayerPicker();
    else openParentSetup();
  }
}

function openPlayerPicker() {
  if (!authConfigured) { openParentSetup(); return; }
  const panel = playerScreen('Вход в игру', 'Выбери аватар или введи свой логин', 'player-select');
  const version = playerScreenVersion;
  const choices = playerElement('div', '', panel);
  choices.className = 'player-choices';
  const form = playerElement('form', '', panel);
  form.className = 'auth-form';
  const login = authLoginField(form);
  const password = authField(form, 'Пароль', 'password', 'current-password');
  const remember = rememberField(form);
  for (const player of playerList.filter(item => item.ready)) {
    playerButton(choices, player.avatar + ' ' + player.name, () => {
      login.value = player.login;
      password.value = '';
      password.focus();
    });
  }
  const submit = playerElement('button', 'Войти', form);
  submit.type = 'submit';
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    if (writingPlayer) { message('Подожди завершения сохранения.'); return; }
    submit.disabled = true;
    try {
      await apiRequest('auth/login', {login: login.value, password: password.value, remember: remember.checked});
      password.value = '';
      if (version === playerScreenVersion) await loadPlayerSession();
    } catch (error) {
      if (version === playerScreenVersion) message(error.message);
    } finally { submit.disabled = false; }
  };
  if (activePlayer) playerButton(panel, 'Назад к игре', home);
  playerElement('p', 'Если забыл пароль, попроси родителя восстановить доступ.', panel).className = 'hint';
}

function accountForm(panel, setup) {
  const form = playerElement('form', '', panel);
  form.className = 'auth-form';
  let code;
  if (setup) {
    code = authField(form, 'Код первоначальной настройки', 'password', 'one-time-code');
    code.minLength = 1;
    playerElement('p', 'Код хранится на Lenovo. Его вводит родитель один раз.', form).className = 'hint';
  }
  const label = playerElement('label', setup ? 'Профиль родителя' : 'Профиль игрока', form);
  const select = playerElement('select', '', label);
  select.required = true;
  if (setup) {
    const placeholder = playerElement('option', 'Выбери профиль', select);
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
  }
  for (const player of playerList) {
    const option = playerElement('option', player.avatar + ' ' + player.name + (player.ready ? ' · ' + player.login : ' · настроить вход'), select);
    option.value = player.id;
  }
  playerElement('option', 'Создать новый профиль', select).value = 'new';
  if (!setup) select.value = 'new';
  const newProfile = playerElement('div', '', form);
  const name = authField(newProfile, 'Имя или прозвище', 'text', 'off');
  name.maxLength = 20;
  const avatarLabel = playerElement('label', 'Аватар', newProfile);
  const avatar = playerElement('select', '', avatarLabel);
  for (const symbol of playerAvatars) playerElement('option', symbol, avatar).value = symbol;
  const login = authLoginField(form);
  const password = authField(form, 'Новый пароль — от 8 символов', 'password', 'new-password');
  const confirm = authField(form, 'Повтори пароль', 'password', 'new-password');
  function selectionChanged() {
    const isNew = select.value === 'new';
    newProfile.hidden = !isNew;
    name.required = isNew;
    const selected = playerList.find(player => player.id === select.value);
    login.value = selected?.login || '';
    password.value = confirm.value = '';
  }
  select.onchange = selectionChanged;
  selectionChanged();
  const remember = setup ? rememberField(form) : null;
  const submit = playerElement('button', setup ? 'Настроить родительский доступ' : 'Сохранить логин и пароль', form);
  submit.type = 'submit';
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    if (password.value !== confirm.value) { message('Пароли не совпадают.'); return; }
    submit.disabled = true;
    try {
      const data = {login: login.value, password: password.value};
      if (select.value === 'new') Object.assign(data, {name: name.value, avatar: avatar.value});
      else data.player = select.value;
      if (setup) Object.assign(data, {code: code.value, remember: remember.checked});
      await apiRequest(setup ? 'auth/setup' : 'auth/accounts', data);
      password.value = confirm.value = '';
      if (code) code.value = '';
      await loadPlayerSession();
      if (!setup && parentSession) {
        openParentSettings();
        message('Доступ сохранён. Игрок может войти со своим паролем.');
      }
    } catch (error) { message(error.message); }
    finally { submit.disabled = false; }
  };
}

function openParentSetup() {
  const panel = playerScreen('Первый вход', 'Родителю нужно настроить личные логины и пароли', 'player-select');
  accountForm(panel, true);
}

function openParentSettings() {
  if (!parentSession || !activePlayer) { openPlayerPicker(); return; }
  const panel = playerScreen('Родительский кабинет', 'Назначь логин и пароль существующему профилю или создай новый', 'player-select');
  accountForm(panel, false);
  playerButton(panel, 'Назад к игре', home);
}

async function logoutPlayer() {
  const button = $('logout-player');
  if (writingPlayer) { message('Подожди завершения сохранения.'); return; }
  button.disabled = true;
  try {
    await apiRequest('auth/logout', {});
    parentSession = false;
    chooseActivePlayer(null);
    openPlayerPicker();
  } catch (error) { message(error.message); }
  finally { button.disabled = false; }
}

function openPlayerAlbum() {
  if (!activePlayer) { openPlayerPicker(); return; }
  selectedSticker = null;
  renderPlayerAlbum();
  startMusic();
  if (playerOutbox.length) flushPlayerUpdates();
  else refreshRewardProfile('player-album',renderPlayerAlbum);
}

function refreshRewardProfile(screen, render) {
  const player = activePlayer;
  const version = playerScreenVersion;
  if (!player || playerOutbox.length || writingPlayer) return;
  playerRequest('/' + player.id).then(profile => {
    if (phase === screen && playerScreenVersion === version && activePlayer === player && !writingPlayer && !playerOutbox.length) {
      activePlayer = profile;
      render();
    }
  }).catch(() => {});
}

function stickerArt(parent, key) {
  const icon = playerElement('span',albumStickers[key][0],parent);
  icon.className = 'sticker-art';
  icon.setAttribute('aria-hidden','true');
  if (key==='coin') {
    icon.textContent='';
    icon.classList.add('mario-coin');
  }
  const frame=characterStickerFrames[key];
  const source = marioStickerArt[key] ? 'assets/sprites/mario/drawn/' + marioStickerArt[key] + '.png'
    : frame ? 'assets/stickers/' + frame.file : null;
  if (source) {
    const image = document.createElement('img');
    image.alt = '';
    image.onload = () => {
      if (!frame) { icon.replaceChildren(image); return; }
      const canvas=document.createElement('canvas');
      canvas.width=frame.width;
      canvas.height=frame.height;
      const context=canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image,frame.x,frame.y,frame.width,frame.height,0,0,frame.width,frame.height);
      const pixels=context.getImageData(0,0,frame.width,frame.height);
      const background=Array.from(pixels.data.slice(0,3));
      // The original sprite sheets use a flat green background between sprites.
      for (let i=0;i<pixels.data.length;i+=4) {
        if (pixels.data[i]===background[0] && pixels.data[i+1]===background[1] && pixels.data[i+2]===background[2]) {
          pixels.data[i+3]=0;
        }
      }
      context.putImageData(pixels,0,0);
      icon.replaceChildren(canvas);
    };
    image.src = source;
  }
}

function rewardTopics() {
  const known = russianStudiedByClass[russianClass] || new Set(activePlayer.topics);
  return russianMixedTopics().filter(topic => known.has(topic));
}

function missionAvailable(key) {
  if (key === 'star') return russianMixedTopics(true).length > 0;
  if (stickerMissionTypes[key] === 'russian') return rewardTopics().length >= 2;
  if (stickerMissionTypes[key] === 'mixed') return rewardTopics().length > 0;
  return true;
}

function renderMarioCollection(parent) {
  const collection=playerElement('section','',parent);
  collection.className='mario-collection';
  playerElement('h2','Коллекции наклеек',collection);
  playerElement('p','🪙 Монеты: '+activePlayer.coins,collection);
  playerElement('p','За обычную тренировку — 1 монета. За миссию дня — 2 монеты.',collection);
  playerButton(collection,'Миссия дня',openDailyMission);
  for (const group of stickerCollections) {
    const keys=group.keys.filter(key=>Object.hasOwn(activePlayer.rewards.prices,key));
    if (!keys.length) continue;
    playerElement('h3',group.name,collection).className='sticker-collection-heading';
    const grid=playerElement('div','',collection);
    grid.className='mario-collection-grid';
    for (const key of keys) {
      const [,title,rule]=albumStickers[key];
      const card=playerElement('div','',grid);
      card.className='mario-sticker-card';
      stickerArt(card,key);
      playerElement('h4',title,card);
      if (Object.hasOwn(activePlayer.stickers,key)) {
        playerElement('p','В коллекции',card);
        continue;
      }
      playerElement('p',key==='star'?rule+' '+activePlayer.reviewWins+'/3':rule,card);
      if (missionAvailable(key)) {
        playerButton(card,key==='star'?'Работа над ошибками':'Начать миссию',()=>{
          if (key==='star') beginRussianMixed(true);
          else startRewardMission(key);
        });
      } else if (key!=='star') {
        playerElement('p','Сначала отметь пройденные темы или заверши обычные тренировки по русскому.',card);
        playerButton(card,'Подготовить темы русского',openRussianClasses);
      }
      const cost=activePlayer.rewards.prices[key];
      const buy=playerButton(card,'Обменять за 🪙 '+cost,()=>{
        for (const button of grid.querySelectorAll('[data-redeem]')) button.disabled=true;
        enqueuePlayerUpdate({kind:'redeem',sticker:key});
      });
      buy.dataset.redeem=key;
      buy.disabled=activePlayer.coins<cost || playerOutbox.some(item=>item.player===activePlayer.id && item.data.kind==='redeem');
    }
  }
}

function showDailyMission() {
  const panel=phase==='player-daily' ? $('player-panel')
    : playerScreen('🪙 Миссия дня','', 'player-daily');
  panel.replaceChildren();
  const {day,mission}=activePlayer.rewards;
  if (activePlayer.dailyDone===day) {
    playerElement('p','Миссия выполнена. Завтра появится новое задание.',panel);
    playerButton(panel,'Открыть альбом',openPlayerAlbum);
    return;
  }
  const key=missionAvailable(mission) ? mission : 'koopa';
  stickerArt(panel,key);
  playerElement('h2',albumStickers[key][1],panel);
  playerElement('p',albumStickers[key][2],panel);
  playerElement('p','Награда за миссию дня: 2 монеты.',panel);
  playerButton(panel,'Начать миссию',()=>startRewardMission(key,day)).className='wide';
}

function openDailyMission() {
  if (!activePlayer?.rewards) return;
  showDailyMission();
  refreshRewardProfile('player-daily',showDailyMission);
}

function renderPlayerAlbum() {
  const focused = document.activeElement;
  const restoreFocus = focused?.id === 'album-page' || focused?.dataset?.sticker;
  const panel = phase === 'player-album' ? $('player-panel')
    : playerScreen('📒 Мой альбом', activePlayer.avatar + ' ' + activePlayer.name, 'player-album');
  panel.replaceChildren();
  message('');
  const progress = playerElement('p', 'Раундов завершено: ' + activePlayer.rounds + ' · Верных ответов: ' + activePlayer.correct, panel);
  progress.className = 'album-progress';
  const placed = Object.entries(activePlayer.stickers).filter(([, point]) => point !== null);
  const labeled = placed.map(([key]) => albumStickers[key][1]);
  const page = playerButton(panel, placed.length ? '' : 'Здесь появятся наклейки', event => {
    if (!selectedSticker) { message('Сначала выбери наклейку под страницей.'); return; }
    const bounds = page.getBoundingClientRect();
    const percent = (value, start, size) => Math.min(100, Math.max(0, 100 * (value - start) / size));
    const x = event.detail ? percent(event.clientX, bounds.left, bounds.width) : 45;
    const y = event.detail ? percent(event.clientY, bounds.top, bounds.height) : 78;
    const sticker = selectedSticker;
    selectedSticker = null;
    activePlayer.stickers[sticker] = {x, y};
    renderPlayerAlbum();
    const complete = Object.keys(albumStickers).every(key => activePlayer.stickers[key]);
    message(complete ? 'Все наклейки собраны!' : 'Наклейка приклеена!');
    albumRewardSound(complete ? 'albumClear' : 'bonus');
    enqueuePlayerUpdate({kind: 'sticker', sticker, x, y});
    $('album-page').focus();
  });
  page.id = 'album-page';
  if (selectedSticker) page.classList.add('album-ready');
  page.setAttribute('aria-label', 'Страница альбома' + (labeled.length ? '. Наклейки: ' + labeled.join(', ') : ''));
  for (const [key, point] of placed) {
    const [, title] = albumStickers[key];
    const sticker = playerElement('span', '', page);
    sticker.className = 'album-sticker';
    sticker.dataset.kind = key;
    sticker.setAttribute('aria-hidden', 'true');
    sticker.style.setProperty('--x', point.x + '%');
    sticker.style.setProperty('--y', point.y + '%');
    stickerArt(sticker,key);
    playerElement('span', title, sticker);
  }
  const unplaced = Object.keys(activePlayer.stickers).filter(key => activePlayer.stickers[key] === null);
  if (unplaced.length) {
    const tray = playerElement('div', '', panel);
    tray.className = 'album-tray';
    for (const key of unplaced) {
      const [, title, reason] = albumStickers[key];
      const button = playerButton(tray, '', () => {
        selectedSticker = selectedSticker === key ? null : key;
        renderPlayerAlbum();
      });
      button.dataset.sticker = key;
      button.setAttribute('aria-pressed', String(selectedSticker === key));
      stickerArt(button,key);
      button.append(document.createTextNode(title));
      playerElement('span', reason, button);
    }
    message(selectedSticker ? 'Теперь коснись страницы в любом месте.' : 'Выбери новую наклейку.');
  } else if (!placed.length) {
    message('Заверши тренировку, чтобы получить первую наклейку.');
  }
  if (activePlayer.rewards) renderMarioCollection(panel);
  if (restoreFocus) {
    const target = focused.dataset?.sticker && panel.querySelector('[aria-pressed="true"]');
    (target || page).focus();
  }
}

function playerRoundId() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0'));
  const value = hex.join('');
  return [value.slice(0, 8), value.slice(8, 12), '4' + value.slice(13, 16),
    '8' + value.slice(17, 20), value.slice(20)].join('-');
}

let rewardRound;
names.mission='Миссия Марио';
gameMusic.mission=gameMusic.compare;

function rewardMath(count) {
  return Array.from({length:count},(_,i)=>{
    const topic=i%2 ? 'add' : 'compare';
    const explanation=topic==='add' ? 'Сложи оба числа.' : 'Широкая сторона знака обращена к большему числу.';
    return {...makeMathQuestion(topic),topic,label:names[topic],explanation};
  });
}

function rewardRussian(topics,count) {
  const order=Array.from({length:count},(_,i)=>topics[i%topics.length]);
  const items=new Map(topics.map(key=>[key,pickRussianDeck(key,russianTopics[key].items,order.filter(topic=>topic===key).length)]));
  return order.map(topic=>{
    const [question,correct,wrong,example]=items.get(topic).shift();
    const {name,rule}=russianTopics[topic];
    return {question,correct,choices:shuffledRussian([correct,wrong]),topic,label:name,
      explanation:[example,rule].filter(Boolean).join('\n\n')};
  });
}

function startRewardMission(key,daily=null) {
  const type=stickerMissionTypes[key];
  if (!type || !activePlayer?.rewards || !missionAvailable(key)) return;
  let deck;
  if (type==='math') deck=rewardMath(10);
  else {
    const topics=shuffledRussian(rewardTopics()).slice(0,2);
    if (type==='russian') deck=rewardRussian(topics,10);
    else {
      const math=rewardMath(5);
      deck=rewardRussian(topics,5).flatMap((item,i)=>[math[i],item]);
    }
  }
  rewardRound={key,daily,deck,corrected:0};
  begin('mission');
}

function renderRewardQuestion() {
  const item=rewardRound.deck[round];
  phase='answer';
  $('hint').textContent=item.label + (attempt===2 ? ' · Вторая попытка' : '');
  message(item.question);
  $('message').classList.toggle('russian-question',item.question.length>100||item.question.includes('\n'));
  setVisible('russian-detail',false);
  const answers=$('answers');
  answers.replaceChildren();
  for (const choice of item.choices) playerButton(answers,choice,()=>choose(choice));
  setVisible('answers',true);
  setAudioLevel();
}

function chooseRewardAnswer(value) {
  if (phase!=='answer') return;
  phase='feedback';
  setVisible('answers',false);
  const item=rewardRound.deck[round];
  if (value===item.correct) {
    if (attempt===1) score++;
    else rewardRound.corrected++;
    $('score').textContent='⭐ '+score;
    mood('happy');
    sound('coin');
    message(attempt===1?'Правильно!':'Ты исправил ошибку!');
    wait(1000,nextTask);
    return;
  }
  mood('sad');
  sound('wrong');
  message('Правильный ответ: '+item.correct);
  $('russian-detail').className='hint russian-rule';
  $('russian-detail').textContent=item.explanation;
  setVisible('russian-detail',true);
  const current=rewardRound, task=round;
  const answers=$('answers');
  answers.replaceChildren();
  playerButton(answers,'Продолжить',()=>{
    if (game!=='mission' || rewardRound!==current || round!==task || phase!=='feedback') return;
    phase='transition';
    if (attempt===2) nextTask();
    else {
      attempt=2;
      sound('retry');
      renderRewardQuestion();
    }
  }).className='wide';
  setVisible('answers',true);
}

window.bunnyMissions={
  count:()=>rewardRound.deck.length,
  task() {
    cancelTask();
    mood();
    attempt=1;
    stats();
    panels();
    $('heading').textContent=albumStickers[rewardRound.key][1];
    renderRewardQuestion();
  },
  answer:chooseRewardAnswer,
  finish() {
    cancelTask();
    phase='finished';
    mood('party');
    panels();
    setVisible('finished',true);
    $('progress-fill').style.width='100%';
    $('counter').textContent='Миссия завершена';
    $('heading').textContent='🏆 Миссия выполнена!';
    $('hint').textContent=albumStickers[rewardRound.key][1];
    message('Верно сразу: '+score+' · Исправлено: '+rewardRound.corrected);
    victorySound();
  },
};

const playerBaseReplay=$('replay').onclick;
$('replay').onclick=()=>game==='mission' ? startRewardMission(rewardRound.key) : playerBaseReplay();

const playerBaseFinish = finish;
finish = function () {
  if (phase === 'finished') return;
  playerBaseFinish();
  setVisible('round-album', Boolean(activePlayer));
  $('round-album').textContent = '📒 Мой альбом';
  if (!activePlayer) return;
  const total = roundQuestionCount();
  if (game === 'mission') {
    enqueuePlayerUpdate({kind:'round',id:playerRoundId(),score,total,review:false,
      topics:[...new Set(rewardRound.deck.map(item=>item.topic))],corrected:rewardRound.corrected,
      mission:rewardRound.key,daily:rewardRound.daily});
    return;
  }
  const topics = game === 'russian' ? Object.keys(russianRoundStats) : [game];
  enqueuePlayerUpdate({kind: 'round', id: playerRoundId(), score, total, topics,
    review: game === 'russian' && russianMode === 'mistakes',corrected:game==='russian' ? russianCorrected : 0});
};

// Keep an album or profile picker visible when returning from music settings.
const playerBaseOpenSettings = openSettings;
$('open-settings').onclick = () => {
  const playerPanelVisible = !$('player-panel').hidden;
  playerBaseOpenSettings();
  if (playerPanelVisible) settingsSnapshot.visible.push(['player-panel', true]);
};
$('choose-player').onclick = () => { openPlayerPicker(); sound('playerIntro'); };
$('open-album').onclick = openPlayerAlbum;
$('round-album').onclick = openPlayerAlbum;
window.addEventListener('online', flushPlayerUpdates);
$('logout-player').onclick = logoutPlayer;
$('parent-settings').onclick = openParentSettings;
loadPlayerSession().catch(() => {
  const panel = playerScreen('Вход в игру', 'Открой игру по домашнему адресу Lenovo', 'player-select');
  message('Не удалось связаться с сервером входа.');
  playerButton(panel, 'Повторить', () => location.reload());
});
