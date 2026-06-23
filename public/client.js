'use strict';

const socket = io();
const joinView = document.querySelector('#joinView');
const gameView = document.querySelector('#gameView');
const joinForm = document.querySelector('#joinForm');
const nameInput = document.querySelector('#nameInput');
const joinError = document.querySelector('#joinError');
const roundLabel = document.querySelector('#roundLabel');
const hint = document.querySelector('#hint');
const timer = document.querySelector('#timer');
const progressBar = document.querySelector('#progressBar');
const answerReveal = document.querySelector('#answerReveal');
const messages = document.querySelector('#messages');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');
const sendButton = document.querySelector('#sendButton');
const chatStatus = document.querySelector('#chatStatus');
const scoreList = document.querySelector('#scoreList');
const youBadge = document.querySelector('#youBadge');
const toasts = document.querySelector('#toasts');

let state = null;
let joined = false;
let myPlayer = null;
let playerId = localStorage.getItem('voxelGuessPlayerId');
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem('voxelGuessPlayerId', playerId);
}
nameInput.value = localStorage.getItem('voxelGuessName') || '';

function toast(text, kind = '') {
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.textContent = text;
  toasts.appendChild(element);
  setTimeout(() => element.remove(), 3200);
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function renderTimer() {
  if (!state?.active) {
    timer.textContent = '--:--';
    progressBar.style.width = '0%';
    return;
  }
  const remaining = Math.max(0, state.endsAt - Date.now());
  timer.textContent = formatTime(remaining);
  progressBar.style.width = `${Math.max(0, Math.min(100, (remaining / (state.duration * 1000)) * 100))}%`;
}
setInterval(renderTimer, 200);

function renderScores() {
  scoreList.replaceChildren();
  const players = state?.players || [];
  if (!players.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No players yet.';
    scoreList.appendChild(empty);
    return;
  }
  players.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = `score-item ${player.hasGuessed ? 'guessed' : ''}`;
    const place = document.createElement('span');
    place.textContent = index + 1;
    const name = document.createElement('span');
    name.className = 'score-name';
    name.textContent = player.id === playerId ? `${player.name} (you)` : player.name;
    const points = document.createElement('span');
    points.className = 'score-points';
    points.textContent = player.score;
    row.append(place, name, points);
    scoreList.appendChild(row);
  });
  myPlayer = players.find((player) => player.id === playerId) || myPlayer;
  if (myPlayer) youBadge.textContent = `${myPlayer.name} · ${myPlayer.score} pts`;
}

function addMessage(entry, scroll = true) {
  const item = document.createElement('div');
  if (entry.type === 'system') {
    item.className = `message system ${entry.kind || ''}`;
    item.textContent = entry.text;
  } else {
    item.className = 'message';
    const name = document.createElement('strong');
    name.textContent = `${entry.name}: `;
    const text = document.createTextNode(entry.text);
    item.append(name, text);
  }
  item.dataset.id = entry.id || '';
  messages.appendChild(item);
  if (scroll) messages.scrollTop = messages.scrollHeight;
}

function renderChatHistory(entries) {
  messages.replaceChildren();
  for (const entry of entries || []) addMessage(entry, false);
  messages.scrollTop = messages.scrollHeight;
}

function renderState(nextState, includeHistory = false) {
  state = nextState;
  hint.textContent = state.maskedWord;
  roundLabel.textContent = state.active ? `Round ${state.roundNumber} is underway` : (state.roundNumber ? `Round ${state.roundNumber} finished` : 'Waiting for a round');
  answerReveal.classList.toggle('hidden', !state.answer);
  answerReveal.textContent = state.answer ? `Answer: ${state.answer}` : '';
  if (includeHistory) renderChatHistory(state.chat);
  renderScores();
  renderTimer();

  myPlayer = state.players.find((player) => player.id === playerId) || myPlayer;
  const locked = Boolean(state.active && myPlayer?.hasGuessed);
  chatInput.disabled = locked;
  sendButton.disabled = locked;
  chatInput.placeholder = locked ? 'You guessed it—keep it secret!' : (state.active ? 'Type a guess…' : 'Chat while you wait…');
  chatStatus.textContent = locked ? 'Correct! Wait for the next round.' : 'Type your guess below';
}

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  joinError.textContent = '';
  socket.emit('player:join', { playerId, name }, (result) => {
    if (!result?.ok) {
      joinError.textContent = result?.error || 'Could not join.';
      return;
    }
    joined = true;
    myPlayer = result.player;
    localStorage.setItem('voxelGuessName', name);
    joinView.classList.add('hidden');
    gameView.classList.remove('hidden');
    renderState(result.state, true);
    chatInput.focus();
  });
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = chatInput.value.trim();
  if (!value) return;
  chatInput.value = '';
  socket.emit('chat:send', value, (result) => {
    if (!result?.ok && result?.error) toast(result.error, 'warn');
  });
});

socket.on('connect', () => {
  if (joined) {
    socket.emit('player:join', { playerId, name: localStorage.getItem('voxelGuessName') || myPlayer?.name }, (result) => {
      if (result?.ok) renderState(result.state, true);
    });
  }
});
socket.on('game:state', (nextState) => { if (joined) renderState(nextState); });
socket.on('game:hint', ({ maskedWord }) => { if (state) { state.maskedWord = maskedWord; hint.textContent = maskedWord; toast('A letter was revealed!', 'warn'); } });
socket.on('game:tick', ({ endsAt, active }) => { if (state) { state.endsAt = endsAt; state.active = active; } });
socket.on('chat:new', (entry) => { if (joined) addMessage(entry); });
socket.on('chat:cleared', () => messages.replaceChildren());
socket.on('guess:correct', ({ points, place }) => toast(`Correct! +${points} points · Place #${place}`, 'good'));
socket.on('guess:close', () => toast('Very close!', 'warn'));
socket.on('player:kicked', () => { alert('The teacher removed you from the game.'); location.reload(); });
socket.on('player:replaced', () => { alert('This player joined from another tab or device.'); location.reload(); });
socket.on('disconnect', () => { if (joined) toast('Connection lost—trying to reconnect…', 'bad'); });
