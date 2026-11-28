'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const { COLORS, LudoError, cleanName, createGame, moveToken, publicGame, rollDice } = require('./ludo');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const MAX_PLAYERS = 4;

function defaultCode() {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function createRoomManager(options = {}) {
  const rng = options.rng || Math.random;
  const codeGenerator = options.codeGenerator || defaultCode;
  const idGenerator = options.idGenerator || randomUUID;
  const now = options.now || Date.now;
  const rooms = new Map();

  function nextCode() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = normalizeCode(codeGenerator());
      if (code.length === ROOM_CODE_LENGTH && !rooms.has(code)) return code;
    }
    throw new LudoError('Could not allocate a room code; try again');
  }

  function makePlayer(name, color, socketId) {
    return {
      id: idGenerator(),
      token: idGenerator(),
      name,
      color,
      connected: true,
      socketId,
      joinedAt: now(),
    };
  }

  function requireRoom(code) {
    const room = rooms.get(normalizeCode(code));
    if (!room) throw new LudoError('Room not found');
    return room;
  }

  function requirePlayer(room, playerId) {
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new LudoError('You are not seated in this room');
    return player;
  }

  function touch(room) {
    room.updatedAt = now();
  }

  function ensureHost(room) {
    if (room.players.length === 0) return;
    if (room.players.some((player) => player.id === room.hostId)) return;
    const nextHost = room.players.find((player) => player.connected) || room.players[0];
    room.hostId = nextHost.id;
  }

  function createRoom(name, socketId) {
    const playerName = cleanName(name);
    const code = nextCode();
    const player = makePlayer(playerName, COLORS[0], socketId);
    const room = {
      code,
      hostId: player.id,
      status: 'lobby',
      players: [player],
      game: null,
      createdAt: now(),
      updatedAt: now(),
    };
    rooms.set(code, room);
    return { room, player };
  }

  function joinRoom(code, name, socketId) {
    const room = requireRoom(code);
    if (room.status !== 'lobby') throw new LudoError('That game has already started');
    if (room.players.length >= MAX_PLAYERS) throw new LudoError('Room is full');
    const playerName = cleanName(name);
    if (room.players.some((player) => player.name.toLowerCase() === playerName.toLowerCase())) {
      throw new LudoError('That name is already taken in this room');
    }
    const color = COLORS.find(
      (candidate) => !room.players.some((player) => player.color === candidate),
    );
    if (!color) throw new LudoError('Room is full');
    const player = makePlayer(playerName, color, socketId);
    room.players.push(player);
    touch(room);
    return { room, player };
  }

  function resumeRoom(code, playerToken, socketId) {
    const room = requireRoom(code);
    if (typeof playerToken !== 'string' || !playerToken) {
      throw new LudoError('That seat is no longer available');
    }
    const player = room.players.find((candidate) => candidate.token === playerToken);
    if (!player) throw new LudoError('That seat is no longer available');
    player.connected = true;
    player.socketId = socketId;
    ensureHost(room);
    touch(room);
    return { room, player };
  }

  function startGame(code, playerId) {
    const room = requireRoom(code);
    if (room.hostId !== playerId) throw new LudoError('Only the host can start the game');
    if (room.status !== 'lobby') throw new LudoError('The game has already started');
    if (room.players.length !== MAX_PLAYERS) {
      throw new LudoError('All four seats must be filled before starting');
    }
    if (room.players.some((player) => !player.connected)) {
      throw new LudoError('All four players must be connected before starting');
    }
    room.game = createGame(room.players);
    room.status = 'playing';
    touch(room);
    return room.game;
  }

  function roll(code, playerId) {
    const room = requireRoom(code);
    if (room.status !== 'playing' || !room.game) throw new LudoError('The game is not active');
    const player = requirePlayer(room, playerId);
    if (room.game.players[room.game.turn].id !== player.id) {
      throw new LudoError('Wait for your turn');
    }
    const result = rollDice(room.game, rng);
    touch(room);
    return result;
  }

  function move(code, playerId, tokenIndex) {
    const room = requireRoom(code);
    if (room.status !== 'playing' || !room.game) throw new LudoError('The game is not active');
    const player = requirePlayer(room, playerId);
    if (room.game.players[room.game.turn].id !== player.id) {
      throw new LudoError('Wait for your turn');
    }
    const result = moveToken(room.game, tokenIndex);
    if (room.game.status === 'finished') room.status = 'finished';
    touch(room);
    return result;
  }

  function rematch(code, playerId) {
    const room = requireRoom(code);
    if (room.hostId !== playerId) throw new LudoError('Only the host can start a rematch');
    if (room.status !== 'finished') throw new LudoError('Finish the current game first');
    room.game = null;
    room.status = 'lobby';
    touch(room);
    return room;
  }

  function leave(code, playerId) {
    const room = rooms.get(normalizeCode(code));
    if (!room) return null;
    const index = room.players.findIndex((player) => player.id === playerId);
    if (index === -1) return room;
    if (room.status === 'lobby') {
      room.players.splice(index, 1);
      if (room.players.length === 0) {
        rooms.delete(room.code);
        return null;
      }
      ensureHost(room);
      touch(room);
      return room;
    }
    room.players[index].connected = false;
    if (room.hostId === playerId) {
      const nextHost =
        room.players.find((player) => player.connected) ||
        room.players.find((player) => player.id !== playerId);
      if (nextHost) room.hostId = nextHost.id;
    }
    ensureHost(room);
    touch(room);
    return room;
  }

  function disconnect(code, playerId) {
    const room = rooms.get(normalizeCode(code));
    if (!room) return null;
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) return room;
    player.connected = false;
    ensureHost(room);
    touch(room);
    return room;
  }

  function getRoom(code) {
    return rooms.get(normalizeCode(code)) || null;
  }

  function publicRoom(room) {
    if (!room) return null;
    return {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      maxPlayers: MAX_PLAYERS,
      createdAt: room.createdAt,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        connected: player.connected,
        isHost: player.id === room.hostId,
      })),
      game: room.game ? publicGame(room.game) : null,
    };
  }

  function cleanup(maxAgeMs = 6 * 60 * 60 * 1000, emptyGraceMs = 10 * 60 * 1000) {
    const current = now();
    let removed = 0;
    for (const [code, room] of rooms) {
      const connected = room.players.some((player) => player.connected);
      const stale = current - room.createdAt > maxAgeMs;
      const abandoned = !connected && current - room.updatedAt > emptyGraceMs;
      if (stale || abandoned) {
        rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }

  return {
    cleanup,
    count: () => rooms.size,
    createRoom,
    disconnect,
    getRoom,
    joinRoom,
    leave,
    move,
    publicRoom,
    rematch,
    resumeRoom,
    roll,
    startGame,
  };
}

module.exports = { CODE_ALPHABET, MAX_PLAYERS, ROOM_CODE_LENGTH, createRoomManager, normalizeCode };
