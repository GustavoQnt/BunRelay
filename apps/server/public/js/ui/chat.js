import { els } from "./elements.js";
import { clear, el, setHidden } from "../util/dom.js";
import { displayName, formatClock, roomLabel } from "../util/format.js";

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
        const mark = el("span", "", `· ${status}`);
        head.appendChild(mark);
      }
    }

    const bubble = el("div", "bubble", msg.content);

    row.append(head, bubble);
    els.messages.appendChild(row);
  }

  els.messages.scrollTop = els.messages.scrollHeight;
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
  if (state.activeRoomId === roomId) {
    renderMessages(state);
  }
}
