'use strict';

const albumStickers = {
  start: ['🐰', 'Первый раунд', 'За первую завершённую тренировку.'],
  books: ['📚', 'Книжный герой', 'За тренировку в трёх разных темах или играх.'],
  detective: ['🔍', 'Сыщик ошибок', 'За верный ответ с первой попытки в работе над ошибками.'],
  rocket: ['🚀', 'Ракета прогресса', 'За новый личный рекорд в одной теме или игре.'],
};
const playerAvatars = ['🌸', '⭐', '🐰', '🦊'];
let activePlayer = null;
let playerList = [];
let selectedSticker = null;
let playerApiReady = false;
let writingPlayer = false;
let playerScreenVersion = 0;
let playerOutbox = [];
try {
  const saved = JSON.parse(localStorage.getItem('bunny-player-outbox') || '[]');
  if (Array.isArray(saved)) playerOutbox = saved;
} catch {}

async function playerRequest(path, data) {
  const response = await fetch('/api/players' + path, {
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
    ...(data ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)} : {}),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw Error('Профили доступны по домашнему адресу игры.');
  }
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Не удалось сохранить прогресс.');
  return result;
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
    while (playerOutbox.length) {
      const {player, data} = playerOutbox[0];
      const result = await playerRequest('/' + player, data);
      playerOutbox.shift();
      storePlayerOutbox();
      if (activePlayer?.id === player) {
        // Preserve any newer preference changes still waiting to be saved.
        result.preferences = activePlayer.preferences;
        const previous = Object.keys(activePlayer.stickers);
        activePlayer = result;
        if (phase === 'player-album' && data.kind !== 'preference') renderPlayerAlbum();
        if (phase === 'finished') {
          const unlocked = Object.keys(result.stickers).filter(key => !previous.includes(key));
          $('round-album').textContent = unlocked.length ? '✨ Новая наклейка! Открыть альбом' : '📒 Мой альбом';
        }
      }
    }
  } catch {
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
  try { localStorage.setItem('bunny-active-player', player?.id || ''); } catch {}
  loadRussianProgress();
  home();
  flushPlayerUpdates();
}

function openPlayerPicker() {
  const panel = playerScreen('Кто играет?', 'Выбери свой профиль', 'player-select');
  const choices = playerElement('div', '', panel);
  choices.className = 'player-choices';
  const version = playerScreenVersion;
  function showChoices() {
    choices.replaceChildren();
    for (const player of playerList) {
      const button = playerButton(choices, player.avatar + ' ' + player.name, async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          const profile = await playerRequest('/' + player.id);
          if (version === playerScreenVersion) chooseActivePlayer(profile);
        } catch (error) {
          if (version === playerScreenVersion) message(error.message);
        } finally { button.disabled = false; }
      });
      button.setAttribute('aria-pressed', String(player.id === activePlayer?.id));
    }
    playerButton(choices, 'Играть гостем', () => chooseActivePlayer(null));
  }
  showChoices();
  playerRequest('').then(list => {
    playerList = list;
    if (version === playerScreenVersion) showChoices();
  }).catch(error => { if (version === playerScreenVersion) message(error.message); });

  const form = playerElement('form', '', panel);
  form.className = 'player-create';
  const nameLabel = playerElement('label', 'Имя или прозвище', form);
  const name = playerElement('input', '', nameLabel);
  name.maxLength = 20;
  name.required = true;
  const avatarLabel = playerElement('label', 'Аватар', form);
  const avatar = playerElement('select', '', avatarLabel);
  for (const symbol of playerAvatars) playerElement('option', symbol, avatar).value = symbol;
  const submit = playerElement('button', 'Создать игрока', form);
  submit.type = 'submit';
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const profile = await playerRequest('', {name: name.value, avatar: avatar.value});
      playerList.push({id: profile.id, name: profile.name, avatar: profile.avatar});
      if (version === playerScreenVersion) chooseActivePlayer(profile);
    } catch (error) {
      if (version === playerScreenVersion) message(error.message);
    } finally { submit.disabled = false; }
  };
}

function openPlayerAlbum() {
  if (!activePlayer) { openPlayerPicker(); return; }
  selectedSticker = null;
  renderPlayerAlbum();
  flushPlayerUpdates();
}

function renderPlayerAlbum() {
  const focused = document.activeElement;
  const restoreFocus = focused?.id === 'album-page' || focused?.dataset?.sticker;
  const panel = playerScreen('📒 Мой альбом', activePlayer.avatar + ' ' + activePlayer.name, 'player-album');
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
    message('Наклейка приклеена!');
    enqueuePlayerUpdate({kind: 'sticker', sticker, x, y});
    $('album-page').focus();
  });
  page.id = 'album-page';
  if (selectedSticker) page.classList.add('album-ready');
  page.setAttribute('aria-label', 'Страница альбома' + (labeled.length ? '. Наклейки: ' + labeled.join(', ') : ''));
  for (const [key, point] of placed) {
    const [icon, title] = albumStickers[key];
    const sticker = playerElement('span', '', page);
    sticker.className = 'album-sticker';
    sticker.dataset.kind = key;
    sticker.setAttribute('aria-hidden', 'true');
    sticker.style.setProperty('--x', point.x + '%');
    sticker.style.setProperty('--y', point.y + '%');
    playerElement('span', icon, sticker);
    playerElement('span', title, sticker);
  }
  const unplaced = Object.keys(activePlayer.stickers).filter(key => activePlayer.stickers[key] === null);
  if (unplaced.length) {
    const tray = playerElement('div', '', panel);
    tray.className = 'album-tray';
    for (const key of unplaced) {
      const [icon, title, reason] = albumStickers[key];
      const button = playerButton(tray, icon + ' ' + title, () => {
        selectedSticker = selectedSticker === key ? null : key;
        renderPlayerAlbum();
      });
      button.dataset.sticker = key;
      button.setAttribute('aria-pressed', String(selectedSticker === key));
      playerElement('span', reason, button);
    }
    message(selectedSticker ? 'Теперь коснись страницы в любом месте.' : 'Выбери новую наклейку.');
  } else if (!placed.length) {
    message('Заверши тренировку, чтобы получить первую наклейку.');
  }
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

const playerBaseFinish = finish;
finish = function () {
  if (phase === 'finished') return;
  playerBaseFinish();
  setVisible('round-album', Boolean(activePlayer));
  $('round-album').textContent = '📒 Мой альбом';
  if (!activePlayer) return;
  const total = game === 'russian' ? russianDeck.length : game === 'memory' ? 50 : 10;
  const topics = game === 'russian' ? Object.keys(russianRoundStats) : [game];
  enqueuePlayerUpdate({kind: 'round', id: playerRoundId(), score, total, topics,
    review: game === 'russian' && russianMode === 'mistakes'});
};

// Keep an album or profile picker visible when returning from music settings.
const playerBaseOpenSettings = openSettings;
$('open-settings').onclick = () => {
  const playerPanelVisible = !$('player-panel').hidden;
  playerBaseOpenSettings();
  if (playerPanelVisible) settingsSnapshot.visible.push(['player-panel', true]);
};
$('choose-player').onclick = openPlayerPicker;
$('open-album').onclick = openPlayerAlbum;
$('round-album').onclick = openPlayerAlbum;
window.addEventListener('online', flushPlayerUpdates);
playerRequest('').then(async list => {
  playerList = list;
  playerApiReady = true;
  let remembered;
  try { remembered = localStorage.getItem('bunny-active-player'); } catch {}
  if (!list.some(player => player.id === remembered)) { refreshPlayerNav(); return; }
  const version = playerScreenVersion;
  const profile = await playerRequest('/' + remembered);
  if (version === playerScreenVersion && phase === 'menu') chooseActivePlayer(profile);
  else refreshPlayerNav();
}).catch(() => { refreshPlayerNav(); });
