import { env } from "../../config/env.ts";
import {
  currentObservabilityContext,
  runWithObservabilityContext,
  runWithObservabilityContextAsync
} from "./context.ts";

type Primitive = string | number | boolean;
type Attributes = Record<string, Primitive | undefined>;
type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";
type SpanStatusCode = "unset" | "ok" | "error";

type SpanStatus = {
  code: SpanStatusCode;
  message?: string;
};

type SpanRecord = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  kind: SpanKind;
  status: SpanStatus;
  attributes: Attributes;
};

type RunSpanOptions = {
  name: string;
  kind?: SpanKind;
  attributes?: Attributes;
  parentTraceparent?: string;
  requestId?: string;
  connectionId?: string;
  userId?: string;
};

type OtlpAttribute = {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
};

type SpanHandle = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
  traceparent: string;
  end: (status?: SpanStatus) => void;
  setAttributes: (attributes: Attributes) => void;
};

type TraceParent = {
  traceId: string;
  spanId: string;
  sampled: boolean;
};

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;
const NANOS_PER_MS = 1_000_000;
const MAX_EXPORT_QUEUE = 8_000;

function nowUnixNanoString(): string {
  return String(BigInt(Date.now()) * BigInt(NANOS_PER_MS));
}

function randomHex(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}

function isAllZeros(hex: string): boolean {
  return /^0+$/.test(hex);
}

function parseTraceparent(value?: string | null): TraceParent | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const traceId = match[2]!.toLowerCase();
  const spanId = match[3]!.toLowerCase();
  const flags = parseInt(match[4]!, 16);

  if (isAllZeros(traceId) || isAllZeros(spanId)) {
    return null;
  }

  return {
    traceId,
    spanId,
    sampled: (flags & 0x01) === 0x01
  };
}

function formatTraceparent(input: TraceParent): string {
  return `00-${input.traceId}-${input.spanId}-${input.sampled ? "01" : "00"}`;
}

function sanitizeAttributes(input?: Attributes): Attributes {
  if (!input) {
    return {};
  }

  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function attributeToOtlp([key, value]: [string, Primitive]): OtlpAttribute {
  if (typeof value === "boolean") {
    return {
      key,
      value: { boolValue: value }
    };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return {
        key,
        value: { intValue: String(value) }
      };
    }
    return {
      key,
      value: { doubleValue: value }
    };
  }

  return {
    key,
    value: { stringValue: value }
  };
}

function parseHeaderMap(raw?: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  const out: Record<string, string> = {};
  const segments = raw
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const sepIdx = segment.indexOf("=");
    if (sepIdx <= 0) {
      continue;
    }

    const key = segment.slice(0, sepIdx).trim();
    const value = segment.slice(sepIdx + 1).trim();
    if (!key || !value) {
      continue;
    }

    out[key] = value;
  }

  return out;
}

function mapSpanKind(kind: SpanKind): number {
  switch (kind) {
    case "internal":
      return 1;
    case "server":
      return 2;
    case "client":
      return 3;
    case "producer":
      return 4;
    case "consumer":
      return 5;
    default:
      return 1;
  }
}

function mapStatusCode(code: SpanStatusCode): number {
  switch (code) {
    case "ok":
      return 1;
    case "error":
      return 2;
    default:
      return 0;
  }
}

class OtlpHttpTraceExporter {
  private queue: SpanRecord[] = [];
  private flushing = false;
  private readonly timer: Timer;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(endpoint: string, headers: Record<string, string>) {
    this.endpoint = endpoint;
    this.headers = headers;

    this.timer = setInterval(() => {
      void this.flush();
    }, env.TRACING_EXPORT_INTERVAL_MS);

    if (typeof (this.timer as any).unref === "function") {
      (this.timer as any).unref();
    }

    process.on("beforeExit", () => {
      void this.flush();
    });
  }

  enqueue(span: SpanRecord): void {
    if (this.queue.length >= MAX_EXPORT_QUEUE) {
      this.queue.shift();
    }

    this.queue.push(span);
    if (this.queue.length >= env.TRACING_EXPORT_BATCH_SIZE) {
      void this.flush();
    }
  }

  private buildPayload(spans: SpanRecord[]): unknown {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: env.TRACING_SERVICE_NAME }
              },
              {
                key: "deployment.environment",
                value: { stringValue: env.NODE_ENV }
              }
            ]
          },
          scopeSpans: [
            {
              scope: {
                name: "bunrelay.observability",
                version: "0.1.0"
              },
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                kind: mapSpanKind(span.kind),
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano: span.endTimeUnixNano,
                attributes: Object.entries(span.attributes).map((entry) =>
                  attributeToOtlp(entry as [string, Primitive])
                ),
                status: {
                  code: mapStatusCode(span.status.code),
                  message: span.status.message
                }
              }))
            }
          ]
        }
      ]
    };
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.queue.splice(0, env.TRACING_EXPORT_BATCH_SIZE);
    const payload = this.buildPayload(batch);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.TRACING_EXPORT_TIMEOUT_MS);
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
          throw new Error(`trace export failed with status ${response.status}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      // Best effort export: keep app execution independent from tracing backend health.
      const rollback = batch.concat(this.queue).slice(0, MAX_EXPORT_QUEUE);
      this.queue = rollback;
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          event: "trace.export_failed",
          error: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      this.flushing = false;
    }
  }
}

const otlpExporter =
  env.TRACING_ENABLED && env.TRACING_OTLP_HTTP_URL
    ? new OtlpHttpTraceExporter(env.TRACING_OTLP_HTTP_URL, parseHeaderMap(env.TRACING_OTLP_HEADERS))
    : null;

function shouldSample(parent?: TraceParent | null): boolean {
  if (parent) {
    return parent.sampled;
  }

  const sample = new Uint32Array(1);
  crypto.getRandomValues(sample);
  return sample[0]! / 0x1_0000_0000 < env.TRACING_SAMPLING_RATIO;
}

function pickTraceParent(parentTraceparent?: string): TraceParent | null {
  if (parentTraceparent) {
    return parseTraceparent(parentTraceparent);
  }

  const ctx = currentObservabilityContext();
  if (ctx?.traceId && ctx.spanId) {
    return {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      sampled: ctx.sampled ?? true
    };
  }

  return null;
}

export function currentTraceparent(): string | undefined {
  const ctx = currentObservabilityContext();
  if (!ctx?.traceId || !ctx.spanId) {
    return undefined;
  }

  return formatTraceparent({
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    sampled: ctx.sampled ?? true
  });
}

export function tracingEnabled(): boolean {
  return env.TRACING_ENABLED;
}

export async function runInSpan<T>(options: RunSpanOptions, fn: (span: SpanHandle) => Promise<T> | T): Promise<T> {
  if (!env.TRACING_ENABLED) {
    return runWithObservabilityContextAsync(
      {
        requestId: options.requestId,
        connectionId: options.connectionId,
        userId: options.userId
      },
      async () => Promise.resolve(fn({
        traceId: "",
        spanId: "",
        parentSpanId: undefined,
        sampled: false,
        traceparent: "",
        end: () => {},
        setAttributes: () => {}
      }))
    );
  }

  const parent = pickTraceParent(options.parentTraceparent);
  const traceId = parent?.traceId ?? randomHex(TRACE_ID_BYTES);
  const parentSpanId = parent?.spanId;
  const spanId = randomHex(SPAN_ID_BYTES);
  const sampled = shouldSample(parent);
  const traceparent = formatTraceparent({ traceId, spanId, sampled });

  const record: SpanRecord = {
    name: options.name,
    traceId,
    spanId,
    parentSpanId,
    kind: options.kind ?? "internal",
    startTimeUnixNano: nowUnixNanoString(),
    endTimeUnixNano: "",
    status: { code: "unset" },
    attributes: sanitizeAttributes(options.attributes)
  };

  let finished = false;

  const handle: SpanHandle = {
    traceId,
    spanId,
    parentSpanId,
    sampled,
    traceparent,
    end: (status) => {
      if (finished) {
        return;
      }
      finished = true;
      record.endTimeUnixNano = nowUnixNanoString();
      record.status = status ?? { code: "ok" };
      if (sampled && otlpExporter) {
        otlpExporter.enqueue(record);
      }
    },
    setAttributes: (attributes) => {
      Object.assign(record.attributes, sanitizeAttributes(attributes));
    }
  };

  return runWithObservabilityContextAsync(
    {
      traceId,
      spanId,
      parentSpanId,
      sampled,
      requestId: options.requestId,
      connectionId: options.connectionId,
      userId: options.userId
    },
    async () => {
      try {
        const result = await Promise.resolve(fn(handle));
        handle.end({ code: "ok" });
        return result;
      } catch (error) {
        handle.setAttributes({
          "error.type": error instanceof Error ? error.name : "unknown",
          "error.message": error instanceof Error ? error.message : String(error)
        });
        handle.end({
          code: "error",
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  );
}

export function runWithTraceContext<T>(traceparent: string | undefined, fn: () => T): T {
  if (!traceparent || !env.TRACING_ENABLED) {
    return fn();
  }

  const parsed = parseTraceparent(traceparent);
  if (!parsed) {
    return fn();
  }

  return runWithObservabilityContext(
    {
      traceId: parsed.traceId,
      spanId: parsed.spanId,
      sampled: parsed.sampled
    },
    fn
  );
}
