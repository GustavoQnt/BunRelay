function wsUrlFromLocation() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function createWsClient(options) {
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let manualClose = false;

  function emitStatus(status, detail = "") {
    options.onStatusChange?.(status, detail);
  }

  function scheduleReconnect() {
    if (manualClose) return;
    reconnectAttempt += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(6, reconnectAttempt));
    emitStatus("reconnecting", `Reconectando em ${Math.ceil(delay / 1000)}s...`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    manualClose = false;
    emitStatus("connecting", "Conectando...");
    socket = new WebSocket(wsUrlFromLocation());

    socket.addEventListener("open", () => {
      emitStatus("authenticating", "Autenticando...");
      const payload = options.getAuthPayload?.();
      if (!payload?.token || !payload?.deviceId) {
        emitStatus("disconnected", "Sessao invalida");
        return;
      }
      send("auth:hello", payload);
    });

    socket.addEventListener("message", (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        options.onEvent?.(parsed);
      } catch {
        options.onProtocolError?.("Mensagem WS invalida");
      }
    });

    socket.addEventListener("error", () => {
      emitStatus("disconnected", "Falha de conexao");
    });

    socket.addEventListener("close", () => {
      socket = null;
      if (manualClose) {
        emitStatus("disconnected", "Offline");
        return;
      }
      scheduleReconnect();
    });
  }

  function disconnect() {
    manualClose = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempt = 0;
    if (socket) {
      socket.close();
      socket = null;
    }
  }

  function send(type, data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    const envelope = {
      type,
      id: `evt_${crypto.randomUUID().slice(0, 12)}`,
      ts: Date.now(),
      data
    };

    socket.send(JSON.stringify(envelope));
    return true;
  }

  function markAuthed() {
    reconnectAttempt = 0;
    emitStatus("connected", "Conectado");
  }

  function forceReconnect() {
    if (!socket) {
      connect();
      return;
    }
    manualClose = false;
    socket.close();
  }

  return {
    connect,
    disconnect,
    send,
    markAuthed,
    forceReconnect
  };
}
