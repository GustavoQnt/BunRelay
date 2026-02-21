export function displayName(userId, fallback = "desconhecido") {
  if (!userId) return fallback;
  return userId.replace(/^user_/, "");
}

export function initials(text) {
  const clean = (text ?? "").replace(/^user_/, "").trim();
  if (!clean) return "--";
  return clean.slice(0, 2).toUpperCase();
}

export function formatClock(ts) {
  try {
    return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
}

export function formatDateTime(ts) {
  try {
    return new Date(ts).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "-";
  }
}

export function roomLabel(room) {
  if (!room) return "Sala";
  if (room.name) return room.name;
  return room.id.replace(/^room_/, "");
}
