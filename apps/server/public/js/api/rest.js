class ApiError extends Error {
  constructor(message, code = "INTERNAL", status = 500, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const authConfig = {
  getAccessToken: () => "",
  refreshSession: null
};

let refreshPromise = null;

export function configureApiAuth(config) {
  authConfig.getAccessToken = config.getAccessToken;
  authConfig.refreshSession = config.refreshSession;
}

async function ensureJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("Resposta invalida do servidor", "INTERNAL", response.status);
  }
}

async function maybeRefreshSession() {
  if (!authConfig.refreshSession) {
    return false;
  }

  if (!refreshPromise) {
    refreshPromise = Promise.resolve(authConfig.refreshSession()).finally(() => {
      refreshPromise = null;
    });
  }

  try {
    return await refreshPromise;
  } catch {
    return false;
  }
}

async function requestJson(path, init = {}, opts = {}) {
  const headers = new Headers(init.headers || {});
  const hasBody = init.body !== undefined;

  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const token = authConfig.getAccessToken();
  if (token && !headers.has("authorization") && opts.auth !== false) {
    headers.set("authorization", `Bearer ${token}`);
  }

  let response = await fetch(path, { ...init, headers });
  if (response.status === 401 && opts.auth !== false && opts.retryAuth !== false) {
    const refreshed = await maybeRefreshSession();
    if (refreshed) {
      const retryHeaders = new Headers(init.headers || {});
      if (hasBody && !retryHeaders.has("content-type")) {
        retryHeaders.set("content-type", "application/json");
      }
      const retryToken = authConfig.getAccessToken();
      if (retryToken && !retryHeaders.has("authorization")) {
        retryHeaders.set("authorization", `Bearer ${retryToken}`);
      }
      response = await fetch(path, { ...init, headers: retryHeaders });
    }
  }

  const body = await ensureJson(response);
  if (!response.ok) {
    const errorCode = body?.error?.code || "INTERNAL";
    const errorMessage = body?.error?.message || `Erro HTTP ${response.status}`;
    throw new ApiError(errorMessage, errorCode, response.status, body?.error);
  }

  return body;
}

export function login(payload) {
  return requestJson("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  }, { auth: false, retryAuth: false });
}

export function refresh(payload) {
  return requestJson("/auth/refresh", {
    method: "POST",
    body: JSON.stringify(payload)
  }, { auth: false, retryAuth: false });
}

export function listRooms() {
  return requestJson("/rooms");
}

export function createDm(peerUserId) {
  return requestJson("/rooms/dm", {
    method: "POST",
    body: JSON.stringify({ peerUserId })
  });
}

export function createGroup(name, memberIds) {
  return requestJson("/rooms/groups", {
    method: "POST",
    body: JSON.stringify({ name, memberIds })
  });
}

export function listMembers(roomId) {
  return requestJson(`/rooms/${roomId}/members`);
}

export function addMember(roomId, userId) {
  return requestJson(`/rooms/${roomId}/members`, {
    method: "POST",
    body: JSON.stringify({ userId })
  });
}

export function removeMember(roomId, userId) {
  return requestJson(`/rooms/${roomId}/members/${userId}`, {
    method: "DELETE"
  });
}

export function updateMemberRole(roomId, userId, role) {
  return requestJson(`/rooms/${roomId}/members/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role })
  });
}

export function transferOwner(roomId, userId) {
  return requestJson(`/rooms/${roomId}/owner`, {
    method: "PATCH",
    body: JSON.stringify({ userId })
  });
}

export function fetchAudit(roomId, limit = 30, offset = 0) {
  return requestJson(`/rooms/${roomId}/audit?limit=${limit}&offset=${offset}`);
}

export { ApiError };
