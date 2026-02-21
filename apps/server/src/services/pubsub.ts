import { logger } from "../config/logger.ts";

export type PubSubMessage = {
  type: string;
  data: unknown;
  roomId?: string;
  sourceNodeId: string;
  excludeConnectionId?: string;
};

type MessageHandler = (message: PubSubMessage) => void;

const nodeId = crypto.randomUUID();

let redisPublisher: any = null;
let redisSubscriber: any = null;
let enabled = false;
const handlers = new Map<string, MessageHandler>();

function redactCredentialsInUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.username && !parsed.password) {
      return rawUrl;
    }

    parsed.username = "***";
    parsed.password = parsed.password ? "***" : "";
    return parsed.toString();
  } catch {
    const schemeIdx = rawUrl.indexOf("://");
    const atIdx = rawUrl.lastIndexOf("@");
    if (schemeIdx < 0 || atIdx < 0 || atIdx <= schemeIdx + 3) {
      return rawUrl;
    }

    return `${rawUrl.slice(0, schemeIdx + 3)}***@${rawUrl.slice(atIdx + 1)}`;
  }
}

export function getNodeId(): string {
  return nodeId;
}

export function isPubSubEnabled(): boolean {
  return enabled;
}

export async function initPubSub(redisUrl?: string): Promise<void> {
  if (!redisUrl) {
    logger.info("pubsub.local_only", { nodeId });
    return;
  }

  try {
    // @ts-ignore - redis is an optional dependency
    const { createClient } = await import("redis");

    redisPublisher = createClient({ url: redisUrl });
    redisSubscriber = createClient({ url: redisUrl });

    redisPublisher.on("error", (err: Error) => {
      logger.error("pubsub.publisher_error", { error: err.message });
    });
    redisSubscriber.on("error", (err: Error) => {
      logger.error("pubsub.subscriber_error", { error: err.message });
    });

    await redisPublisher.connect();
    await redisSubscriber.connect();

    enabled = true;
    logger.info("pubsub.redis_connected", { nodeId, redisUrl: redactCredentialsInUrl(redisUrl) });
  } catch (error) {
    logger.error("pubsub.init_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    // Fall back to local-only
    enabled = false;
  }
}

export async function publish(channel: string, message: Omit<PubSubMessage, "sourceNodeId">): Promise<void> {
  if (!enabled || !redisPublisher) {
    return;
  }

  const fullMessage: PubSubMessage = {
    ...message,
    sourceNodeId: nodeId
  };

  try {
    await redisPublisher.publish(channel, JSON.stringify(fullMessage));
  } catch (error) {
    logger.error("pubsub.publish_error", {
      channel,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function subscribe(channel: string, handler: MessageHandler): Promise<void> {
  handlers.set(channel, handler);

  if (!enabled || !redisSubscriber) {
    return;
  }

  try {
    await redisSubscriber.subscribe(channel, (rawMessage: string) => {
      try {
        const message: PubSubMessage = JSON.parse(rawMessage);
        if (message.sourceNodeId === nodeId) {
          return; // Skip messages from this node
        }
        handler(message);
      } catch (error) {
        logger.error("pubsub.handler_error", {
          channel,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  } catch (error) {
    logger.error("pubsub.subscribe_error", {
      channel,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function subscribePattern(pattern: string, handler: MessageHandler): Promise<void> {
  if (!enabled || !redisSubscriber) {
    return;
  }

  try {
    await redisSubscriber.pSubscribe(pattern, (rawMessage: string) => {
      try {
        const message: PubSubMessage = JSON.parse(rawMessage);
        if (message.sourceNodeId === nodeId) {
          return;
        }
        handler(message);
      } catch (error) {
        logger.error("pubsub.handler_error", {
          pattern,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  } catch (error) {
    logger.error("pubsub.subscribe_pattern_error", {
      pattern,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function shutdownPubSub(): Promise<void> {
  try {
    if (redisSubscriber) {
      await redisSubscriber.quit();
    }
    if (redisPublisher) {
      await redisPublisher.quit();
    }
  } catch (error) {
    logger.error("pubsub.shutdown_error", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  enabled = false;
  handlers.clear();
}
