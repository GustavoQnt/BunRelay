import { env } from "../../config/env.ts";

type LogRecord = Record<string, unknown>;

function parseCsv(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseHeaderMap(raw?: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const token of parseCsv(raw)) {
    const idx = token.indexOf("=");
    if (idx <= 0) {
      continue;
    }

    const key = token.slice(0, idx).trim();
    const value = token.slice(idx + 1).trim();
    if (!key || !value) {
      continue;
    }
    out[key] = value;
  }

  return out;
}

class HttpJsonLogSink {
  private queue: LogRecord[] = [];
  private dropped = 0;
  private flushing = false;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timer: Timer;

  constructor(endpoint: string, headers: Record<string, string>) {
    this.endpoint = endpoint;
    this.headers = headers;

    this.timer = setInterval(() => {
      void this.flush();
    }, env.LOG_SINK_FLUSH_INTERVAL_MS);

    if (typeof (this.timer as any).unref === "function") {
      (this.timer as any).unref();
    }

    process.on("beforeExit", () => {
      void this.flush();
    });
  }

  enqueue(record: LogRecord): void {
    if (this.queue.length >= env.LOG_SINK_BUFFER_MAX) {
      this.queue.shift();
      this.dropped += 1;
    }

    this.queue.push(record);
    if (this.queue.length >= env.LOG_SINK_BATCH_SIZE) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.queue.splice(0, env.LOG_SINK_BATCH_SIZE);
    const droppedSinceLastFlush = this.dropped;
    this.dropped = 0;

    const payload = {
      service: env.TRACING_SERVICE_NAME,
      emittedAt: new Date().toISOString(),
      droppedSinceLastFlush,
      records: batch
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.LOG_SINK_TIMEOUT_MS);
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...this.headers
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`external log sink returned status ${response.status}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const rollback = batch.concat(this.queue).slice(0, env.LOG_SINK_BUFFER_MAX);
      this.queue = rollback;
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          event: "log_sink.export_failed",
          sink: this.endpoint,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      this.flushing = false;
    }
  }
}

const sinks = parseCsv(env.LOG_SINK_HTTP_URLS).map((url) => new HttpJsonLogSink(url, parseHeaderMap(env.LOG_SINK_HTTP_HEADERS)));

export function externalLogSinkEnabled(): boolean {
  return sinks.length > 0;
}

export function emitToExternalLogSinks(record: LogRecord): void {
  if (sinks.length === 0) {
    return;
  }

  for (const sink of sinks) {
    sink.enqueue(record);
  }
}

export async function flushExternalLogSinks(): Promise<void> {
  await Promise.all(sinks.map((sink) => sink.flush()));
}
