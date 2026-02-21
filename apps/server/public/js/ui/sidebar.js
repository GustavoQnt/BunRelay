import { els } from "./elements.js";
import { clear, el } from "../util/dom.js";
import { roomLabel } from "../util/format.js";

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
    return roomLabel(a).localeCompare(roomLabel(b));
  });

  for (const room of rooms) {
    const item = el("button", `room-item${state.activeRoomId === room.id ? " active" : ""}`);
    item.type = "button";
    item.dataset.roomId = room.id;

    const title = el("div");
    title.textContent = roomLabel(room);

    const meta = el("div", "meta");
    const removed = room.removed ? "removido" : `${room.type} | ${room.members.length} membros`;
    meta.textContent = removed;

    const left = el("div");
    left.append(title, meta);

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
