export function createEventRouter(handlers) {
  return function route(event) {
    if (!event || typeof event.type !== "string") {
      return;
    }

    switch (event.type) {
      case "auth:ok":
        handlers.onAuthOk?.(event.data, event);
        return;
      case "auth:error":
        handlers.onAuthError?.(event.data, event);
        return;
      case "room:snapshot":
        handlers.onRoomSnapshot?.(event.data, event);
        return;
      case "msg:ack_server":
        handlers.onMsgAck?.(event.data, event);
        return;
      case "msg:new":
        handlers.onMsgNew?.(event.data, event);
        return;
      case "msg:delivered":
        handlers.onMsgDelivered?.(event.data, event);
        return;
      case "msg:read":
        handlers.onMsgRead?.(event.data, event);
        return;
      case "typing:update":
        handlers.onTyping?.(event.data, event);
        return;
      case "presence:update":
        handlers.onPresence?.(event.data, event);
        return;
      case "room:member:update":
        handlers.onMemberUpdate?.(event.data, event);
        return;
      case "error":
        handlers.onWsError?.(event.data, event);
        return;
      default:
        handlers.onUnknown?.(event);
    }
  };
}
