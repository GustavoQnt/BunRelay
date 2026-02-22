import { els } from "./elements.js";
import { clear, el } from "../util/dom.js";
import { roomLabel } from "../util/format.js";

function latestMessage(room) {
  if (!room?.messages?.length) return null;
  return room.messages[room.messages.length - 1] || null;
}

function roomMeta(room) {
  if (room.removed) return "removido";
  if (room.type === "dm") return "dm";
  return `${room.members.length} membros`;
}

function roomPreview(room) {
  const last = latestMessage(room);
  if (!last) return "Sem mensagens ainda";
  const content = last.system ? `[sistema] ${last.text}` : last.content;
  const compact = String(content || "").replace(/\s+/g, " ").trim();
  if (!compact) return "Mensagem vazia";
  return compact.length > 52 ? `${compact.slice(0, 52)}...` : compact;
}

export function renderRoomList(state, onSelectRoom) {
  clear(els.roomList);

  if (state.rooms.size === 0) {
    const empty = el("div", "muted", "Nenhuma sala vinculada");
    empty.style.padding = "12px";
    els.roomList.appendChild(empty);
    return;
  }

  const rooms = [...state.rooms.values()].sort((a, b) => {
    if (a.unread !== b.unread) return b.unread - a.unread;
    if ((a.lastActivityTs || 0) !== (b.lastActivityTs || 0)) return (b.lastActivityTs || 0) - (a.lastActivityTs || 0);
    return roomLabel(a).localeCompare(roomLabel(b));
  });

  for (const room of rooms) {
    const item = el("button", `room-item${state.activeRoomId === room.id ? " active" : ""}`);
    item.type = "button";
    item.dataset.roomId = room.id;

    const title = el("div", "room-title");
    title.textContent = roomLabel(room);

    const meta = el("div", "meta room-sub");
    meta.textContent = roomMeta(room);

    const preview = el("div", "room-preview", roomPreview(room));
    const left = el("div", "room-item-main");
    left.append(title, meta, preview);

    item.append(left);
    if (room.unread > 0) {
      const badge = el("span", "badge");
      badge.textContent = room.unread > 99 ? "99+" : String(room.unread);
      item.appendChild(badge);
    }

    item.addEventListener("click", () => onSelectRoom(room.id));
    els.roomList.appendChild(item);
  }
}
