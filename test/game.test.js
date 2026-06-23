'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { io } = require('socket.io-client');

const PORT = 32147;
const URL = `http://127.0.0.1:${PORT}`;
const TOKEN = 'automated-test-token';

function waitForOutput(child, text, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for: ${text}\n${output}`)), timeout);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(text)) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(output);
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}\n${output}`));
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function nextEvent(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for socket event ${event}`));
    }, timeout);
    const handler = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once(event, handler);
  });
}

test('teacher and student can complete a scored round', async (t) => {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), HOST_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => server.kill('SIGTERM'));
  await waitForOutput(server, 'VOXEL GUESS is running');

  const health = await fetch(`${URL}/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const host = io(URL, { transports: ['websocket'], forceNew: true });
  const player = io(URL, { transports: ['websocket'], forceNew: true });
  t.after(() => { host.close(); player.close(); });
  await Promise.all([nextEvent(host, 'connect'), nextEvent(player, 'connect')]);

  const auth = await emitAck(host, 'host:authenticate', TOKEN);
  assert.equal(auth.ok, true);

  const join = await emitAck(player, 'player:join', { playerId: 'student-1', name: 'Alex' });
  assert.equal(join.ok, true);
  assert.equal(join.player.score, 0);

  const start = await emitAck(host, 'host:start', { word: 'rocket', duration: 30 });
  assert.equal(start.ok, true);

  const closeEvent = nextEvent(player, 'guess:close');
  const closeGuess = await emitAck(player, 'chat:send', 'rockat');
  assert.equal(closeGuess.ok, true);
  await closeEvent;

  await new Promise((resolve) => setTimeout(resolve, 700)); // Respect chat rate limit.
  const correctEvent = nextEvent(player, 'guess:correct');
  const correct = await emitAck(player, 'chat:send', 'rocket');
  assert.equal(correct.ok, true);
  assert.equal(correct.correct, true);
  const award = await correctEvent;
  assert.ok(award.points >= 100);
  assert.equal(award.place, 1);

  const end = await emitAck(host, 'host:end', {});
  assert.equal(end.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const rejoin = await emitAck(player, 'player:join', { playerId: 'student-1', name: 'Alex' });
  assert.equal(rejoin.state.active, false);
  assert.equal(rejoin.state.answer, 'rocket');
  assert.ok(rejoin.player.score >= 100);
});
