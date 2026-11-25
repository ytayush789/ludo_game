'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { BOARD, LudoError } = require('./src/ludo');
const { createRoomManager } = require('./src/rooms');

function createServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const rooms = createRoomManager(options);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/api/board', (_request, response) => {
    response.json(BOARD);
  });
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', rooms: rooms.count() });
  });

  const cleanupTimer = setInterval(() => rooms.cleanup(), 60_000);
  cleanupTimer.unref();

  function broadcast(code) {
    const room = rooms.getRoom(code);
    if (room) io.to(`room:${room.code}`).emit('state', rooms.publicRoom(room));
  }

  function reply(ack, payload) {
    if (typeof ack === 'function') ack(payload);
  }

  function guard(ack, action) {
    try {
      action();
    } catch (error) {
      if (error instanceof LudoError) {
        reply(ack, { ok: false, error: error.message });
        return;
      }
      console.error('Unexpected Ludo server error:', error);
      reply(ack, { ok: false, error: 'Unexpected server error' });
    }
  }

  function bind(socket, room, player) {
    if (socket.data.code && socket.data.code !== room.code) {
      socket.leave(`room:${socket.data.code}`);
    }
    socket.join(`room:${room.code}`);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
  }

  function roomState(code) {
    return rooms.publicRoom(rooms.getRoom(code));
  }

  io.on('connection', (socket) => {
    socket.on('room:create', (payload, ack) => {
      guard(ack, () => {
        const result = rooms.createRoom(payload && payload.name, socket.id);
        bind(socket, result.room, result.player);
        broadcast(result.room.code);
        reply(ack, {
          ok: true,
          playerId: result.player.id,
          playerToken: result.player.token,
          room: roomState(result.room.code),
        });
      });
    });

    socket.on('room:join', (payload, ack) => {
      guard(ack, () => {
        const result = rooms.joinRoom(
          payload && payload.code,
          payload && payload.name,
          socket.id,
        );
        bind(socket, result.room, result.player);
        broadcast(result.room.code);
        reply(ack, {
          ok: true,
          playerId: result.player.id,
          playerToken: result.player.token,
          room: roomState(result.room.code),
        });
      });
    });

    socket.on('room:resume', (payload, ack) => {
      guard(ack, () => {
        const result = rooms.resumeRoom(
          payload && payload.code,
          payload && payload.playerToken,
          socket.id,
        );
        bind(socket, result.room, result.player);
        broadcast(result.room.code);
        reply(ack, {
          ok: true,
          playerId: result.player.id,
          playerToken: result.player.token,
          room: roomState(result.room.code),
        });
      });
    });

    socket.on('room:start', (_payload, ack) => {
      guard(ack, () => {
        const code = socket.data.code;
        const playerId = socket.data.playerId;
        if (!code || !playerId) throw new LudoError('Join a room first');
        rooms.startGame(code, playerId);
        broadcast(code);
        reply(ack, { ok: true, room: roomState(code) });
      });
    });

    socket.on('room:rematch', (_payload, ack) => {
      guard(ack, () => {
        const code = socket.data.code;
        const playerId = socket.data.playerId;
        if (!code || !playerId) throw new LudoError('Join a room first');
        rooms.rematch(code, playerId);
        broadcast(code);
        reply(ack, { ok: true, room: roomState(code) });
      });
    });

    socket.on('game:roll', (_payload, ack) => {
      guard(ack, () => {
        const code = socket.data.code;
        const playerId = socket.data.playerId;
        if (!code || !playerId) throw new LudoError('Join a room first');
        const result = rooms.roll(code, playerId);
        broadcast(code);
        reply(ack, { ok: true, result, room: roomState(code) });
      });
    });

    socket.on('game:move', (payload, ack) => {
      guard(ack, () => {
        const code = socket.data.code;
        const playerId = socket.data.playerId;
        if (!code || !playerId) throw new LudoError('Join a room first');
        const result = rooms.move(code, playerId, payload && payload.tokenIndex);
        broadcast(code);
        reply(ack, { ok: true, result, room: roomState(code) });
      });
    });

    socket.on('room:leave', (_payload, ack) => {
      const code = socket.data.code;
      const playerId = socket.data.playerId;
      if (!code || !playerId) {
        reply(ack, { ok: true });
        return;
      }
      rooms.leave(code, playerId);
      socket.leave(`room:${code}`);
      socket.data.code = null;
      socket.data.playerId = null;
      broadcast(code);
      reply(ack, { ok: true });
    });

    socket.on('disconnect', () => {
      const code = socket.data.code;
      const playerId = socket.data.playerId;
      if (!code || !playerId) return;
      rooms.disconnect(code, playerId);
      broadcast(code);
    });
  });

  async function close() {
    clearInterval(cleanupTimer);
    await new Promise((resolve) => io.close(resolve));
  }

  return { app, close, io, rooms, server };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Ludo server running at http://localhost:${port}`);
  });
}

module.exports = { createServer };
