'use strict';

const crypto = require('crypto');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const HOST_TOKEN = process.env.HOST_TOKEN || crypto.randomBytes(18).toString('hex');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 20_000,
  pingTimeout: 20_000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/info', (_req, res) => {
  const studentUrls = localAddresses().map((address) => `http://${address}:${PORT}`);
  res.json({ studentUrls, fallbackUrl: `http://localhost:${PORT}` });
});

const players = new Map(); // playerId -> player
const socketToPlayer = new Map();
const hostSockets = new Set();
const chat = [];
const MAX_CHAT = 60;

const game = {
  roundNumber: 0,
  active: false,
  word: '',
  normalizedWord: '',
  duration: 120,
  startedAt: 0,
  endsAt: 0,
  revealed: new Set(),
  revealFractions: [],
  nextReveal: 0,
  winnerOrder: [],
  endedAnswer: '',
};

function cleanText(value, max = 80) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function normalize(value) {
  return String(value ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function letterIndices(word) {
  const indices = [];
  for (let i = 0; i < word.length; i += 1) {
    if (/[a-z0-9]/i.test(word[i])) indices.push(i);
  }
  return indices;
}

function revealPlan(word) {
  const count = letterIndices(word).length;
  if (count <= 1) return [];
  if (count <= 4) return [0.58];
  if (count <= 8) return [0.42, 0.72];
  return [0.32, 0.56, 0.76];
}

function maskedWord() {
  if (!game.word) return 'Waiting for the teacher…';
  return [...game.word].map((char, index) => {
    if (/\s/.test(char)) return '   ';
    if (!/[a-z0-9]/i.test(char)) return char;
    return game.revealed.has(index) ? char.toUpperCase() : '_';
  }).join(' ');
}

function safePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    connected: player.connected,
    hasGuessed: player.hasGuessed,
    place: player.place,
  };
}

function leaderboard() {
  return [...players.values()]
    .filter((player) => player.connected)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(safePlayer);
}

function publicState() {
  return {
    roundNumber: game.roundNumber,
    active: game.active,
    duration: game.duration,
    startedAt: game.startedAt,
    endsAt: game.endsAt,
    maskedWord: maskedWord(),
    answer: game.active ? '' : game.endedAnswer,
    players: leaderboard(),
    chat,
  };
}

function hostState() {
  return {
    ...publicState(),
    word: game.word,
    hostAuthenticated: true,
  };
}

function emitState() {
  io.emit('game:state', publicState());
  for (const socketId of hostSockets) {
    io.to(socketId).emit('host:state', hostState());
  }
}

function addChat(entry) {
  chat.push({ id: crypto.randomUUID(), at: Date.now(), ...entry });
  while (chat.length > MAX_CHAT) chat.shift();
  io.emit('chat:new', chat[chat.length - 1]);
}

function systemMessage(text, kind = 'system') {
  addChat({ type: 'system', kind, text: cleanText(text, 180) });
}

function chooseRevealIndex() {
  const choices = letterIndices(game.word).filter((index) => !game.revealed.has(index));
  if (!choices.length) return null;

  // Prefer letters that reveal useful information, but keep the order unpredictable.
  const frequency = new Map();
  for (const index of choices) {
    const char = game.word[index].toLowerCase();
    frequency.set(char, (frequency.get(char) || 0) + 1);
  }
  const unique = choices.filter((index) => frequency.get(game.word[index].toLowerCase()) === 1);
  const pool = unique.length ? unique : choices;
  return pool[crypto.randomInt(pool.length)];
}

function revealNextLetter() {
  const index = chooseRevealIndex();
  if (index === null) return false;
  game.revealed.add(index);
  game.nextReveal += 1;
  io.emit('game:hint', { maskedWord: maskedWord() });
  emitState();
  return true;
}

function endRound(reason = 'time') {
  if (!game.active) return;
  game.active = false;
  game.endedAnswer = game.word;
  const answer = game.word;
  const guessed = game.winnerOrder.length;
  systemMessage(
    reason === 'time'
      ? `Time! The word was “${answer}”. ${guessed} player${guessed === 1 ? '' : 's'} guessed it.`
      : `Round ended. The word was “${answer}”.`,
    'round-end',
  );
  emitState();
}

function startRound(word, duration) {
  const cleanedWord = cleanText(word, 60);
  const seconds = Math.max(30, Math.min(600, Number(duration) || 120));
  if (!cleanedWord || !/[a-z0-9]/i.test(cleanedWord)) {
    return { ok: false, error: 'Enter a word containing at least one letter or number.' };
  }

  game.roundNumber += 1;
  game.active = true;
  game.word = cleanedWord;
  game.normalizedWord = normalize(cleanedWord);
  game.duration = seconds;
  game.startedAt = Date.now();
  game.endsAt = game.startedAt + seconds * 1000;
  game.revealed = new Set();
  game.revealFractions = revealPlan(cleanedWord);
  game.nextReveal = 0;
  game.winnerOrder = [];
  game.endedAnswer = '';

  for (const player of players.values()) {
    player.hasGuessed = false;
    player.place = null;
  }

  systemMessage(`Round ${game.roundNumber} started!`, 'round-start');
  emitState();
  return { ok: true };
}

function scoreGuess(player) {
  const remaining = Math.max(0, game.endsAt - Date.now());
  const timeRatio = remaining / (game.duration * 1000);
  const speedPoints = Math.round(100 + 400 * timeRatio);
  const placementBonus = Math.max(0, 75 - game.winnerOrder.length * 15);
  const points = speedPoints + placementBonus;
  player.score += points;
  player.hasGuessed = true;
  player.place = game.winnerOrder.length + 1;
  game.winnerOrder.push(player.id);
  return points;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return previous[b.length];
}

function isCloseGuess(guess, answer) {
  const maxDistance = answer.length >= 9 ? 2 : 1;
  return Math.abs(guess.length - answer.length) <= maxDistance
    && levenshtein(guess, answer) <= maxDistance;
}

io.on('connection', (socket) => {
  socket.on('host:authenticate', (token, callback = () => {}) => {
    if (token !== HOST_TOKEN) {
      callback({ ok: false, error: 'Invalid teacher link.' });
      return;
    }
    hostSockets.add(socket.id);
    socket.data.isHost = true;
    callback({ ok: true, state: hostState() });
  });

  socket.on('player:join', (payload, callback = () => {}) => {
    const id = cleanText(payload?.playerId, 80);
    const requestedName = cleanText(payload?.name, 22);
    if (!id || !requestedName) {
      callback({ ok: false, error: 'Enter your name.' });
      return;
    }

    let player = players.get(id);
    if (!player) {
      const duplicate = [...players.values()].some(
        (other) => other.connected && other.name.toLowerCase() === requestedName.toLowerCase(),
      );
      if (duplicate) {
        callback({ ok: false, error: 'That name is already being used.' });
        return;
      }
      player = {
        id,
        name: requestedName,
        score: 0,
        connected: true,
        socketId: socket.id,
        hasGuessed: false,
        place: null,
        lastChatAt: 0,
      };
      players.set(id, player);
      systemMessage(`${player.name} joined the game.`, 'join');
    } else {
      if (player.socketId && player.socketId !== socket.id) {
        io.to(player.socketId).emit('player:replaced');
      }
      player.name = requestedName;
      player.connected = true;
      player.socketId = socket.id;
    }

    socket.data.playerId = id;
    socketToPlayer.set(socket.id, id);
    callback({ ok: true, player: safePlayer(player), state: publicState() });
    emitState();
  });

  socket.on('chat:send', (rawMessage, callback = () => {}) => {
    const playerId = socket.data.playerId;
    const player = players.get(playerId);
    if (!player || !player.connected) {
      callback({ ok: false, error: 'Join the game first.' });
      return;
    }

    const now = Date.now();
    if (now - player.lastChatAt < 650) {
      callback({ ok: false, error: 'Slow down a little.' });
      return;
    }
    player.lastChatAt = now;

    const message = cleanText(rawMessage, 100);
    if (!message) return callback({ ok: false });

    if (game.active) {
      if (player.hasGuessed) {
        callback({ ok: false, error: 'You already guessed correctly—keep the answer secret!' });
        return;
      }
      const normalizedGuess = normalize(message);
      if (normalizedGuess === game.normalizedWord) {
        const points = scoreGuess(player);
        socket.emit('guess:correct', { points, place: player.place });
        systemMessage(`${player.name} guessed the word!`, 'correct');
        emitState();
        callback({ ok: true, correct: true });
        return;
      }
      if (normalizedGuess && isCloseGuess(normalizedGuess, game.normalizedWord)) {
        socket.emit('guess:close');
      }
    }

    addChat({ type: 'message', playerId: player.id, name: player.name, text: message });
    callback({ ok: true, correct: false });
  });

  socket.on('host:start', (payload, callback = () => {}) => {
    if (!socket.data.isHost) return callback({ ok: false, error: 'Teacher access required.' });
    callback(startRound(payload?.word, payload?.duration));
  });

  socket.on('host:reveal', (_payload, callback = () => {}) => {
    if (!socket.data.isHost) return callback({ ok: false, error: 'Teacher access required.' });
    callback({ ok: revealNextLetter() });
  });

  socket.on('host:end', (_payload, callback = () => {}) => {
    if (!socket.data.isHost) return callback({ ok: false, error: 'Teacher access required.' });
    endRound('teacher');
    callback({ ok: true });
  });

  socket.on('host:resetScores', (_payload, callback = () => {}) => {
    if (!socket.data.isHost) return callback({ ok: false, error: 'Teacher access required.' });
    for (const player of players.values()) player.score = 0;
    systemMessage('Scores were reset by the teacher.', 'system');
    emitState();
    callback({ ok: true });
  });

  socket.on('host:clearChat', (_payload, callback = () => {}) => {
    if (!socket.data.isHost) return callback({ ok: false, error: 'Teacher access required.' });
    chat.length = 0;
    io.emit('chat:cleared');
    emitState();
    callback({ ok: true });
  });

  socket.on('host:kick', (playerId, callback = () => {}) => {
    if (!socket.data.isHost) return callback({ ok: false, error: 'Teacher access required.' });
    const player = players.get(cleanText(playerId, 80));
    if (!player) return callback({ ok: false, error: 'Player not found.' });
    if (player.socketId) io.to(player.socketId).emit('player:kicked');
    players.delete(player.id);
    systemMessage(`${player.name} was removed from the game.`, 'leave');
    emitState();
    callback({ ok: true });
  });

  socket.on('disconnect', () => {
    hostSockets.delete(socket.id);
    const playerId = socketToPlayer.get(socket.id);
    socketToPlayer.delete(socket.id);
    if (!playerId) return;
    const player = players.get(playerId);
    if (player && player.socketId === socket.id) {
      player.connected = false;
      player.socketId = null;
      setTimeout(() => {
        const current = players.get(playerId);
        if (current && !current.connected) players.delete(playerId);
        emitState();
      }, 10 * 60 * 1000).unref();
      emitState();
    }
  });
});

setInterval(() => {
  if (!game.active) return;
  const now = Date.now();
  if (now >= game.endsAt) {
    endRound('time');
    return;
  }
  const elapsedFraction = (now - game.startedAt) / (game.duration * 1000);
  while (
    game.nextReveal < game.revealFractions.length
    && elapsedFraction >= game.revealFractions[game.nextReveal]
  ) {
    if (!revealNextLetter()) break;
  }
  io.emit('game:tick', { endsAt: game.endsAt, active: game.active });
}, 500).unref();

function localAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(info.address);
    }
  }
  return [...new Set(addresses)];
}

server.listen(PORT, '0.0.0.0', () => {
  const addresses = localAddresses();
  console.log('\n==============================================');
  console.log('  VOXEL GUESS is running');
  console.log('==============================================');
  console.log(`Teacher controls: http://localhost:${PORT}/host.html?token=${HOST_TOKEN}`);
  console.log(`Student link:     http://localhost:${PORT}`);
  for (const address of addresses) {
    console.log(`Student Wi-Fi link: http://${address}:${PORT}`);
    console.log(`Teacher Wi-Fi link: http://${address}:${PORT}/host.html?token=${HOST_TOKEN}`);
  }
  console.log('\nKeep this terminal window open during the game.');
  console.log('Press Ctrl+C when class is finished.\n');
});
