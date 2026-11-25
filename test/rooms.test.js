'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRoomManager } = require('../src/rooms');

function makeManager(overrides = {}) {
  let nextId = 0;
  let nextCode = 0;
  const codes = ['ABC123', 'DEF456', 'GHI789', 'JKL012'];
  return createRoomManager({
    codeGenerator: () => codes[nextCode++] || `ROOM${nextCode}`,
    idGenerator: () => `id-${(nextId += 1)}`,
    rng: () => 0.99,
    ...overrides,
  });
}

function fillRoom(manager) {
  const { room, player: host } = manager.createRoom('Red', 's1');
  const { player: green } = manager.joinRoom(room.code, 'Green', 's2');
  const { player: yellow } = manager.joinRoom(room.code, 'Yellow', 's3');
  const { player: blue } = manager.joinRoom(room.code, 'Blue', 's4');
  return { room, host, green, yellow, blue };
}

test('creating a room seats the host as red with a six-character code', () => {
  const manager = makeManager();
  const { room, player } = manager.createRoom('Ayush', 's1');
  assert.equal(room.code, 'ABC123');
  assert.equal(player.color, 'red');
  assert.equal(room.hostId, player.id);
  assert.equal(room.players.length, 1);
  assert.equal(manager.publicRoom(room).players[0].name, 'Ayush');
});

test('four players take the four seats in colour order', () => {
  const manager = makeManager();
  const { room } = fillRoom(manager);
  assert.deepEqual(
    room.players.map((player) => player.color),
    ['red', 'green', 'yellow', 'blue'],
  );
  assert.equal(room.players.length, 4);
});

test('a fifth player and duplicate names are rejected', () => {
  const manager = makeManager();
  const { room } = fillRoom(manager);
  assert.throws(() => manager.joinRoom(room.code, 'Fifth', 's5'), /Room is full/);

  const other = manager.createRoom('Host', 's6');
  assert.throws(() => manager.joinRoom(other.room.code, 'Host', 's7'), /already taken/);
});

test('only the host can start, and all four seats must be connected', () => {
  const manager = makeManager();
  const { room, green } = fillRoom(manager);
  assert.throws(() => manager.startGame(room.code, green.id), /Only the host/);
  manager.disconnect(room.code, green.id);
  assert.throws(() => manager.startGame(room.code, room.hostId), /connected/);
  manager.resumeRoom(room.code, green.token, 's2b');
  const game = manager.startGame(room.code, room.hostId);
  assert.equal(game.status, 'playing');
  assert.equal(room.status, 'playing');
});

test('turns are enforced and a six keeps the turn', () => {
  const manager = makeManager();
  const { room, host, green } = fillRoom(manager);
  manager.startGame(room.code, host.id);
  assert.throws(() => manager.roll(room.code, green.id), /Wait for your turn/);
  const result = manager.roll(room.code, host.id);
  assert.equal(result.value, 6);
  manager.move(room.code, host.id, 0);
  assert.equal(room.game.tokens.red[0], 0);
  assert.equal(room.game.turn, 0);
  assert.throws(() => manager.roll(room.code, green.id), /Wait for your turn/);
});

test('a player can resume a seat with the private token', () => {
  const manager = makeManager();
  const { room, host } = fillRoom(manager);
  manager.disconnect(room.code, host.id);
  assert.equal(room.players[0].connected, false);
  manager.resumeRoom(room.code, host.token, 's1b');
  assert.equal(room.players[0].connected, true);
  assert.equal(room.players[0].socketId, 's1b');
  assert.throws(() => manager.resumeRoom(room.code, 'wrong', 's9'), /no longer available/);
});

test('leaving a lobby transfers the host and removes the seat', () => {
  const manager = makeManager();
  const { room, host, green } = fillRoom(manager);
  manager.leave(room.code, host.id);
  assert.equal(room.players.length, 3);
  assert.notEqual(room.hostId, host.id);
  assert.equal(room.hostId, green.id);
});

test('the host can reset a finished game to a rematch lobby', () => {
  const manager = makeManager();
  const { room, host } = fillRoom(manager);
  manager.startGame(room.code, host.id);
  room.game.status = 'finished';
  room.status = 'finished';
  assert.throws(() => manager.rematch(room.code, room.players[1].id), /Only the host/);
  manager.rematch(room.code, host.id);
  assert.equal(room.status, 'lobby');
  assert.equal(room.game, null);
  assert.equal(room.players.length, 4);
});

test('a refreshing host keeps the host role after resuming', () => {
  const manager = makeManager();
  const { room, host } = fillRoom(manager);
  manager.startGame(room.code, host.id);
  manager.disconnect(room.code, host.id);
  assert.equal(room.hostId, host.id);
  manager.resumeRoom(room.code, host.token, 's1b');
  assert.equal(room.hostId, host.id);
  assert.equal(
    manager.publicRoom(room).players.find((player) => player.id === host.id).isHost,
    true,
  );
});

test('an explicit host leave during a game transfers the host', () => {
  const manager = makeManager();
  const { room, host, green } = fillRoom(manager);
  manager.startGame(room.code, host.id);
  manager.leave(room.code, host.id);
  assert.equal(room.hostId, green.id);
  assert.equal(room.players.find((player) => player.id === host.id).connected, false);
});

test('abandoned rooms are cleaned up after the grace period', () => {
  let clock = 1_000;
  const manager = makeManager({ now: () => clock });
  const { room, player } = manager.createRoom('Host', 's1');
  manager.disconnect(room.code, player.id);
  clock += 11 * 60 * 1000;
  assert.equal(manager.cleanup(), 1);
  assert.equal(manager.count(), 0);
});
