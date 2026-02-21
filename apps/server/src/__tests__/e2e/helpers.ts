import { nanoid } from "nanoid";
import type { ServerEvent } from "@bunrelay/shared";

// ---------------------------------------------------------------------------
// TestWSClient — message queue with type-filtered expect()
// ---------------------------------------------------------------------------
export class TestWSClient {
  private ws: WebSocket | null = null;
  private queue: ServerEvent[] = [];
  private waiters: Array<{
    type: string | null;
    resolve: (event: ServerEvent) => void;
    reject: (err: Error) => void;
    timer: Timer;
  }> = [];
  private _closed = false;

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("ws connect error"));
      this.ws.onclose = () => {
        this._closed = true;
      };
      this.ws.onmessage = (ev) => {
        let parsed: ServerEvent;
        try {
          parsed = JSON.parse(ev.data as string) as ServerEvent;
        } catch {
          return;
        }
        this.dispatch(parsed);
      };
    });
  }

  private dispatch(event: ServerEvent) {
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      if (w.type === null || w.type === event.type) {
        this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(event);
        return;
      }
    }
    this.queue.push(event);
  }

  send(type: string, data: unknown, id?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("ws not connected");
    }
    this.ws.send(
      JSON.stringify({
        type,
        id: id ?? `evt_${nanoid(10)}`,
        ts: Date.now(),
        data
      })
    );
  }

  sendRaw(text: string): void {
    this.ws!.send(text);
  }

  async expect(type: string, timeoutMs = 5000): Promise<ServerEvent> {
    // check queue first
    const idx = this.queue.findIndex((e) => e.type === type);
    if (idx !== -1) {
      return this.queue.splice(idx, 1)[0];
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        reject(new Error(`timeout waiting for "${type}" (${timeoutMs}ms)`));
      }, timeoutMs);
      this.waiters.push({ type, resolve, reject, timer });
    });
  }

  /** Wait for any next message regardless of type */
  async expectAny(timeoutMs = 5000): Promise<ServerEvent> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        reject(new Error(`timeout waiting for any event (${timeoutMs}ms)`));
      }, timeoutMs);
      this.waiters.push({ type: null, resolve, reject, timer });
    });
  }

  /** Returns true if no event of given type arrives within timeoutMs */
  async expectNoEvent(type: string, timeoutMs = 1000): Promise<boolean> {
    try {
      await this.expect(type, timeoutMs);
      return false; // got the event — unexpected
    } catch {
      return true; // timeout — expected
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const w of this.waiters) {
      clearTimeout(w.timer);
    }
    this.waiters = [];
  }
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------
let _baseUrl = "";
let _wsUrl = "";

export function setUrls(baseUrl: string, wsUrl: string) {
  _baseUrl = baseUrl;
  _wsUrl = wsUrl;
}

export async function login(
  username: string,
  password = "password123",
  deviceId = "test-device"
): Promise<{ accessToken: string; refreshToken: string; user: { id: string } }> {
  const res = await fetch(`${_baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, deviceId })
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as any;
}

// ---------------------------------------------------------------------------
// High-level helpers — reduce boilerplate to 1 line per client
// ---------------------------------------------------------------------------
export async function authenticatedClient(username: string, deviceId?: string): Promise<TestWSClient> {
  const client = new TestWSClient();
  await client.connect(`${_wsUrl}/ws`);
  const { accessToken } = await login(username, "password123", deviceId ?? `device-${username}`);
  client.send("auth:hello", { token: accessToken, deviceId: deviceId ?? `device-${username}` });
  await client.expect("auth:ok");
  return client;
}

export async function joinedClient(username: string, roomId: string, deviceId?: string): Promise<TestWSClient> {
  const client = await authenticatedClient(username, deviceId);
  client.send("room:join", { roomId });
  await client.expect("room:snapshot");
  return client;
}
