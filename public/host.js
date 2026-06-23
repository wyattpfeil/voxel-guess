'use strict';

const socket = io();
const token = new URLSearchParams(location.search).get('token') || '';
const authError = document.querySelector('#authError');
const hostApp = document.querySelector('#hostApp');
const connectionBadge = document.querySelector('#connectionBadge');
const joinLink = document.querySelector('#joinLink');
const copyLink = document.querySelector('#copyLink');
const joinLinkChoices = document.querySelector('#joinLinkChoices');
const linkHelp = document.querySelector('#linkHelp');
const roundForm = document.querySelector('#roundForm');
const wordInput = document.querySelector('#wordInput');
const durationInput = document.querySelector('#durationInput');
const roundError = document.querySelector('#roundError');
const hostWord = document.querySelector('#hostWord');
const hostHint = document.querySelector('#hostHint');
const hostTimer = document.querySelector('#hostTimer');
const hostProgress = document.querySelector('#hostProgress');
const hostMessages = document.querySelector('#hostMessages');
const playerAdmin = document.querySelector('#playerAdmin');
const revealButton = document.querySelector('#revealButton');
const endButton = document.querySelector('#endButton');
const clearChatButton = document.querySelector('#clearChatButton');
const resetScoresButton = document.querySelector('#resetScoresButton');
const randomEasy = document.querySelector('#randomEasy');
const randomChallenge = document.querySelector('#randomChallenge');
const toasts = document.querySelector('#toasts');

const easyWords = ['tree', 'pizza', 'sword', 'chair', 'house', 'rocket', 'car', 'robot', 'crown', 'burger', 'duck', 'present', 'castle', 'campfire', 'trophy', 'backpack', 'camera', 'cupcake', 'pencil', 'snowman'];
const challengeWords = ['treasure chest', 'ice cream cone', 'gaming controller', 'pirate ship', 'vending machine', 'traffic light', 'roller coaster', 'claw machine', 'haunted house', 'floating island', 'secret laboratory', 'monster truck', 'arcade machine', 'robot vacuum', 'water park'];
let state = null;

function toast(text, kind = '') {
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.textContent = text;
  toasts.appendChild(element);
  setTimeout(() => element.remove(), 3000);
}
function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function renderTimer() {
  if (!state?.active) {
    hostTimer.textContent = '--:--';
    hostProgress.style.width = '0%';
    return;
  }
  const remaining = Math.max(0, state.endsAt - Date.now());
  hostTimer.textContent = formatTime(remaining);
  hostProgress.style.width = `${Math.max(0, Math.min(100, (remaining / (state.duration * 1000)) * 100))}%`;
}
setInterval(renderTimer, 200);

function addMessage(entry, scroll = true) {
  const item = document.createElement('div');
  if (entry.type === 'system') {
    item.className = `message system ${entry.kind || ''}`;
    item.textContent = entry.text;
  } else {
    item.className = 'message';
    const name = document.createElement('strong');
    name.textContent = `${entry.name}: `;
    item.append(name, document.createTextNode(entry.text));
  }
  item.dataset.id = entry.id || '';
  hostMessages.appendChild(item);
  if (scroll) hostMessages.scrollTop = hostMessages.scrollHeight;
}
function renderChat(entries) {
  hostMessages.replaceChildren();
  for (const entry of entries || []) addMessage(entry, false);
  hostMessages.scrollTop = hostMessages.scrollHeight;
}
function renderPlayers() {
  playerAdmin.replaceChildren();
  const players = state?.players || [];
  if (!players.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No students connected.';
    playerAdmin.appendChild(empty);
    return;
  }
  players.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'player-admin-row';
    const name = document.createElement('span');
    name.textContent = `${player.hasGuessed ? '✓ ' : ''}${player.name}`;
    const score = document.createElement('strong');
    score.textContent = player.score;
    const kick = document.createElement('button');
    kick.className = 'btn danger small';
    kick.textContent = 'Remove';
    kick.addEventListener('click', () => {
      if (!confirm(`Remove ${player.name} from the game?`)) return;
      socket.emit('host:kick', player.id, (result) => { if (!result?.ok) toast(result?.error || 'Could not remove player', 'bad'); });
    });
    row.append(name, score, kick);
    playerAdmin.appendChild(row);
  });
}
function renderState(nextState, includeHistory = false) {
  state = nextState;
  hostWord.textContent = state.word || (state.answer || 'No round yet');
  hostHint.textContent = state.maskedWord;
  revealButton.disabled = !state.active;
  endButton.disabled = !state.active;
  if (includeHistory) renderChat(state.chat);
  renderPlayers();
  renderTimer();
}

function authenticate() {
  socket.emit('host:authenticate', token, (result) => {
    if (!result?.ok) {
      connectionBadge.textContent = 'Access denied';
      authError.classList.remove('hidden');
      hostApp.classList.add('hidden');
      return;
    }
    connectionBadge.textContent = 'Teacher connected';
    authError.classList.add('hidden');
    hostApp.classList.remove('hidden');
    fetch('/api/info')
      .then((response) => response.json())
      .then((info) => {
        const links = info.studentUrls?.length ? info.studentUrls : [info.fallbackUrl];
        joinLink.value = links[0];
        if (links.length > 1) {
          joinLinkChoices.replaceChildren();
          links.forEach((url) => {
            const option = document.createElement('option');
            option.value = url;
            option.textContent = url;
            joinLinkChoices.appendChild(option);
          });
          joinLinkChoices.classList.remove('hidden');
          linkHelp.textContent = 'Choose the link that matches your active Wi-Fi network. Students must be on the same network.';
        }
        if (links[0].includes('localhost')) {
          linkHelp.textContent = 'No Wi-Fi address was detected. Students cannot use a localhost link from another device.';
        }
      })
      .catch(() => { joinLink.value = `${location.protocol}//${location.host}`; });
    renderState(result.state, true);
  });
}
socket.on('connect', authenticate);
socket.on('disconnect', () => { connectionBadge.textContent = 'Reconnecting…'; });
socket.on('host:state', (nextState) => renderState(nextState));
socket.on('chat:new', (entry) => addMessage(entry));
socket.on('chat:cleared', () => hostMessages.replaceChildren());
socket.on('game:tick', ({ endsAt, active }) => { if (state) { state.endsAt = endsAt; state.active = active; } });

joinLinkChoices.addEventListener('change', () => { joinLink.value = joinLinkChoices.value; });
copyLink.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(joinLink.value); toast('Student link copied!', 'good'); }
  catch { joinLink.select(); document.execCommand('copy'); toast('Student link copied!', 'good'); }
});
roundForm.addEventListener('submit', (event) => {
  event.preventDefault();
  roundError.textContent = '';
  socket.emit('host:start', { word: wordInput.value, duration: Number(durationInput.value) }, (result) => {
    if (!result?.ok) { roundError.textContent = result?.error || 'Could not start round.'; return; }
    wordInput.value = '';
    toast('Round started!', 'good');
  });
});
revealButton.addEventListener('click', () => socket.emit('host:reveal', {}, (result) => { if (!result?.ok) toast('No more letters to reveal.', 'warn'); }));
endButton.addEventListener('click', () => { if (confirm('End the current round?')) socket.emit('host:end', {}); });
clearChatButton.addEventListener('click', () => { if (confirm('Clear the chat for everyone?')) socket.emit('host:clearChat', {}); });
resetScoresButton.addEventListener('click', () => { if (confirm('Reset all scores to zero?')) socket.emit('host:resetScores', {}); });
randomEasy.addEventListener('click', () => { wordInput.value = easyWords[Math.floor(Math.random() * easyWords.length)]; wordInput.focus(); });
randomChallenge.addEventListener('click', () => { wordInput.value = challengeWords[Math.floor(Math.random() * challengeWords.length)]; wordInput.focus(); });
