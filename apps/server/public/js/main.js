import {
  addMember,
  ApiError,
  configureApiAuth,
  createDm,
  createGroup,
  fetchAudit,
  listMembers,
  listRooms,
  login,
  refresh,
  removeMember,
  transferOwner,
  updateMemberRole as apiUpdateMemberRole
} from "./api/rest.js";
import { clearAuth, ensureRoom, resetRuntimeState, state } from "./state/store.js";
import { createWsClient } from "./ws/client.js";
import { createEventRouter } from "./ws/events.js";
import { renderDrawer, renderMembers, renderAudit } from "./ui/drawer.js";
import { els } from "./ui/elements.js";
import { clearLoginError, setLoginBusy, showApp, showLogin, showLoginError } from "./ui/login.js";
import { openConfirmModal, openDmModal, openGroupModal } from "./ui/modal.js";
import { renderRoomList } from "./ui/sidebar.js";
import { showToast } from "./ui/toast.js";
import { addSystemMessage, renderChat, renderMessages, renderTyping } from "./ui/chat.js";
import { displayName, roomLabel } from "./util/format.js";
import { EMOJI_SHORTLIST } from "./util/emoji.js";
import { normalizeUserId, parseCsvUsers } from "./util/normalize.js";

let wsClient = null;
let wsAuthed = false;
let heartbeatId = null;
let typingTimer = null;
let typingActive = false;
let refreshPromise = null;
let authRecoveryInProgress = false;
let roomSyncTimerId = null;
let roomSyncPromise = null;
let resizeTimer = null;
let isCompactViewport = window.matchMedia("(max-width: 1040px)").matches;

const ROOM_SYNC_INTERVAL_MS = 4_000;

function setConnStatus(status, text = "") {
  els.connStatus.className = "conn-status";
  if (!status || status === "hidden" || status === "connected") {
    els.connStatus.classList.remove("show");
    els.connStatus.textContent = "";
    return;
  }

  els.connStatus.classList.add("show");
  if (status === "reconnecting") {
    els.connStatus.classList.add("reconnecting");
  }
  if (status === "disconnected") {
    els.connStatus.classList.add("disconnected");
  }
  els.connStatus.textContent = text;
}

function stopHeartbeat() {
  if (heartbeatId) {
    clearInterval(heartbeatId);
    heartbeatId = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatId = setInterval(() => {
    wsSend("presence:ping", {});
  }, 30_000);
}

function wsSend(type, data) {
  if (!wsClient) return false;
  return wsClient.send(type, data);
}

function applyPresenceForRoom(room) {
  for (const member of room.members) {
    const p = state.presence.get(member.userId);
    member.online = p?.status === "online";
  }
}

function applyPresenceForAllRooms() {
  for (const room of state.rooms.values()) {
    applyPresenceForRoom(room);
  }
}

function getApiErrorMessage(error, fallback) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

async function refreshSession() {
  if (refreshPromise) {
    return refreshPromise;
  }

  if (!state.auth.refreshToken) {
    return false;
  }

  refreshPromise = (async () => {
    try {
      const data = await refresh({ refreshToken: state.auth.refreshToken });
      state.auth.accessToken = data.accessToken;
      state.auth.refreshToken = data.refreshToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

configureApiAuth({
  getAccessToken: () => state.auth.accessToken,
  refreshSession
});

function stopRoomSyncLoop() {
  if (roomSyncTimerId) {
    clearInterval(roomSyncTimerId);
    roomSyncTimerId = null;
  }
}

function startRoomSyncLoop() {
  stopRoomSyncLoop();
  roomSyncTimerId = setInterval(() => {
    void syncRooms().catch(() => {});
  }, ROOM_SYNC_INTERVAL_MS);
}

function normalizeRoomMembershipAfterSync(serverIds) {
  const serverSet = new Set(serverIds);

  for (const roomId of [...state.rooms.keys()]) {
    if (!serverSet.has(roomId)) {
      state.rooms.delete(roomId);
      if (state.activeRoomId === roomId) {
        state.activeRoomId = "";
      }
    }
  }
}

async function syncRooms(options = {}) {
  if (!state.auth.accessToken) {
    return { added: [], removed: [] };
  }

  if (roomSyncPromise) {
    return roomSyncPromise;
  }

  roomSyncPromise = (async () => {
    try {
      const data = await listRooms();
      const incomingRooms = data.rooms || [];
      const incomingIds = incomingRooms.map((room) => room.id);
      const previousIds = [...state.rooms.keys()];
      const activeBeforeSync = state.activeRoomId;

      const added = [];
      for (const room of incomingRooms) {
        const existed = state.rooms.has(room.id);
        const local = ensureRoom(room);
        if (!existed) {
          local.lastActivityTs = Date.now();
          added.push(room.id);
        }
      }

      for (const roomId of added) {
        void hydrateRoomMembers(roomId);
      }

      normalizeRoomMembershipAfterSync(incomingIds);
      const removed = previousIds.filter((id) => !incomingIds.includes(id));

      if (!state.activeRoomId && state.rooms.size > 0) {
        const first = [...state.rooms.values()][0];
        state.activeRoomId = first.id;
      }

      const removedActive = removed.includes(activeBeforeSync);
      const roomSetChanged = added.length > 0 || removed.length > 0;

      if (options.focusRoomId && state.rooms.has(options.focusRoomId)) {
        switchRoom(options.focusRoomId);
      } else if (roomSetChanged || removedActive) {
        renderAll();
      } else {
        renderRoomList(state, switchRoom);
      }

      return { added, removed };
    } finally {
      roomSyncPromise = null;
    }
  })();

  return roomSyncPromise;
}

function renderAll() {
  renderRoomList(state, switchRoom);
  renderChat(state);
  renderDrawer(state);
  renderMembers(state);
  renderAudit(state);
}

function selectFirstRoomIfAvailable() {
  if (state.activeRoomId || state.rooms.size === 0) {
    return;
  }
  const first = [...state.rooms.values()][0];
  switchRoom(first.id, { ensureJoin: false });
}

function ensureRoomJoined(roomId) {
  const room = state.rooms.get(roomId);
  if (!room || room.joined || !wsAuthed) return;

  const sent = wsSend("room:join", { roomId });
  if (!sent) {
    showToast("Nao foi possivel enviar room:join", "warn");
  }
}

function switchRoom(roomId, options = {}) {
  const room = state.rooms.get(roomId);
  if (!room || room.removed) {
    return;
  }

  state.activeRoomId = roomId;
  room.unread = 0;
  state.emoji.reactionPickerMessageId = "";
  setComposerEmojiOpen(false);

  state.drawer.auditEntries = [];
  state.drawer.auditOffset = 0;
  state.drawer.auditHasMore = false;
  state.drawer.auditError = "";

  applyPresenceForRoom(room);
  renderAll();

  if (options.ensureJoin !== false) {
    ensureRoomJoined(roomId);
  }

  void hydrateRoomMembers(roomId);

  if (state.drawer.tab === "audit") {
    void loadAudit(true);
  }

  markRoomRead(room);
  if (isCompactViewport) {
    state.drawer.open = false;
    renderDrawer(state);
  }
  els.messageInput.focus();
}

async function hydrateRoomMembers(roomId) {
  try {
    const data = await listMembers(roomId);
    const room = state.rooms.get(roomId);
    if (!room) return;

    room.members = (data.members || []).map((member) => ({
      userId: member.userId,
      displayName: member.displayName,
      role: member.role
    }));

    applyPresenceForRoom(room);

    if (state.activeRoomId === roomId) {
      renderChat(state);
      renderRoomList(state, switchRoom);
      renderMembers(state);
    } else {
      renderRoomList(state, switchRoom);
    }
  } catch (error) {
    const message = getApiErrorMessage(error, "Nao foi possivel carregar membros");
    if (state.activeRoomId === roomId) {
      showToast(message, "warn", 4200);
    }
  }
}

function markRoomRead(room) {
  if (!room || room.messages.length === 0) {
    return;
  }

  const last = [...room.messages].reverse().find((message) => !message.system);
  if (!last) {
    return;
  }

  wsSend("msg:read", {
    roomId: room.id,
    cursor: {
      ts: last.ts,
      messageId: last.messageId
    }
  });
}

async function loadRoomsAfterLogin() {
  await syncRooms();
  selectFirstRoomIfAvailable();
  renderAll();
}

function resetUiForLogout() {
  renderAll();
  els.messages.innerHTML = "";
  els.chatBody.hidden = true;
  els.chatEmpty.classList.remove("hidden");
}

function upsertMessage(room, payload) {
  const reactionMap = buildReactionMap(payload.reactions);
  const existing = room.messages.find((msg) => msg.messageId === payload.messageId);
  if (existing) {
    existing.ts = payload.ts;
    existing.content = payload.content;
    existing.senderId = payload.senderId;
    if (payload.reactions) {
      existing.reactions = reactionMap;
    } else if (!(existing.reactions instanceof Map)) {
      existing.reactions = buildReactionMap(existing.reactions);
    }
    room.lastActivityTs = Math.max(room.lastActivityTs || 0, Number(payload.ts) || Date.now());
    return existing;
  }

  const clone = {
    roomId: payload.roomId,
    messageId: payload.messageId,
    senderId: payload.senderId,
    content: payload.content,
    ts: payload.ts,
    reactions: reactionMap
  };

  room.messages.push(clone);
  room.messages.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return (a.messageId || "").localeCompare(b.messageId || "");
  });
  room.lastActivityTs = Math.max(room.lastActivityTs || 0, Number(payload.ts) || Date.now());

  state.seenMessageIds.add(payload.messageId);
  return clone;
}

function buildReactionMap(reactions) {
  const map = new Map();
  const source = Array.isArray(reactions) ? reactions : [];

  for (const reaction of source) {
    if (!reaction?.emoji || !reaction?.userId) {
      continue;
    }

    if (!map.has(reaction.emoji)) {
      map.set(reaction.emoji, new Set());
    }

    map.get(reaction.emoji).add(reaction.userId);
  }

  return map;
}

function messageReactionUsers(message, emoji) {
  if (!(message.reactions instanceof Map)) {
    message.reactions = buildReactionMap(message.reactions);
  }

  if (!message.reactions.has(emoji)) {
    message.reactions.set(emoji, new Set());
  }

  return message.reactions.get(emoji);
}

function handleRoomSnapshot(data) {
  const room = ensureRoom({ id: data.roomId });
  const roleByUser = new Map(room.members.map((member) => [member.userId, member.role]));

  room.members = (data.members || []).map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    role: roleByUser.get(member.userId) || (room.type === "dm" ? "member" : undefined)
  }));

  room.cursor = data.cursor;
  room.joined = true;
  room.removed = false;

  for (const message of data.messages || []) {
    upsertMessage(room, message);
    wsSend("msg:delivered", { roomId: data.roomId, messageId: message.messageId });
  }

  const latestMessageTs = (data.messages || []).reduce((max, msg) => Math.max(max, Number(msg.ts) || 0), 0);
  if (latestMessageTs > 0) {
    room.lastActivityTs = Math.max(room.lastActivityTs || 0, latestMessageTs);
  }

  applyPresenceForRoom(room);

  if (!state.activeRoomId) {
    state.activeRoomId = data.roomId;
  }

  if (state.activeRoomId === data.roomId) {
    renderAll();
    markRoomRead(room);
  } else {
    renderRoomList(state, switchRoom);
  }
}

function handleNewMessage(data) {
  const room = ensureRoom({ id: data.roomId });
  upsertMessage(room, data);
  room.typing.delete(data.senderId);

  wsSend("msg:delivered", {
    roomId: data.roomId,
    messageId: data.messageId
  });

  if (state.activeRoomId === data.roomId) {
    renderMessages(state);
    renderTyping(state);
    markRoomRead(room);
  } else {
    room.unread = (room.unread || 0) + 1;
    renderRoomList(state, switchRoom);
  }
}

function handleReactionUpdate(data) {
  const room = state.rooms.get(data.roomId);
  if (!room) {
    return;
  }

  const message = room.messages.find((item) => item.messageId === data.messageId);
  if (!message) {
    return;
  }

  const users = messageReactionUsers(message, data.emoji);
  if (data.active) {
    users.add(data.userId);
  } else {
    users.delete(data.userId);
    if (users.size === 0) {
      message.reactions.delete(data.emoji);
    }
  }

  if (state.activeRoomId === data.roomId) {
    renderMessages(state);
  }
}

function compareCursor(message, cursor) {
  if (message.ts < cursor.ts) return true;
  if (message.ts > cursor.ts) return false;
  return message.messageId.localeCompare(cursor.messageId) <= 0;
}

function handleReadReceipt(data) {
  const room = state.rooms.get(data.roomId);
  if (!room) return;

  for (const message of room.messages) {
    if (message.senderId === state.auth.user?.id && compareCursor(message, data.cursor)) {
      state.messageStatus.set(message.messageId, "lida");
    }
  }

  if (state.activeRoomId === data.roomId) {
    renderMessages(state);
  }
}

function applyMemberRole(room, userId, role) {
  const member = room.members.find((item) => item.userId === userId);
  if (member) {
    member.role = role;
  } else {
    room.members.push({ userId, displayName: displayName(userId), role });
  }
}

function handleMemberUpdate(data) {
  const existed = state.rooms.has(data.roomId);
  const room = ensureRoom({ id: data.roomId });
  const actor = displayName(data.actorUserId);
  const user = displayName(data.userId);
  const isCurrentUserTarget = data.userId === state.auth.user?.id;
  const shouldShowGroupSystemMessage = room.type === "group" && Boolean(room.name);

  if (data.action === "added") {
    const exists = room.members.some((m) => m.userId === data.userId);
    if (!exists) {
      room.members.push({ userId: data.userId, displayName: user, role: data.role || "member" });
    }
    room.removed = false;
    room.lastActivityTs = Date.now();
    if (shouldShowGroupSystemMessage) {
      addSystemMessage(state, room.id, `${actor} adicionou ${user}`);
    }
  }

  if (data.action === "removed") {
    room.members = room.members.filter((m) => m.userId !== data.userId);
    room.lastActivityTs = Date.now();
    if (shouldShowGroupSystemMessage) {
      addSystemMessage(state, room.id, `${actor} removeu ${user}`);
    }

    if (data.userId === state.auth.user?.id) {
      room.removed = true;
      showToast(`Voce foi removido de ${roomLabel(room)}`, "error", 5000);
    }
  }

  if (data.action === "role_updated") {
    applyMemberRole(room, data.userId, data.role || "member");
    room.lastActivityTs = Date.now();
    if (shouldShowGroupSystemMessage) {
      addSystemMessage(state, room.id, `${actor} alterou papel de ${user} para ${data.role || "member"}`);
    }
  }

  if (data.action === "owner_transferred") {
    applyMemberRole(room, data.actorUserId, "admin");
    applyMemberRole(room, data.userId, "owner");
    room.lastActivityTs = Date.now();
    if (shouldShowGroupSystemMessage) {
      addSystemMessage(state, room.id, `${actor} transferiu ownership para ${user}`);
    }
  }

  applyPresenceForRoom(room);
  renderAll();

  if (!existed || (data.action === "added" && isCurrentUserTarget)) {
    void syncRooms().catch(() => {});
  }
}

async function recoverFromAuthFailure() {
  if (authRecoveryInProgress) {
    return;
  }

  authRecoveryInProgress = true;
  const refreshed = await refreshSession();
  authRecoveryInProgress = false;

  if (refreshed && wsClient) {
    wsClient.forceReconnect();
    return;
  }

  showToast("Sessao expirada. Faca login novamente.", "error", 5000);
  logout();
}

const routeWsEvent = createEventRouter({
  onAuthOk: () => {
    wsAuthed = true;
    wsClient?.markAuthed();
    startHeartbeat();
    startRoomSyncLoop();
    void syncRooms().catch(() => {});

    if (state.activeRoomId) {
      ensureRoomJoined(state.activeRoomId);
    } else {
      selectFirstRoomIfAvailable();
      if (state.activeRoomId) {
        ensureRoomJoined(state.activeRoomId);
      }
    }
  },
  onAuthError: () => {
    void recoverFromAuthFailure();
  },
  onRoomSnapshot: handleRoomSnapshot,
  onMsgAck: (data) => {
    state.messageStatus.set(data.messageId, state.messageStatus.get(data.messageId) || "enviada");
    if (state.activeRoomId) renderMessages(state);
  },
  onMsgNew: handleNewMessage,
  onReactionUpdate: handleReactionUpdate,
  onMsgDelivered: (data) => {
    if (data.userId !== state.auth.user?.id) {
      state.messageStatus.set(data.messageId, "entregue");
      if (state.activeRoomId === data.roomId) {
        renderMessages(state);
      }
    }
  },
  onMsgRead: handleReadReceipt,
  onTyping: (data) => {
    const room = state.rooms.get(data.roomId);
    if (!room) return;
    if (data.isTyping) {
      room.typing.add(data.userId);
    } else {
      room.typing.delete(data.userId);
    }
    if (state.activeRoomId === data.roomId) {
      renderTyping(state);
    }
  },
  onPresence: (data) => {
    state.presence.set(data.userId, data);
    applyPresenceForAllRooms();
    if (state.activeRoomId) {
      renderChat(state);
      renderMembers(state);
    }
  },
  onMemberUpdate: handleMemberUpdate,
  onWsError: (data) => {
    if (data.code === "UNAUTHORIZED") {
      void recoverFromAuthFailure();
      return;
    }
    showToast(`${data.code}: ${data.message}`, data.code === "BAD_REQUEST" ? "warn" : "error");
  }
});

function connectWs() {
  if (!wsClient) {
    wsClient = createWsClient({
      getAuthPayload: () => ({ token: state.auth.accessToken, deviceId: state.auth.deviceId }),
      onStatusChange: (status, detail) => {
        state.ws.status = status;
        if (status === "connected") {
          setConnStatus("hidden");
        } else if (status === "reconnecting") {
          setConnStatus("reconnecting", detail || "Reconectando...");
          wsAuthed = false;
          for (const room of state.rooms.values()) {
            room.joined = false;
          }
        } else if (status === "disconnected") {
          setConnStatus("disconnected", detail || "Desconectado");
          wsAuthed = false;
        } else if (status === "connecting" || status === "authenticating") {
          setConnStatus("reconnecting", detail || "Conectando...");
        }
      },
      onProtocolError: (message) => showToast(message, "error"),
      onEvent: routeWsEvent
    });
  }

  wsClient.connect();
}

function closeWs() {
  stopHeartbeat();
  stopRoomSyncLoop();
  wsAuthed = false;
  if (wsClient) {
    wsClient.disconnect();
  }
}

async function submitLogin(event) {
  event.preventDefault();
  clearLoginError();
  setLoginBusy(true);

  const username = els.usernameInput.value.trim();
  const password = els.passwordInput.value;
  const device = els.deviceIdInput.value.trim() || state.auth.deviceId;

  try {
    const data = await login({ username, password, deviceId: device });

    state.auth.accessToken = data.accessToken;
    state.auth.refreshToken = data.refreshToken;
    state.auth.user = data.user;
    state.auth.deviceId = data.deviceId || device;
    localStorage.setItem("bunrelay_device_id", state.auth.deviceId);

    showApp(data.user);
    await loadRoomsAfterLogin();
    startRoomSyncLoop();
    connectWs();
  } catch (error) {
    showLoginError(getApiErrorMessage(error, "Falha no login"));
  } finally {
    setLoginBusy(false);
  }
}

function logout() {
  closeWs();
  clearAuth();
  resetRuntimeState();
  setComposerEmojiOpen(false);
  resetUiForLogout();
  showLogin();
}

function renderComposerEmojiPicker() {
  els.composerEmojiPicker.innerHTML = "";
  for (const emoji of EMOJI_SHORTLIST) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-option";
    button.dataset.action = "composer-emoji";
    button.dataset.emoji = emoji;
    button.textContent = emoji;
    els.composerEmojiPicker.appendChild(button);
  }
}

function setComposerEmojiOpen(open) {
  state.emoji.composerOpen = open;
  els.composerEmojiBtn.setAttribute("aria-expanded", open ? "true" : "false");
  els.composerEmojiPicker.classList.toggle("hidden", !open);
}

function insertEmojiInComposer(emoji) {
  const input = els.messageInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);

  input.value = `${before}${emoji}${after}`;
  const cursor = start + emoji.length;
  input.setSelectionRange(cursor, cursor);
  input.focus();
  onComposerInput();
}

function sendReaction(roomId, messageId, emoji, active) {
  const sent = wsSend("reaction:set", { roomId, messageId, emoji, active });
  if (!sent) {
    showToast("Conexao indisponivel para reagir", "warn");
  }
}

function handleReactionClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const room = state.rooms.get(state.activeRoomId);
  if (!room || room.removed) {
    return;
  }

  const action = button.dataset.action;
  const messageId = button.dataset.messageId;
  const emoji = button.dataset.emoji;
  if (!messageId) {
    return;
  }

  if (action === "open-reaction-picker") {
    state.emoji.reactionPickerMessageId = state.emoji.reactionPickerMessageId === messageId ? "" : messageId;
    renderMessages(state);
    return;
  }

  if (!emoji) {
    return;
  }

  if (action === "pick-reaction") {
    state.emoji.reactionPickerMessageId = "";
    renderMessages(state);
    sendReaction(room.id, messageId, emoji, true);
    return;
  }

  if (action === "toggle-reaction") {
    const message = room.messages.find((item) => item.messageId === messageId);
    if (!message) {
      return;
    }
    const users = messageReactionUsers(message, emoji);
    const hasReaction = users.has(state.auth.user?.id || "");
    sendReaction(room.id, messageId, emoji, !hasReaction);
  }
}

function sendMessage() {
  const room = state.rooms.get(state.activeRoomId);
  if (!room || room.removed) return;

  const content = els.messageInput.value.trim();
  if (!content) return;

  const messageId = `msg_${crypto.randomUUID().slice(0, 12)}`;
  const payload = {
    roomId: room.id,
    messageId,
    senderId: state.auth.user.id,
    content,
    ts: Date.now()
  };

  upsertMessage(room, payload);
  state.messageStatus.set(messageId, "enviando");
  renderMessages(state);

  const sent = wsSend("msg:send", {
    roomId: room.id,
    messageId,
    content
  });

  if (!sent) {
    state.messageStatus.set(messageId, "falhou");
    showToast("Conexao indisponivel para enviar", "warn");
    renderMessages(state);
    return;
  }

  if (typingActive) {
    typingActive = false;
    clearTimeout(typingTimer);
    wsSend("typing:set", { roomId: room.id, isTyping: false });
  }

  els.messageInput.value = "";
  setComposerEmojiOpen(false);
  els.messageInput.focus();
}

function onComposerInput() {
  const room = state.rooms.get(state.activeRoomId);
  if (!room || room.removed) return;

  if (!typingActive) {
    typingActive = true;
    wsSend("typing:set", { roomId: room.id, isTyping: true });
  }

  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingActive = false;
    wsSend("typing:set", { roomId: room.id, isTyping: false });
  }, 2500);
}

async function openCreateDmFlow() {
  openDmModal(async ({ peer, close }) => {
    const peerUserId = normalizeUserId(peer);
    if (!peerUserId || peerUserId === state.auth.user?.id) {
      showToast("Informe outro usuario valido", "warn");
      return;
    }

    try {
      const data = await createDm(peerUserId);
      const room = ensureRoom(data.room);
      room.members = [
        { userId: state.auth.user.id, displayName: state.auth.user.displayName, role: "member" },
        { userId: peerUserId, displayName: displayName(peerUserId), role: "member" }
      ];

      close();
      showToast(data.created ? "DM criado" : "DM ja existente", "info");
      switchRoom(room.id);
      void syncRooms().catch(() => {});
    } catch (error) {
      showToast(getApiErrorMessage(error, "Falha ao criar DM"), "error", 4500);
    }
  });
}

async function openCreateGroupFlow() {
  openGroupModal(async ({ name, membersRaw, close }) => {
    const memberIds = parseCsvUsers(membersRaw).filter((userId) => userId !== state.auth.user?.id);
    if (!name) {
      showToast("Nome da sala nao pode ser vazio", "warn");
      return;
    }
    if (memberIds.length === 0) {
      showToast("Informe ao menos um membro", "warn");
      return;
    }

    try {
      const data = await createGroup(name, memberIds);
      const room = ensureRoom(data.room);
      room.members = (data.memberIds || []).map((userId) => ({
        userId,
        displayName: displayName(userId),
        role: userId === state.auth.user?.id ? "owner" : "member"
      }));

      close();
      showToast("Grupo criado", "info");
      switchRoom(room.id);
      void syncRooms().catch(() => {});
    } catch (error) {
      showToast(getApiErrorMessage(error, "Falha ao criar grupo"), "error", 4500);
    }
  });
}

async function submitAddMember(event) {
  event.preventDefault();

  const room = state.rooms.get(state.activeRoomId);
  if (!room) {
    showToast("Selecione uma sala", "warn");
    return;
  }
  if (room.type !== "group") {
    showToast("Gestao de membros disponivel apenas para grupos", "warn");
    return;
  }

  const userId = normalizeUserId(els.addMemberInput.value);
  if (!userId || userId === state.auth.user?.id) {
    showToast("Informe um usuario valido", "warn");
    return;
  }

  try {
    const data = await addMember(room.id, userId);
    if (data.added) {
      const exists = room.members.some((member) => member.userId === userId);
      if (!exists) {
        room.members.push({ userId, displayName: displayName(userId), role: "member" });
      }
      showToast("Membro adicionado", "info");
      renderMembers(state);
      renderRoomList(state, switchRoom);
    } else {
      showToast("Usuario ja era membro", "warn");
    }
    els.addMemberInput.value = "";
  } catch (error) {
    showToast(getApiErrorMessage(error, "Falha ao adicionar membro"), "error", 5000);
  }
}

function handleMemberActionClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const room = state.rooms.get(state.activeRoomId);
  if (!room || room.type !== "group") return;

  const userId = button.dataset.userId;
  const action = button.dataset.action;
  if (!userId || !action) return;

  const runAction = async () => {
    try {
      if (action === "promote") {
        await apiUpdateMemberRole(room.id, userId, "admin");
        applyMemberRole(room, userId, "admin");
        showToast(`Promovido: ${displayName(userId)}`, "info");
      }

      if (action === "demote") {
        await apiUpdateMemberRole(room.id, userId, "member");
        applyMemberRole(room, userId, "member");
        showToast(`Rebaixado: ${displayName(userId)}`, "info");
      }

      if (action === "remove") {
        await removeMember(room.id, userId);
        room.members = room.members.filter((member) => member.userId !== userId);
        showToast(`Removido: ${displayName(userId)}`, "info");
      }

      if (action === "transfer") {
        await transferOwner(room.id, userId);
        applyMemberRole(room, state.auth.user.id, "admin");
        applyMemberRole(room, userId, "owner");
        showToast(`Ownership transferido para ${displayName(userId)}`, "info");
      }

      renderAll();
    } catch (error) {
      showToast(getApiErrorMessage(error, "Falha na operacao"), "error", 5000);
    }
  };

  if (action === "remove") {
    openConfirmModal({
      title: "Remover membro",
      message: `Confirmar remocao de ${displayName(userId)}?`,
      confirmLabel: "Remover",
      onConfirm: runAction
    });
    return;
  }

  if (action === "demote") {
    openConfirmModal({
      title: "Rebaixar admin",
      message: `Rebaixar ${displayName(userId)} para member?`,
      confirmLabel: "Rebaixar",
      onConfirm: runAction
    });
    return;
  }

  if (action === "transfer") {
    openConfirmModal({
      title: "Transferir ownership",
      message: `Transferir ownership da sala para ${displayName(userId)}?`,
      confirmLabel: "Transferir",
      onConfirm: runAction
    });
    return;
  }

  void runAction();
}

async function loadAudit(reset = false) {
  const roomId = state.activeRoomId;
  if (!roomId) {
    return;
  }

  if (reset) {
    state.drawer.auditEntries = [];
    state.drawer.auditOffset = 0;
    state.drawer.auditHasMore = true;
    state.drawer.auditError = "";
  }

  if (state.drawer.auditLoading || !state.drawer.auditHasMore) {
    renderAudit(state);
    return;
  }

  state.drawer.auditLoading = true;
  renderAudit(state);

  try {
    const limit = 30;
    const offset = state.drawer.auditOffset;
    const data = await fetchAudit(roomId, limit, offset);
    const entries = data.entries || [];

    state.drawer.auditEntries.push(...entries);
    state.drawer.auditOffset += entries.length;
    state.drawer.auditHasMore = entries.length === limit;
    state.drawer.auditError = "";
  } catch (error) {
    state.drawer.auditError = getApiErrorMessage(error, "Nao foi possivel carregar auditoria");
    state.drawer.auditHasMore = false;
  } finally {
    state.drawer.auditLoading = false;
    renderAudit(state);
  }
}

function handleViewportResize() {
  const compactNow = window.matchMedia("(max-width: 1040px)").matches;
  if (compactNow === isCompactViewport) {
    return;
  }

  isCompactViewport = compactNow;
  if (!compactNow) {
    state.drawer.open = true;
  } else {
    state.drawer.open = false;
  }
  renderDrawer(state);
}

function onWindowResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    handleViewportResize();
    renderChat(state);
  }, 120);
}

function setupUiEvents() {
  els.deviceIdInput.value = state.auth.deviceId;
  renderComposerEmojiPicker();

  els.loginForm.addEventListener("submit", submitLogin);
  els.logoutBtn.addEventListener("click", logout);

  els.createDmBtn.addEventListener("click", () => {
    void openCreateDmFlow();
  });

  els.createGroupBtn.addEventListener("click", () => {
    void openCreateGroupFlow();
  });

  els.membersToggle.addEventListener("click", () => {
    state.drawer.open = !state.drawer.open;
    renderDrawer(state);
  });

  els.tabMembers.addEventListener("click", () => {
    state.drawer.tab = "members";
    renderDrawer(state);
    renderMembers(state);
  });

  els.tabAudit.addEventListener("click", () => {
    state.drawer.tab = "audit";
    renderDrawer(state);
    if (state.drawer.auditEntries.length === 0) {
      void loadAudit(true);
    } else {
      renderAudit(state);
    }
  });

  els.loadAuditBtn.addEventListener("click", () => {
    void loadAudit(false);
  });

  els.addMemberForm.addEventListener("submit", submitAddMember);
  els.membersList.addEventListener("click", handleMemberActionClick);

  els.composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });

  els.composerEmojiBtn.addEventListener("click", () => {
    setComposerEmojiOpen(!state.emoji.composerOpen);
  });

  els.composerEmojiPicker.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='composer-emoji']");
    if (!button) {
      return;
    }

    const emoji = button.dataset.emoji;
    if (!emoji) {
      return;
    }

    insertEmojiInComposer(emoji);
    setComposerEmojiOpen(false);
  });

  els.messages.addEventListener("click", handleReactionClick);
  els.messageInput.addEventListener("input", onComposerInput);

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (!event.target.closest("#composer")) {
      setComposerEmojiOpen(false);
    }

    if (
      state.emoji.reactionPickerMessageId &&
      !event.target.closest(".reaction-picker") &&
      !event.target.closest("button[data-action='open-reaction-picker']")
    ) {
      state.emoji.reactionPickerMessageId = "";
      if (state.activeRoomId) {
        renderMessages(state);
      }
    }
  });

  window.addEventListener("resize", onWindowResize);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.auth.accessToken) {
      void syncRooms().catch(() => {});
    }
  });
}

function start() {
  setupUiEvents();
  handleViewportResize();
  renderAll();
  showLogin();
  setConnStatus("hidden");
}

start();
