const typingByRoom = new Map<string, Set<string>>();

export function setTyping(roomId: string, userId: string, isTyping: boolean) {
  const users = typingByRoom.get(roomId) ?? new Set<string>();

  if (isTyping) {
    users.add(userId);
  } else {
    users.delete(userId);
  }

  if (users.size === 0) {
    typingByRoom.delete(roomId);
  } else {
    typingByRoom.set(roomId, users);
  }

  return {
    roomId,
    userId,
    isTyping
  };
}

