function createRoom(seed) {
  return {
    id: seed.id,
    name: seed.name ?? null,
    type: seed.type ?? "group",
    members: [],
    messages: [],
    typing: new Set(),
    unread: 0,
    joined: false,
    removed: false,
    cursor: null
  };
}

const deviceKey = "bunrelay_device_id";
const existingDeviceId = localStorage.getItem(deviceKey);
const generatedDeviceId = `web-${crypto.randomUUID().slice(0, 10)}`;
const deviceId = existingDeviceId || generatedDeviceId;
localStorage.setItem(deviceKey, deviceId);

export const state = {
  auth: {
    accessToken: "",
    refreshToken: "",
    user: null,
    deviceId
  },
  ws: {
    status: "disconnected",
    reconnecting: false
  },
  rooms: new Map(),
  activeRoomId: "",
  presence: new Map(),
  messageStatus: new Map(),
  seenMessageIds: new Set(),
  drawer: {
    open: true,
    tab: "members",
    auditEntries: [],
    auditOffset: 0,
    auditHasMore: false,
    auditLoading: false,
    auditError: ""
  }
};

export function ensureRoom(seed) {
  if (!state.rooms.has(seed.id)) {
    state.rooms.set(seed.id, createRoom(seed));
  }
  const current = state.rooms.get(seed.id);
  current.name = seed.name ?? current.name;
  current.type = seed.type ?? current.type;
  return current;
}

export function resetRuntimeState() {
  state.rooms.clear();
  state.activeRoomId = "";
  state.presence.clear();
  state.messageStatus.clear();
  state.seenMessageIds.clear();
  state.drawer.open = true;
  state.drawer.tab = "members";
  state.drawer.auditEntries = [];
  state.drawer.auditOffset = 0;
  state.drawer.auditHasMore = false;
  state.drawer.auditLoading = false;
  state.drawer.auditError = "";
}

export function clearAuth() {
  state.auth.accessToken = "";
  state.auth.refreshToken = "";
  state.auth.user = null;
}
