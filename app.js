import { joinRoom } from 'https://esm.run/trystero@0.26.0';

// Identificador único do app na rede P2P. Todos os participantes precisam usar o mesmo valor.
const APP_ID = 'chat-anonimo-mvp-7f3k2q';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1280;
const MAX_TEXT_LENGTH = 2000;
const MAX_NICKNAME_LENGTH = 20;
const MAX_HISTORY = 150;
const MAX_STORED_TOKENS = 500;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

const $ = (id) => document.getElementById(id);

const homeScreen = $('home');
const chatScreen = $('chat');
const homeForm = $('home-form');
const nicknameInput = $('nickname');
const codeInput = $('code');
const homeError = $('home-error');
const messagesEl = $('messages');
const membersEl = $('members');
const messageForm = $('message-form');
const messageInput = $('message-input');
const fileInput = $('file-input');
const attachLabel = document.querySelector('.attach');
const lightbox = $('lightbox');
const toast = $('toast');

let room = null;
let actions = null;
let session = JSON.parse(sessionStorage.getItem('session') || 'null');
let joinedAt = 0;
const messages = new Map(); // id -> mensagem
const deleted = new Map(); // id -> token que comprova a exclusão
const peers = new Map(); // peerId -> apelido

/* ---------- Utilidades ---------- */

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanNickname(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_NICKNAME_LENGTH);
}

// Cada mensagem minha tem um token secreto; só quem tem o token consegue apagá-la.
function loadTokens() {
  return JSON.parse(localStorage.getItem('deleteTokens') || '{}');
}

function saveToken(id, token) {
  const tokens = loadTokens();
  tokens[id] = token;
  const ids = Object.keys(tokens);
  ids.slice(0, Math.max(0, ids.length - MAX_STORED_TOKENS)).forEach((old) => delete tokens[old]);
  localStorage.setItem('deleteTokens', JSON.stringify(tokens));
}

function isMine(id) {
  return id in loadTokens();
}

let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

/* ---------- Tela inicial ---------- */

nicknameInput.value = localStorage.getItem('nickname') || '';
const hashCode = location.hash.slice(1);
if (/^\d{5}$/.test(hashCode)) codeInput.value = hashCode;

function showHomeError(text) {
  homeError.textContent = text;
  homeError.hidden = !text;
}

function readNickname() {
  const nickname = cleanNickname(nicknameInput.value);
  if (!nickname) {
    showHomeError('Informe um apelido.');
    nicknameInput.focus();
    return null;
  }
  return nickname;
}

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 5);
});

homeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  showHomeError('');
  const nickname = readNickname();
  if (!nickname) return;
  const code = codeInput.value.trim();
  if (!/^\d{5}$/.test(code)) {
    showHomeError('Digite o código de 5 dígitos do chat.');
    codeInput.focus();
    return;
  }
  enterRoom(code, nickname);
});

$('create-btn').addEventListener('click', () => {
  showHomeError('');
  const nickname = readNickname();
  if (!nickname) return;
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000).padStart(5, '0');
  enterRoom(code, nickname);
});

function showScreen(name) {
  homeScreen.hidden = name !== 'home';
  chatScreen.hidden = name !== 'chat';
}

/* ---------- Sala P2P ---------- */

function enterRoom(code, nickname) {
  leaveRoom();
  session = { code, nickname };
  sessionStorage.setItem('session', JSON.stringify(session));
  localStorage.setItem('nickname', nickname);
  history.replaceState(null, '', `#${code}`);

  joinedAt = Date.now();
  messages.clear();
  deleted.clear();
  peers.clear();
  messagesEl.replaceChildren();

  room = joinRoom({ appId: APP_ID }, `sala-${code}`, {
    onJoinError: () =>
      showToast('Não foi possível conectar com um participante. A rede pode estar bloqueando conexões P2P.'),
  });

  const hello = room.makeAction('hello');
  const msg = room.makeAction('msg', {
    onReceive: ({ byteLength }) => byteLength <= MAX_IMAGE_BYTES * 1.4 + 8192,
  });
  const del = room.makeAction('del');
  actions = { hello, msg, del };

  // Quem chega recebe de quem já está na sala o apelido, o histórico e as exclusões.
  room.onPeerJoin = (peerId) => {
    hello.send({ nickname, joinedAt }, { target: peerId });
    for (const m of messages.values()) msg.send(m, { target: peerId });
    for (const [id, token] of deleted) del.send({ id, token }, { target: peerId });
  };

  room.onPeerLeave = (peerId) => {
    const name = peers.get(peerId);
    peers.delete(peerId);
    if (name) addSystem(`${name} saiu do chat.`);
    renderMembers();
  };

  hello.onMessage = (data, { peerId }) => {
    const name = cleanNickname(data?.nickname) || 'Anônimo';
    const isNew = !peers.has(peerId);
    peers.set(peerId, name);
    if (isNew && Number(data?.joinedAt) > joinedAt) addSystem(`${name} entrou no chat.`);
    renderMembers();
  };

  msg.onMessage = (data) => receiveMessage(data);
  del.onMessage = (data) => receiveDelete(data);

  $('room-code').textContent = code;
  renderMembers();
  showScreen('chat');
  messageInput.focus();
}

function leaveRoom() {
  room?.leave();
  room = null;
  actions = null;
}

function renderMembers() {
  if (peers.size === 0) {
    membersEl.textContent = 'Só você aqui. Compartilhe o código para alguém entrar.';
    return;
  }
  membersEl.textContent = `${peers.size + 1} online: Você, ${[...peers.values()].join(', ')}`;
}

$('leave-btn').addEventListener('click', () => {
  leaveRoom();
  session = null;
  sessionStorage.removeItem('session');
  history.replaceState(null, '', location.pathname);
  codeInput.value = '';
  showScreen('home');
});

$('copy-btn').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}#${session.code}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast('Link do chat copiado!');
  } catch {
    showToast(`Código do chat: ${session.code}`);
  }
});

/* ---------- Mensagens ---------- */

function sanitizeMessage(data) {
  if (!data || typeof data !== 'object') return null;
  const { id, ts, delHash } = data;
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return null;
  if (typeof delHash !== 'string' || !/^[0-9a-f]{64}$/.test(delHash)) return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;

  const m = { id, ts, delHash, nickname: cleanNickname(data.nickname) || 'Anônimo' };
  if (typeof data.image === 'string') {
    if (!IMAGE_DATA_URL.test(data.image)) return null;
    m.image = data.image;
  } else if (typeof data.text === 'string') {
    m.text = data.text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!m.text) return null;
  } else {
    return null;
  }
  return m;
}

async function receiveMessage(data) {
  const m = sanitizeMessage(data);
  if (!m || messages.has(m.id)) return;
  if (deleted.has(m.id)) {
    if ((await sha256Hex(deleted.get(m.id))) === m.delHash) return;
    if (messages.has(m.id)) return;
  }
  storeMessage(m);
}

async function receiveDelete(data) {
  const { id, token } = data || {};
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return;
  if (typeof token !== 'string' || token.length > 64) return;
  const m = messages.get(id);
  if (m && (await sha256Hex(token)) !== m.delHash) return;
  deleted.set(id, token);
  removeMessage(id);
}

function storeMessage(m) {
  const stick = isNearBottom() || isMine(m.id);
  messages.set(m.id, m);
  renderMessage(m);

  if (messages.size > MAX_HISTORY) {
    const oldest = [...messages.values()].reduce((a, b) => (a.ts <= b.ts ? a : b));
    removeMessage(oldest.id);
  }
  if (stick) scrollToBottom();
}

function removeMessage(id) {
  messages.delete(id);
  messagesEl.querySelector(`[data-id="${id}"]`)?.remove();
}

async function sendMessage(content) {
  if (!actions) return;
  const token = randomId();
  const m = {
    id: randomId(),
    nickname: session.nickname,
    ts: Date.now(),
    delHash: await sha256Hex(token),
    ...content,
  };
  saveToken(m.id, token);
  storeMessage(m);
  await actions.msg.send(m);
}

function deleteMessage(id) {
  const token = loadTokens()[id];
  if (!token || !actions) return;
  deleted.set(id, token);
  removeMessage(id);
  actions.del.send({ id, token });
}

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim().slice(0, MAX_TEXT_LENGTH);
  if (!text) return;
  messageInput.value = '';
  sendMessage({ text }).catch(() => showToast('Não foi possível enviar a mensagem.'));
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Selecione um arquivo de imagem.');
    return;
  }

  attachLabel.classList.add('busy');
  try {
    await sendMessage({ image: await prepareImage(file) });
  } catch (err) {
    showToast(err.message || 'Não foi possível enviar a foto.');
  } finally {
    attachLabel.classList.remove('busy');
  }
});

/* ---------- Renderização ---------- */

// Mensagens do histórico podem chegar fora de ordem, então cada uma é inserida pela data.
function insertByTime(el, ts) {
  el.dataset.ts = ts;
  const next = [...messagesEl.children].find((child) => Number(child.dataset.ts) > ts);
  messagesEl.insertBefore(el, next || null);
}

function addSystem(text) {
  const el = document.createElement('div');
  el.className = 'system';
  el.textContent = text;
  const stick = isNearBottom();
  insertByTime(el, Date.now());
  if (stick) scrollToBottom();
}

function renderMessage(msg) {
  const mine = isMine(msg.id);
  const el = document.createElement('div');
  el.className = `message ${mine ? 'mine' : 'other'}`;
  el.dataset.id = msg.id;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('span');
  name.className = 'nick';
  name.textContent = mine ? 'Você' : msg.nickname;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  meta.append(name, time);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (msg.image) {
    const img = document.createElement('img');
    img.src = msg.image;
    img.alt = `Foto enviada por ${msg.nickname}`;
    img.addEventListener('load', () => {
      if (isNearBottom(400)) scrollToBottom();
    });
    img.addEventListener('click', () => openLightbox(msg.image));
    bubble.append(img);
    bubble.classList.add('has-image');
  } else {
    bubble.textContent = msg.text;
  }

  el.append(meta, bubble);

  if (mine) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.title = msg.image ? 'Apagar foto' : 'Apagar mensagem';
    del.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9z"/></svg>';
    del.addEventListener('click', () => {
      const what = msg.image ? 'esta foto' : 'esta mensagem';
      if (confirm(`Apagar ${what} para todos?`)) deleteMessage(msg.id);
    });
    meta.append(del);
  }

  insertByTime(el, msg.ts);
}

function isNearBottom(threshold = 120) {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ---------- Imagens ---------- */

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Formato de imagem não suportado.'));
    };
    img.src = url;
  });
}

// GIFs são enviados como estão (para manter a animação); o resto é redimensionado e convertido para JPEG.
async function prepareImage(file) {
  if (file.type === 'image/gif') {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('GIF muito grande (máx. 2 MB).');
    return readAsDataUrl(file);
  }

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  if (dataUrl.length * 0.75 > MAX_IMAGE_BYTES) throw new Error('Imagem muito grande (máx. 2 MB).');
  return dataUrl;
}

function openLightbox(src) {
  lightbox.querySelector('img').src = src;
  lightbox.hidden = false;
}

lightbox.addEventListener('click', () => {
  lightbox.hidden = true;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lightbox.hidden = true;
});

/* ---------- Início ---------- */

if (session) enterRoom(session.code, session.nickname);
