import { AsyncLocalStorage } from "node:async_hooks";

export type ObservabilityContext = {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  sampled?: boolean;
  connectionId?: string;
  userId?: string;
};

const storage = new AsyncLocalStorage<ObservabilityContext>();

function mergeContext(base: ObservabilityContext, patch: ObservabilityContext): ObservabilityContext {
  const next: ObservabilityContext = { ...base };
  for (const [key, value] of Object.entries(patch) as Array<[keyof ObservabilityContext, string | boolean | undefined]>) {
    if (value !== undefined) {
      next[key] = value as any;
    }
  }
  return next;
}

export function currentObservabilityContext(): ObservabilityContext | undefined {
  return storage.getStore();
}

export function runWithObservabilityContext<T>(patch: ObservabilityContext, fn: () => T): T {
  const current = storage.getStore() ?? {};
  return storage.run(mergeContext(current, patch), fn);
}

export async function runWithObservabilityContextAsync<T>(
  patch: ObservabilityContext,
  fn: () => Promise<T>
): Promise<T> {
  const current = storage.getStore() ?? {};
  return storage.run(mergeContext(current, patch), fn);
}

export function mutateObservabilityContext(patch: Partial<ObservabilityContext>): void {
  const current = storage.getStore();
  if (!current) {
    return;
  }

  for (const [key, value] of Object.entries(patch) as Array<[keyof ObservabilityContext, string | boolean | undefined]>) {
    if (value !== undefined) {
      current[key] = value as any;
    }
  }
}
