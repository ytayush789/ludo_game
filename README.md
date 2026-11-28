# Ludo Four

A four-player Ludo game with room-code multiplayer. One player creates a room,
shares the six-character code, and three friends join from their own devices.
The server owns the dice, turns, captures and win state, so every board stays in
sync.

## Features

- **Unique room codes** — six characters, generated server-side and checked for
  collisions.
- **Exactly four seats** — red, green, yellow and blue are assigned in join order.
- **Host-controlled start** — the host can start only when all four seats are
  filled and connected.
- **Server-authoritative rules** — a six releases a token from base, captures send
  opponents back to base, safe squares protect tokens, and a token needs an exact
  roll to reach home.
- **Extra turns** — rolling a six, capturing, or bringing a token home grants
  another roll. Three consecutive sixes forfeit the turn.
- **Live synchronization** — every roll, move, capture, turn change and win is
  broadcast to all four players through Socket.IO.
- **Reconnect support** — the browser tab stores a private seat token; a refresh
  or temporary disconnect restores the same seat and board.
- **Rematch** — after a win, the host can return the same four players to the
  lobby for another game.
- **Responsive board** — works on desktop, tablet and phone widths.

## Run it

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>. To play with four people, open the same URL on four
devices (or four browser tabs), create a room on one, and join with the code on
the other three.

Set `PORT` to use a different port:

```bash
PORT=8080 npm start
```

## How to play

1. Enter a name and choose **Create a room**.
2. Share the six-character code with three friends.
3. Each friend enters their name and the code, then chooses **Join**.
4. The host chooses **Start game** once all four seats are filled.
5. On your turn, roll the dice. If a token can move, it glows; tap it.
6. Bring all four tokens home to win.

## Rules implemented

- Four tokens per player, starting in the matching corner base.
- A six is required to move a token out of base.
- The 52-square main path is shared; each player has a six-square home column.
- Landing on an opponent token sends it back to base, except on a safe square.
- Safe squares are each player's start square and the star squares.
- Rolling a six, capturing, or finishing a token grants another roll.
- Three sixes in a row forfeits the turn.
- A token must land exactly on home; an over-roll cannot move that token.
- The first player to bring all four tokens home wins.

## Project structure

```text
server.js              Express + Socket.IO server
src/ludo.js            Pure game engine and board geometry
src/rooms.js           Room lifecycle, seats, turns and reconnect tokens
public/index.html      Landing, lobby and game screens
public/styles.css      Responsive board and interface styling
public/app.js          Socket client, board rendering and controls
test/ludo.test.js      Engine rules
test/rooms.test.js     Room and seat lifecycle
test/server.test.js    Four live Socket.IO clients playing together
```

## Tests

```bash
npm test
```

The suite covers the rules (base exit, captures, safe squares, exact home, extra
turns, three-six forfeit, win), room lifecycle (seat colors, capacity, host
transfer, reconnect, cleanup), and an end-to-end Socket.IO game with four real
clients.

## Socket events

Client to server:

| Event | Payload | Purpose |
| --- | --- | --- |
| `room:create` | `{ name }` | Create a room and take the red seat. |
| `room:join` | `{ code, name }` | Join an open seat. |
| `room:resume` | `{ code, playerToken }` | Reclaim a seat after a refresh. |
| `room:start` | — | Host starts a full, connected room. |
| `game:roll` | — | Roll for the current player. |
| `game:move` | `{ tokenIndex }` | Move a legal token. |
| `room:rematch` | — | Host resets a finished game to the lobby. |
| `room:leave` | — | Leave the room. |

Server to client: `state` carries the public room, players and game state. Private
seat tokens are returned only in the create/join/resume acknowledgement.

## Operational notes

- Rooms are held in memory. Restarting the server clears active rooms.
- Run a single server instance, or add a shared adapter before scaling to
  multiple instances.
- A disconnected player's seat is held so they can reconnect. If they never
  return, the room is cleaned up after the grace period.
- No database, accounts, chat or spectator mode is included.
