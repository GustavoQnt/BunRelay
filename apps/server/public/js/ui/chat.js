import { els } from "./elements.js";
import { clear, el, setHidden } from "../util/dom.js";
import { displayName, formatClock, roomLabel } from "../util/format.js";
import { EMOJI_SHORTLIST } from "../util/emoji.js";

function roleCountLabel(room) {
  const online = room.members.filter((m) => m.online).length;
  return `${room.members.length} membros | ${online} online`;
}

export function renderChat(state) {
  const room = state.rooms.get(state.activeRoomId);
  if (!room) {
    setHidden(els.chatEmpty, false);
    els.chatBody.hidden = true;
    els.chatRoomName.textContent = "Nenhuma sala";
    els.chatRoomMeta.textContent = "Selecione uma sala para iniciar";
    return;
  }

  setHidden(els.chatEmpty, true);
  els.chatBody.hidden = false;

  els.chatRoomName.textContent = roomLabel(room);
  els.chatRoomMeta.textContent = roleCountLabel(room);
  setHidden(els.removedBanner, !room.removed);
  els.composer.classList.toggle("disabled", room.removed);
  els.sendBtn.disabled = room.removed;

  renderMessages(state);
  renderTyping(state);
}

export function renderMessages(state) {
  const room = state.rooms.get(state.activeRoomId);
  clear(els.messages);
  if (!room) return;

  for (const msg of room.messages) {
    if (msg.system) {
      const sys = el("div", "system-msg", msg.text);
      els.messages.appendChild(sys);
      continue;
    }

    const mine = msg.senderId === state.auth.user?.id;
    const row = el("div", `message-row${mine ? " mine" : ""}`);

    const head = el("div", "message-head");
    const sender = el("span", "", mine ? "voce" : displayName(msg.senderId));
    const time = el("span", "", formatClock(msg.ts));
    head.append(sender, time);

    if (mine) {
      const status = state.messageStatus.get(msg.messageId);
      if (status) {
        const mark = el("span", "", `| ${status}`);
        head.appendChild(mark);
      }
    }

    const bubble = el("div", "bubble", msg.content);
    const reactions = renderReactions(state, msg);

    row.append(head, bubble, reactions);
    els.messages.appendChild(row);
  }

  els.messages.scrollTop = els.messages.scrollHeight;
}

function reactionMap(message) {
  if (message.reactions instanceof Map) {
    return message.reactions;
  }

  const map = new Map();
  const source = Array.isArray(message.reactions) ? message.reactions : [];
  for (const entry of source) {
    if (!entry?.emoji || !entry?.userId) {
      continue;
    }

    if (!map.has(entry.emoji)) {
      map.set(entry.emoji, new Set());
    }
    map.get(entry.emoji).add(entry.userId);
  }

  message.reactions = map;
  return map;
}

function renderReactions(state, message) {
  const reactionWrap = el("div", "message-reactions");
  const myUserId = state.auth.user?.id || "";
  const reactions = reactionMap(message);

  const orderedReactions = [...reactions.entries()].sort((a, b) => {
    const countDiff = b[1].size - a[1].size;
    if (countDiff !== 0) {
      return countDiff;
    }
    return a[0].localeCompare(b[0]);
  });

  for (const [emoji, users] of orderedReactions) {
    const isActive = users.has(myUserId);
    const button = el("button", `reaction-chip${isActive ? " active" : ""}`, `${emoji} ${users.size}`);
    button.type = "button";
    button.dataset.action = "toggle-reaction";
    button.dataset.messageId = message.messageId;
    button.dataset.emoji = emoji;
    reactionWrap.appendChild(button);
  }

  const addButton = el("button", "reaction-add", "+");
  addButton.type = "button";
  addButton.dataset.action = "open-reaction-picker";
  addButton.dataset.messageId = message.messageId;
  reactionWrap.appendChild(addButton);

  if (state.emoji.reactionPickerMessageId === message.messageId) {
    const picker = el("div", "reaction-picker");
    for (const emoji of EMOJI_SHORTLIST) {
      const option = el("button", "emoji-option", emoji);
      option.type = "button";
      option.dataset.action = "pick-reaction";
      option.dataset.messageId = message.messageId;
      option.dataset.emoji = emoji;
      picker.appendChild(option);
    }
    reactionWrap.appendChild(picker);
  }

  return reactionWrap;
}

export function renderTyping(state) {
  const room = state.rooms.get(state.activeRoomId);
  if (!room) {
    els.typingIndicator.textContent = "";
    return;
  }

  const typers = [...room.typing].filter((userId) => userId !== state.auth.user?.id).map((id) => displayName(id));
  if (typers.length === 0) {
    els.typingIndicator.textContent = "";
  } else if (typers.length === 1) {
    els.typingIndicator.textContent = `${typers[0]} esta digitando...`;
  } else {
    els.typingIndicator.textContent = `${typers.join(", ")} estao digitando...`;
  }
}

export function addSystemMessage(state, roomId, text) {
  const room = state.rooms.get(roomId);
  if (!room) return;
  room.messages.push({ system: true, text, ts: Date.now() });
  room.lastActivityTs = Math.max(room.lastActivityTs || 0, Date.now());
  if (state.activeRoomId === roomId) {
    renderMessages(state);
  }
}
