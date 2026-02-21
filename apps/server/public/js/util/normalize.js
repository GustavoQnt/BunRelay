export function normalizeRoomId(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";
  const cleaned = value.startsWith("#") ? value.slice(1) : value;
  return cleaned.startsWith("room_") ? cleaned : `room_${cleaned}`;
}

export function normalizeUserId(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "";
  const cleaned = value.startsWith("@") ? value.slice(1) : value;
  return cleaned.startsWith("user_") ? cleaned : `user_${cleaned}`;
}

export function parseCsvUsers(raw) {
  return [...new Set((raw ?? "").split(",").map(normalizeUserId).filter(Boolean))];
}
