'use strict';

const SESSION_KEY = 'ludo.session.v1';
const COLORS = ['red', 'green', 'yellow', 'blue'];
const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const state = {
  board: null,
  room: null,
  game: null,
  me: null,
  playerId: null,
  playerToken: null,
  resuming: false,
};

const elements = {
  connectionDot: document.getElementById('connection-dot'),
  connectionText: document.getElementById('connection-text'),
  create: document.getElementById('create'),
  dice: document.getElementById('dice'),
  diceFace: document.getElementById('dice-face'),
  diceHint: document.getElementById('dice-hint'),
  entryError: document.getElementById('entry-error'),
  game: document.getElementById('game'),
  gameCode: document.getElementById('game-code'),
  gameTitle: document.getElementById('game-title'),
  join: document.getElementById('join'),
  landing: document.getElementById('landing'),
  lobby: document.getElementById('lobby'),
  lobbyStatus: document.getElementById('lobby-status'),
  log: document.getElementById('log'),
  name: document.getElementById('name'),
  playersPanel: document.getElementById('players-panel'),
  rematch: document.getElementById('rematch'),
  rematchHint: document.getElementById('rematch-hint'),
  roomCode: document.getElementById('room-code'),
  seatGrid: document.getElementById('seat-grid'),
  start: document.getElementById('start'),
  toast: document.getElementById('toast'),
  turnDot: document.getElementById('turn-dot'),
  turnHint: document.getElementById('turn-hint'),
  turnName: document.getElementById('turn-name'),
  winner: document.getElementById('winner'),
  winnerText: document.getElementById('winner-text'),
  board: document.getElementById('board'),
  code: document.getElementById('code'),
};

const socket = io();
let toastTimer = null;

function setConnection(status, text) {
  elements.connectionDot.className = `connection-dot ${status}`;
  elements.connectionText.textContent = text;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), 2800);
}

function showEntryError(message) {
  elements.entryError.textContent = message || '';
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.code !== 'string' || typeof value.playerToken !== 'string') {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function saveSession() {
  if (!state.room || !state.playerToken) return;
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ code: state.room.code, playerToken: state.playerToken }),
  );
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function request(event, payload) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'Not connected to the server' });
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: 'The server did not respond' });
    }, 10000);
    socket.emit(event, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response || { ok: false, error: 'The server did not respond' });
    });
  });
}

function applyRoom(room) {
  state.room = room;
  state.game = room.game;
  state.me = room.players.find((player) => player.id === state.playerId) || null;
  render();
}

function applyResponse(response, { save = true } = {}) {
  if (!response || !response.ok) {
    showEntryError((response && response.error) || 'Something went wrong');
    return false;
  }
  if (response.playerId) state.playerId = response.playerId;
  if (response.playerToken) state.playerToken = response.playerToken;
  if (response.room) applyRoom(response.room);
  if (save) saveSession();
  showEntryError('');
  return true;
}

async function perform(event, payload) {
  const response = await request(event, payload);
  if (!response || !response.ok) {
    toast((response && response.error) || 'Action failed');
    return null;
  }
  if (response.room) applyRoom(response.room);
  return response;
}

function showView(name) {
  elements.landing.classList.toggle('hidden', name !== 'landing');
  elements.lobby.classList.toggle('hidden', name !== 'lobby');
  elements.game.classList.toggle('hidden', name !== 'game');
  document.body.dataset.view = name;
}

function resetToLanding() {
  state.room = null;
  state.game = null;
  state.me = null;
  state.playerId = null;
  state.playerToken = null;
  clearSession();
  showEntryError('');
  showView('landing');
}

function render() {
  if (!state.room) {
    showView('landing');
    return;
  }
  if (state.room.status === 'lobby') {
    showView('lobby');
    renderLobby();
    return;
  }
  showView('game');
  renderGame();
}

function renderLobby() {
  const room = state.room;
  elements.roomCode.textContent = room.code;
  elements.seatGrid.innerHTML = '';
  COLORS.forEach((color) => {
    const player = room.players.find((candidate) => candidate.color === color);
    const card = document.createElement('div');
    card.className = `seat-card${player ? '' : ' empty'}`;
    const dot = document.createElement('span');
    dot.className = 'seat-color';
    dot.style.setProperty('--seat-color', `var(--${color})`);
    const copy = document.createElement('div');
    copy.className = 'seat-copy';
    const name = document.createElement('div');
    name.className = 'seat-name';
    name.textContent = player ? player.name : 'Open seat';
    if (player && player.isHost) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Host';
      name.appendChild(badge);
    }
    const meta = document.createElement('div');
    meta.className = 'seat-meta';
    if (!player) meta.textContent = 'Waiting';
    else if (!player.connected) meta.textContent = 'Offline';
    else if (player.id === state.playerId) meta.textContent = 'You · ready';
    else meta.textContent = 'Ready';
    copy.append(name, meta);
    card.append(dot, copy);
    elements.seatGrid.appendChild(card);
  });

  const me = room.players.find((player) => player.id === state.playerId);
  const allConnected = room.players.length === 4 && room.players.every((player) => player.connected);
  const isHost = Boolean(me && me.isHost);
  elements.start.disabled = !isHost || !allConnected;
  elements.start.textContent = isHost
    ? room.players.length < 4
      ? `Start game (${room.players.length}/4)`
      : 'Start game'
    : 'Waiting for host';

  if (!isHost) {
    elements.lobbyStatus.textContent = 'Only the host can start the game.';
  } else if (room.players.length < 4) {
    const missing = 4 - room.players.length;
    elements.lobbyStatus.textContent = `Invite ${missing} more player${missing === 1 ? '' : 's'} with the code above.`;
  } else if (!allConnected) {
    elements.lobbyStatus.textContent = 'Waiting for everyone to reconnect.';
  } else {
    elements.lobbyStatus.textContent = 'Everyone is here. Start when ready.';
  }
}

function renderGame() {
  if (!state.game) return;
  elements.gameCode.textContent = state.room.code;
  const current = state.game.players.find((player) => player.color === state.game.turn);
  elements.gameTitle.textContent =
    state.game.status === 'finished'
      ? 'Game over'
      : `${current ? current.name : 'Player'} to roll`;
  renderPlayers();
  renderTokens();
  renderTurn();
  renderDice();
  renderLog();
  renderWinner();
}

function renderPlayers() {
  const game = state.game;
  elements.playersPanel.innerHTML = '';
  COLORS.forEach((color) => {
    const player = state.room.players.find((candidate) => candidate.color === color);
    const row = document.createElement('div');
    row.className = 'player-row';
    row.style.setProperty('--player-color', `var(--${color})`);
    if (game.status === 'playing' && game.turn === color) row.classList.add('active');

    const dot = document.createElement('span');
    dot.className = 'player-dot';

    const copy = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player ? player.name : 'Open seat';
    if (player && player.id === state.playerId) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'You';
      name.appendChild(badge);
    }
    const meta = document.createElement('div');
    meta.className = 'player-meta';
    if (!player) meta.textContent = 'Waiting';
    else {
      const labels = [player.isHost ? 'Host' : 'Player'];
      if (!player.connected) labels.push('offline');
      meta.textContent = labels.join(' · ');
    }
    copy.append(name, meta);

    const home = document.createElement('span');
    home.className = 'player-home';
    const tokens = game.tokens[color] || [];
    home.textContent = `${tokens.filter((progress) => progress === 57).length}/4`;
    home.title = 'Tokens home';

    row.append(dot, copy, home);
    elements.playersPanel.appendChild(row);
  });
}

function renderTurn() {
  const game = state.game;
  const current = game.players.find((player) => player.color === game.turn);
  const name = current ? current.name : '—';
  const mine = Boolean(state.me && state.me.color === game.turn);
  elements.turnName.textContent = name;
  elements.turnDot.style.setProperty('--player-color', `var(--${game.turn})`);

  if (game.status === 'finished') {
    elements.turnHint.textContent = 'The game is over.';
  } else if (game.awaitingMove) {
    elements.turnHint.textContent = mine
      ? 'Choose one of the glowing tokens.'
      : `Waiting for ${name} to move.`;
  } else if (mine) {
    elements.turnHint.textContent = 'Your turn — roll the dice.';
  } else {
    elements.turnHint.textContent = `Waiting for ${name}.`;
  }

  elements.dice.disabled =
    game.status !== 'playing' || !mine || game.awaitingMove || game.dice !== null;
}

function renderDice() {
  const game = state.game;
  elements.diceFace.innerHTML = '';
  if (game.dice === null) {
    const question = document.createElement('span');
    question.className = 'dice-question';
    question.textContent = '?';
    elements.diceFace.appendChild(question);
  } else {
    const visible = new Set(PIPS[game.dice] || []);
    for (let index = 0; index < 9; index += 1) {
      const pip = document.createElement('span');
      pip.className = `pip${visible.has(index) ? '' : ' hidden'}`;
      elements.diceFace.appendChild(pip);
    }
  }

  const current = game.players.find((player) => player.color === game.turn);
  const name = current ? current.name : 'the next player';
  const mine = Boolean(state.me && state.me.color === game.turn);
  if (game.status === 'finished') {
    elements.diceHint.textContent = 'Game over.';
  } else if (game.awaitingMove) {
    elements.diceHint.textContent = mine
      ? 'Tap a glowing token to move.'
      : `Waiting for ${name} to move.`;
  } else if (mine) {
    elements.diceHint.textContent = 'Your roll.';
  } else {
    elements.diceHint.textContent = `Waiting for ${name}.`;
  }
}

function renderLog() {
  elements.log.innerHTML = '';
  (state.game.log || []).forEach((entry) => {
    const item = document.createElement('li');
    item.className = entry.type || '';
    item.textContent = entry.message;
    elements.log.appendChild(item);
  });
  elements.log.scrollTop = elements.log.scrollHeight;
}

function renderWinner() {
  const game = state.game;
  if (game.status !== 'finished' || !game.winner) {
    elements.winner.classList.add('hidden');
    return;
  }
  const winner = game.players.find((player) => player.color === game.winner);
  elements.winnerText.textContent = `${winner ? winner.name : 'Player'} wins!`;
  elements.winner.classList.remove('hidden');
  const host = Boolean(state.me && state.me.isHost);
  elements.rematch.classList.toggle('hidden', !host);
  elements.rematchHint.classList.toggle('hidden', host);
}

function positionFor(color, progress, tokenIndex) {
  if (progress === -1) {
    const [row, col] = state.board.baseSlots[color][tokenIndex];
    return { row, col, base: true };
  }
  if (progress >= 52) {
    const index = Math.min(5, progress - 52);
    const [row, col] = state.board.homePaths[color][index];
    return { row, col, base: false };
  }
  const [row, col] = state.board.path[(state.board.startOffsets[color] + progress) % 52];
  return { row, col, base: false };
}

function renderTokens() {
  const layer = elements.board.querySelector('.token-layer');
  if (!layer || !state.game || !state.board) return;
  layer.innerHTML = '';
  const entries = [];
  COLORS.forEach((color) => {
    (state.game.tokens[color] || []).forEach((progress, tokenIndex) => {
      entries.push({ color, progress, tokenIndex, ...positionFor(color, progress, tokenIndex) });
    });
  });

  const groups = new Map();
  entries.forEach((entry) => {
    if (entry.base) return;
    const key = `${entry.row.toFixed(2)},${entry.col.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });

  entries.forEach((entry) => {
    const token = document.createElement('div');
    token.className = `token token-${entry.color}`;
    if (state.me && state.me.color === entry.color) token.classList.add('mine');
    const legal = (state.game.moves || []).some((move) => move.tokenIndex === entry.tokenIndex);
    if (
      state.me &&
      state.me.color === entry.color &&
      state.game.turn === entry.color &&
      state.game.status === 'playing' &&
      legal
    ) {
      token.classList.add('legal');
      token.addEventListener('click', () => {
        perform('game:move', { tokenIndex: entry.tokenIndex });
      });
    }

    let left;
    let top;
    if (entry.base) {
      left = (entry.col / 15) * 100;
      top = (entry.row / 15) * 100;
    } else {
      left = ((entry.col + 0.5) / 15) * 100;
      top = ((entry.row + 0.5) / 15) * 100;
      const key = `${entry.row.toFixed(2)},${entry.col.toFixed(2)}`;
      const group = groups.get(key) || [];
      if (group.length > 1) {
        const index = group.indexOf(entry);
        const spread = 1.15;
        const offset = (index - (group.length - 1) / 2) * spread;
        left += offset;
        top += offset;
      }
    }
    token.style.left = `${left}%`;
    token.style.top = `${top}%`;
    token.title = `${entry.color} token ${entry.tokenIndex + 1}`;
    token.textContent = String(entry.tokenIndex + 1);
    layer.appendChild(token);
  });
}

function buildBoard() {
  elements.board.innerHTML = '';
  const board = state.board;
  COLORS.forEach((color) => {
    const base = document.createElement('div');
    base.className = `base base-${color}`;
    const inner = document.createElement('div');
    inner.className = 'base-inner';
    for (let index = 0; index < 4; index += 1) {
      const slot = document.createElement('span');
      slot.className = 'base-slot';
      inner.appendChild(slot);
    }
    base.appendChild(inner);
    elements.board.appendChild(base);
  });

  board.path.forEach(([row, col], index) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (board.safeSquares.includes(index)) cell.classList.add('safe');
    cell.style.left = `${(col / 15) * 100}%`;
    cell.style.top = `${(row / 15) * 100}%`;
    elements.board.appendChild(cell);
  });

  COLORS.forEach((color) => {
    board.homePaths[color].forEach(([row, col]) => {
      const cell = document.createElement('div');
      cell.className = `home-cell home-${color}`;
      cell.style.left = `${(col / 15) * 100}%`;
      cell.style.top = `${(row / 15) * 100}%`;
      elements.board.appendChild(cell);
    });
  });

  const center = document.createElement('div');
  center.className = 'center';
  elements.board.appendChild(center);

  const layer = document.createElement('div');
  layer.className = 'token-layer';
  elements.board.appendChild(layer);
}

async function loadBoard() {
  try {
    const response = await fetch('/api/board');
    if (!response.ok) throw new Error('Board unavailable');
    state.board = await response.json();
    buildBoard();
    render();
  } catch {
    showEntryError('The game board could not be loaded. Refresh to retry.');
  }
}

async function createRoom() {
  const name = elements.name.value.trim();
  if (!name) {
    showEntryError('Enter your name first.');
    elements.name.focus();
    return;
  }
  elements.create.disabled = true;
  elements.join.disabled = true;
  const response = await request('room:create', { name });
  elements.create.disabled = false;
  elements.join.disabled = false;
  if (applyResponse(response)) toast('Room created. Share the code.');
}

async function joinRoom() {
  const name = elements.name.value.trim();
  const code = elements.code.value.trim().toUpperCase();
  if (!name) {
    showEntryError('Enter your name first.');
    elements.name.focus();
    return;
  }
  if (code.length !== 6) {
    showEntryError('Room codes are six characters.');
    elements.code.focus();
    return;
  }
  elements.create.disabled = true;
  elements.join.disabled = true;
  const response = await request('room:join', { code, name });
  elements.create.disabled = false;
  elements.join.disabled = false;
  if (applyResponse(response)) toast('Joined the room.');
}

async function leaveRoom() {
  await request('room:leave');
  resetToLanding();
  toast('You left the room.');
}

function copyCode() {
  const code = state.room && state.room.code;
  if (!code) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(
      () => toast('Room code copied.'),
      () => toast(`Room code: ${code}`),
    );
  } else {
    toast(`Room code: ${code}`);
  }
}

elements.create.addEventListener('click', createRoom);
elements.join.addEventListener('click', joinRoom);
elements.start.addEventListener('click', async () => {
  const response = await perform('room:start');
  if (response) toast('Game started. Red rolls first.');
});
elements.dice.addEventListener('click', () => {
  if (elements.dice.disabled) return;
  elements.dice.classList.add('rolling');
  setTimeout(() => elements.dice.classList.remove('rolling'), 500);
  perform('game:roll');
});
elements.rematch.addEventListener('click', () => perform('room:rematch'));
document.getElementById('leave-lobby').addEventListener('click', leaveRoom);
document.getElementById('leave-game').addEventListener('click', leaveRoom);
document.getElementById('copy-code').addEventListener('click', copyCode);
elements.name.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createRoom();
});
elements.code.addEventListener('input', () => {
  elements.code.value = elements.code.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
});
elements.code.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom();
});

socket.on('connect', async () => {
  setConnection('online', 'Online');
  const session = readSession();
  if (!session || state.resuming) return;
  state.resuming = true;
  const response = await request('room:resume', session);
  state.resuming = false;
  if (response.ok) {
    state.playerId = response.playerId;
    state.playerToken = response.playerToken;
    applyRoom(response.room);
    saveSession();
  } else {
    clearSession();
    if (state.room) {
      state.room = null;
      state.game = null;
      state.me = null;
      render();
      showEntryError('Your previous room is no longer available.');
    }
  }
});

socket.on('disconnect', () => setConnection('offline', 'Reconnecting…'));
socket.on('connect_error', () => setConnection('offline', 'Offline'));
socket.on('state', (room) => {
  if (!room) return;
  if (!state.room || state.room.code !== room.code) return;
  applyRoom(room);
});

setConnection('', 'Connecting');
loadBoard();
