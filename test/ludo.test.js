'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGame,
  legalMoves,
  moveToken,
  publicGame,
  rollDice,
} = require('../src/ludo');

function makeGame() {
  return createGame([
    { id: 'p1', name: 'Red', color: 'red' },
    { id: 'p2', name: 'Green', color: 'green' },
    { id: 'p3', name: 'Yellow', color: 'yellow' },
    { id: 'p4', name: 'Blue', color: 'blue' },
  ]);
}

function fixed(value) {
  return () => value;
}

test('createGame seats four players and starts with every token in base', () => {
  const game = makeGame();
  assert.equal(game.status, 'playing');
  assert.equal(game.turn, 0);
  assert.equal(game.players[0].color, 'red');
  assert.deepEqual(game.tokens.red, [-1, -1, -1, -1]);
  assert.deepEqual(game.tokens.blue, [-1, -1, -1, -1]);
});

test('createGame rejects anything other than four players', () => {
  assert.throws(
    () => createGame([{ id: 'p1', name: 'Red', color: 'red' }]),
    /exactly four players/,
  );
});

test('a six releases a token from base and grants another roll', () => {
  const game = makeGame();
  const result = rollDice(game, fixed(0.99));
  assert.equal(result.value, 6);
  assert.equal(result.moves.length, 4);
  assert.equal(game.awaitingMove, true);

  const move = moveToken(game, 0);
  assert.equal(game.tokens.red[0], 0);
  assert.equal(game.turn, 0);
  assert.equal(game.dice, null);
  assert.equal(move.extra, true);
});

test('a non-six moves a token and passes the turn', () => {
  const game = makeGame();
  game.tokens.red[0] = 0;
  const result = rollDice(game, fixed(0));
  assert.equal(result.value, 1);
  assert.equal(result.moves.length, 1);

  moveToken(game, 0);
  assert.equal(game.tokens.red[0], 1);
  assert.equal(game.turn, 1);
  assert.equal(game.players[game.turn].color, 'green');
});

test('a roll with no legal move passes the turn', () => {
  const game = makeGame();
  const result = rollDice(game, fixed(0));
  assert.equal(result.passed, true);
  assert.equal(result.moves.length, 0);
  assert.equal(game.turn, 1);
  assert.equal(game.dice, null);
});

test('three consecutive sixes forfeits the turn', () => {
  const game = makeGame();
  rollDice(game, fixed(0.99));
  moveToken(game, 0);
  rollDice(game, fixed(0.99));
  moveToken(game, 0);
  const third = rollDice(game, fixed(0.99));
  assert.equal(third.forfeited, true);
  assert.equal(game.turn, 1);
  assert.equal(game.consecutiveSixes, 0);
});

test('landing on an opponent captures it and grants another roll', () => {
  const game = makeGame();
  game.tokens.red[0] = 0;
  game.tokens.green[0] = 40; // global square 1
  game.dice = 1;
  game.awaitingMove = true;
  const move = moveToken(game, 0);
  assert.equal(game.tokens.red[0], 1);
  assert.equal(game.tokens.green[0], -1);
  assert.equal(move.captured, 1);
  assert.equal(game.turn, 0);
});

test('safe squares cannot be captured', () => {
  const game = makeGame();
  game.tokens.red[0] = 7; // global square 7
  game.tokens.green[0] = 47; // global square 8, a safe square
  game.dice = 1;
  game.awaitingMove = true;
  const move = moveToken(game, 0);
  assert.equal(game.tokens.red[0], 8);
  assert.equal(game.tokens.green[0], 47);
  assert.equal(move.captured, 0);
});

test('a token must reach home with an exact roll', () => {
  const game = makeGame();
  game.tokens.red[0] = 55;
  const result = rollDice(game, fixed(0.4)); // three
  assert.equal(result.passed, true);
  assert.equal(game.tokens.red[0], 55);
});

test('finishing the fourth token wins the game', () => {
  const game = makeGame();
  game.tokens.red = [57, 57, 57, 56];
  game.dice = 1;
  game.awaitingMove = true;
  const result = moveToken(game, 3);
  assert.equal(game.tokens.red[3], 57);
  assert.equal(result.won, true);
  assert.equal(game.status, 'finished');
  assert.equal(game.winner, 'red');
});

test('illegal token choices are rejected', () => {
  const game = makeGame();
  game.dice = 1;
  game.awaitingMove = true;
  assert.throws(() => moveToken(game, 3), /cannot move/);
});

test('publicGame exposes moves and keeps the full board in sync', () => {
  const game = makeGame();
  game.dice = 6;
  game.awaitingMove = true;
  assert.deepEqual(
    legalMoves(game).map((move) => move.to),
    [0, 0, 0, 0],
  );
  const view = publicGame(game);
  assert.equal(view.turn, 'red');
  assert.equal(view.dice, 6);
  assert.equal(view.moves.length, 4);
  assert.deepEqual(view.tokens.red, [-1, -1, -1, -1]);
});
