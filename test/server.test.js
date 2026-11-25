'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { io: createClient } = require('socket.io-client');
const { createServer } = require('../server');

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const client = createClient(url, { transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('client connection timed out'));
    }, 5000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once('connect_error', (error) => {
      clearTimeout(timer);
      client.close();
      reject(error);
    });
  });
}

function emitAck(client, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 5000);
    client.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function waitForState(client, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('state', handler);
      reject(new Error('state broadcast timed out'));
    }, 5000);
    function handler(room) {
      if (!predicate(room)) return;
      clearTimeout(timer);
      client.off('state', handler);
      resolve(room);
    }
    client.on('state', handler);
  });
}

test('four socket clients create, join, start and play a synchronized game', async () => {
  const rolls = [0.99, 0.99, 0.0];
  let rollIndex = 0;
  let nextId = 0;
  const { close, server } = createServer({
    codeGenerator: () => 'ROOM01',
    idGenerator: () => `id-${(nextId += 1)}`,
    rng: () => rolls[Math.min(rollIndex++, rolls.length - 1)],
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  const clients = [];

  try {
    const host = await connectClient(url);
    clients.push(host);
    const created = await emitAck(host, 'room:create', { name: 'Red' });
    assert.equal(created.ok, true);
    assert.equal(created.room.code, 'ROOM01');
    assert.equal(created.room.players.length, 1);

    const green = await connectClient(url);
    const yellow = await connectClient(url);
    const blue = await connectClient(url);
    clients.push(green, yellow, blue);

    const joins = await Promise.all([
      emitAck(green, 'room:join', { code: 'ROOM01', name: 'Green' }),
      emitAck(yellow, 'room:join', { code: 'ROOM01', name: 'Yellow' }),
      emitAck(blue, 'room:join', { code: 'ROOM01', name: 'Blue' }),
    ]);
    assert.deepEqual(joins.map((join) => join.ok), [true, true, true]);
    assert.deepEqual(
      joins.map((join) => join.room.players.length),
      [2, 3, 4],
    );

    const deniedStart = await emitAck(green, 'room:start', {});
    assert.equal(deniedStart.ok, false);
    assert.match(deniedStart.error, /host/);

    const playingState = waitForState(green, (room) => room.status === 'playing');
    const started = await emitAck(host, 'room:start', {});
    assert.equal(started.ok, true);
    assert.equal(started.room.status, 'playing');
    await playingState;

    const firstRoll = await emitAck(host, 'game:roll', {});
    assert.equal(firstRoll.ok, true);
    assert.equal(firstRoll.result.value, 6);
    assert.equal(firstRoll.room.game.moves.length, 4);

    const firstMove = await emitAck(host, 'game:move', { tokenIndex: 0 });
    assert.equal(firstMove.ok, true);
    assert.equal(firstMove.room.game.tokens.red[0], 0);
    assert.equal(firstMove.room.game.turn, 'red');

    const secondRoll = await emitAck(host, 'game:roll', {});
    assert.equal(secondRoll.result.value, 6);
    const secondMove = await emitAck(host, 'game:move', { tokenIndex: 1 });
    assert.equal(secondMove.room.game.tokens.red[1], 0);

    const thirdRoll = await emitAck(host, 'game:roll', {});
    assert.equal(thirdRoll.result.value, 1);
    const thirdMove = await emitAck(host, 'game:move', { tokenIndex: 0 });
    assert.equal(thirdMove.room.game.tokens.red[0], 1);
    assert.equal(thirdMove.room.game.turn, 'green');

    const greenRoll = await emitAck(green, 'game:roll', {});
    assert.equal(greenRoll.ok, true);
    assert.equal(greenRoll.result.passed, true);
    assert.equal(greenRoll.room.game.turn, 'yellow');

    const outOfTurn = await emitAck(host, 'game:roll', {});
    assert.equal(outOfTurn.ok, false);
    assert.match(outOfTurn.error, /turn/);
  } finally {
    clients.forEach((client) => client.close());
    await close();
  }
});
