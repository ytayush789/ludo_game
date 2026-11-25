'use strict';

const COLORS = Object.freeze(['red', 'green', 'yellow', 'blue']);
const TOKENS_PER_PLAYER = 4;
const MAIN_PATH_LENGTH = 52;
const FINISH_PROGRESS = 57;
const START_OFFSETS = Object.freeze({ red: 0, green: 13, yellow: 26, blue: 39 });
const SAFE_SQUARES = Object.freeze([0, 8, 13, 21, 26, 34, 39, 47]);
const SAFE_SET = new Set(SAFE_SQUARES);

// A 15x15 board. Path entries are [row, column] and run clockwise.
const PATH = Object.freeze([
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
]);

const HOME_PATHS = Object.freeze({
  red: Object.freeze([[7, 0], [7, 1], [7, 2], [7, 3], [7, 4], [7, 5]]),
  green: Object.freeze([[0, 7], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7]]),
  yellow: Object.freeze([[7, 14], [7, 13], [7, 12], [7, 11], [7, 10], [7, 9]]),
  blue: Object.freeze([[14, 7], [13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]),
});

const BASE_SLOTS = Object.freeze({
  red: Object.freeze([[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]]),
  green: Object.freeze([[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]]),
  yellow: Object.freeze([[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]]),
  blue: Object.freeze([[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]]),
});

const BOARD = Object.freeze({
  colors: COLORS,
  path: PATH,
  homePaths: HOME_PATHS,
  baseSlots: BASE_SLOTS,
  safeSquares: SAFE_SQUARES,
  tokensPerPlayer: TOKENS_PER_PLAYER,
  finishProgress: FINISH_PROGRESS,
  startOffsets: START_OFFSETS,
});

class LudoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LudoError';
  }
}

function cleanName(value) {
  if (typeof value !== 'string') throw new LudoError('Enter a player name');
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new LudoError('Enter a player name');
  if (name.length > 20) throw new LudoError('Player names are limited to 20 characters');
  return name;
}

function createGame(players) {
  if (!Array.isArray(players) || players.length !== COLORS.length) {
    throw new LudoError('Ludo needs exactly four players');
  }
  const seenColors = new Set();
  const seenNames = new Set();
  for (const player of players) {
    if (!player || typeof player.id !== 'string' || !player.id) {
      throw new LudoError('Every player needs an id');
    }
    if (!COLORS.includes(player.color) || seenColors.has(player.color)) {
      throw new LudoError('Every player needs a unique colour');
    }
    const name = cleanName(player.name);
    const key = name.toLowerCase();
    if (seenNames.has(key)) throw new LudoError('Player names must be unique');
    seenNames.add(key);
    seenColors.add(player.color);
  }
  const tokens = {};
  for (const color of COLORS) tokens[color] = Array(TOKENS_PER_PLAYER).fill(-1);
  return {
    status: 'playing',
    players: players.map((player) => ({
      id: player.id,
      name: cleanName(player.name),
      color: player.color,
    })),
    turn: 0,
    dice: null,
    awaitingMove: false,
    consecutiveSixes: 0,
    winner: null,
    tokens,
    log: [{ type: 'start', message: 'Game started. Red rolls first.' }],
  };
}

function currentPlayer(game) {
  return game.players[game.turn];
}

function currentColor(game) {
  return currentPlayer(game).color;
}

function globalIndex(color, progress) {
  if (!Number.isInteger(progress) || progress < 0 || progress >= MAIN_PATH_LENGTH) return null;
  return (START_OFFSETS[color] + progress) % MAIN_PATH_LENGTH;
}

function captureTargets(game, color, progress) {
  const square = globalIndex(color, progress);
  if (square === null || SAFE_SET.has(square)) return [];
  const targets = [];
  for (const opponent of COLORS) {
    if (opponent === color) continue;
    game.tokens[opponent].forEach((tokenProgress, tokenIndex) => {
      if (globalIndex(opponent, tokenProgress) === square) {
        targets.push({ color: opponent, tokenIndex });
      }
    });
  }
  return targets;
}

function legalMoves(game) {
  if (game.status !== 'playing' || !game.awaitingMove || game.dice === null) return [];
  const color = currentColor(game);
  const moves = [];
  game.tokens[color].forEach((progress, tokenIndex) => {
    if (progress === FINISH_PROGRESS) return;
    if (progress === -1) {
      if (game.dice !== 6) return;
      moves.push({
        tokenIndex,
        from: -1,
        to: 0,
        captures: captureTargets(game, color, 0),
      });
      return;
    }
    const destination = progress + game.dice;
    if (destination > FINISH_PROGRESS) return;
    moves.push({
      tokenIndex,
      from: progress,
      to: destination,
      captures: captureTargets(game, color, destination),
    });
  });
  return moves;
}

function rollDice(game, rng = Math.random) {
  if (game.status !== 'playing') throw new LudoError('The game is not active');
  if (game.awaitingMove) throw new LudoError('Move a token before rolling again');
  const raw = Math.floor(Number(rng()) * 6) + 1;
  const value = Math.min(6, Math.max(1, raw));
  const color = currentColor(game);
  const player = currentPlayer(game);

  if (value === 6) game.consecutiveSixes += 1;
  else game.consecutiveSixes = 0;

  if (game.consecutiveSixes >= 3) {
    game.consecutiveSixes = 0;
    game.log.push({
      type: 'forfeit',
      message: `${player.name} rolled three sixes and loses the turn.`,
    });
    advanceTurn(game);
    return { value, moves: [], forfeited: true };
  }

  game.dice = value;
  game.awaitingMove = true;
  const moves = legalMoves(game);
  game.log.push({
    type: 'roll',
    message: `${player.name} rolled ${value}.`,
  });

  if (moves.length === 0) {
    game.awaitingMove = false;
    game.dice = null;
    game.log.push({
      type: 'pass',
      message: `${player.name} has no legal move.`,
    });
    advanceTurn(game);
    return { value, moves: [], passed: true };
  }

  return { value, moves };
}

function advanceTurn(game) {
  game.turn = (game.turn + 1) % game.players.length;
  game.consecutiveSixes = 0;
  game.dice = null;
  game.awaitingMove = false;
  const next = currentPlayer(game);
  game.log.push({
    type: 'turn',
    message: `${next.name}'s turn (${next.color}).`,
  });
  if (game.log.length > 80) game.log.splice(0, game.log.length - 80);
}

function moveToken(game, tokenIndex) {
  if (game.status !== 'playing') throw new LudoError('The game is not active');
  if (!game.awaitingMove || game.dice === null) throw new LudoError('Roll the dice first');
  if (!Number.isInteger(tokenIndex)) throw new LudoError('Choose a token');
  const move = legalMoves(game).find((candidate) => candidate.tokenIndex === tokenIndex);
  if (!move) throw new LudoError('That token cannot move with this roll');

  const color = currentColor(game);
  const player = currentPlayer(game);
  game.tokens[color][tokenIndex] = move.to;
  for (const target of move.captures) {
    game.tokens[target.color][target.tokenIndex] = -1;
  }

  const finished = move.to === FINISH_PROGRESS;
  const won = game.tokens[color].every((progress) => progress === FINISH_PROGRESS);
  const extra = game.dice === 6 || move.captures.length > 0 || finished;

  if (move.captures.length > 0) {
    game.log.push({
      type: 'capture',
      message: `${player.name} captured ${move.captures.length} token${
        move.captures.length === 1 ? '' : 's'
      }.`,
    });
  }
  if (finished) {
    game.log.push({
      type: 'home',
      message: `${player.name} brought a token home.`,
    });
  }

  game.dice = null;
  game.awaitingMove = false;

  if (won) {
    game.status = 'finished';
    game.winner = color;
    game.log.push({
      type: 'win',
      message: `${player.name} wins the game!`,
    });
    return { move, captured: move.captures.length, finished, won, extra };
  }

  if (extra) {
    game.log.push({
      type: 'extra',
      message: `${player.name} gets another roll.`,
    });
  } else {
    advanceTurn(game);
  }

  return { move, captured: move.captures.length, finished, won, extra };
}

function publicGame(game) {
  return {
    status: game.status,
    players: game.players.map((player) => ({ ...player })),
    turn: currentColor(game),
    turnIndex: game.turn,
    turnPlayerId: currentPlayer(game).id,
    dice: game.dice,
    awaitingMove: game.awaitingMove,
    consecutiveSixes: game.consecutiveSixes,
    winner: game.winner,
    tokens: Object.fromEntries(COLORS.map((color) => [color, [...game.tokens[color]]])),
    moves: legalMoves(game).map((move) => ({
      tokenIndex: move.tokenIndex,
      from: move.from,
      to: move.to,
      captures: move.captures.map((target) => ({ ...target })),
    })),
    log: game.log.slice(-20),
  };
}

module.exports = {
  BASE_SLOTS,
  BOARD,
  COLORS,
  FINISH_PROGRESS,
  HOME_PATHS,
  LudoError,
  MAIN_PATH_LENGTH,
  PATH,
  SAFE_SQUARES,
  START_OFFSETS,
  TOKENS_PER_PLAYER,
  advanceTurn,
  cleanName,
  createGame,
  currentColor,
  currentPlayer,
  globalIndex,
  legalMoves,
  moveToken,
  publicGame,
  rollDice,
};
