export type RateLimitState = {
  tokens: number;
  lastRefillAt: number;
};

export type ConnectionData = {
  connectionId: string;
  requestId?: string;
  traceparent?: string;
  ip: string;
  authed: boolean;
  userId?: string;
  sessionId?: string;
  deviceId?: string;
  joinedRooms: Set<string>;
  authTimeout?: Timer;
  heartbeatTimeout?: Timer;
  rateLimit: RateLimitState;
};

export type ServerSocket = Bun.ServerWebSocket<ConnectionData>;
