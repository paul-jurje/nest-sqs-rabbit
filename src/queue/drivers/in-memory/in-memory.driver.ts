import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PublishOptions,
  QueueDriver,
  QueueMessage,
  MessageHandler,
  SubscriptionHandle,
  SubscribeOptions,
} from '../../queue.types';

interface StoredMessage<T> extends QueueMessage<T> {
  queue: string;
}

export class InMemoryQueueDriver implements QueueDriver {
  name: QueueDriver['name'] = 'memory';
  readonly logger = new Logger(InMemoryQueueDriver.name);
  private readonly queues = new Map<string, StoredMessage<unknown>[]>();
  private readonly subscriptions = new Map<string, NodeJS.Timeout[]>();

  async publish<T>(
    queue: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<QueueMessage<T>> {
    const publishedAt = new Date();
    const message: StoredMessage<T> = {
      id: randomUUID(),
      receipt: randomUUID(),
      payload,
      publishedAt,
      expiresAt: options?.ttlSeconds
        ? new Date(publishedAt.getTime() + options.ttlSeconds * 1000)
        : undefined,
      attributes: options?.attributes,
      correlationId: options?.correlationId,
      queue,
    };

    if (options?.delaySeconds) {
      setTimeout(() => this.push(queue, message), options.delaySeconds * 1000);
    } else {
      this.push(queue, message);
    }

    this.logger.debug(
      `Published message ${message.id} to queue "${queue}" using in-memory driver`,
    );
    return message;
  }

  async pull<T>(
    queue: string,
    maxMessages = 1,
  ): Promise<QueueMessage<T>[]> {
    const stored = (this.queues.get(queue) ?? []) as StoredMessage<T>[];
    const now = Date.now();

    const [valid, expired] = stored.reduce<[StoredMessage<T>[], StoredMessage<T>[]]>(
      (acc, msg) => {
        if (msg.expiresAt && msg.expiresAt.getTime() <= now) {
          acc[1].push(msg);
        } else {
          acc[0].push(msg);
        }
        return acc;
      },
      [[], []],
    );

    if (expired.length) {
      this.logger.debug(
        `Dropped ${expired.length} expired messages from queue "${queue}"`,
      );
    }

    const messages = valid.splice(0, maxMessages);
    this.queues.set(queue, valid);
    return messages;
  }

  async ack(queue: string, receipt: string): Promise<void> {
    const stored = this.queues.get(queue) ?? [];
    const remaining = stored.filter((msg) => msg.receipt !== receipt);
    this.queues.set(queue, remaining);
    this.logger.debug(`Acked receipt ${receipt} on queue "${queue}"`);
  }

  async subscribe<T>(
    queue: string,
    handler: MessageHandler<T>,
    options: SubscribeOptions = {},
  ): Promise<SubscriptionHandle> {
    const {
      maxMessages = 1,
      pollIntervalMs = 1000,
      autoAck = false,
    } = options;

    let isActive = true;

    const poll = async () => {
      if (!isActive) return;

      try {
        const messages = await this.pull<T>(queue, maxMessages);
        
        for (const message of messages) {
          if (!isActive) break;
          
          try {
            await handler(message);
            
            if (autoAck) {
              await this.ack(queue, message.receipt);
            }
          } catch (error) {
            this.logger.error(
              `Error processing message ${message.id} from queue "${queue}": ${error}`,
            );
            // If auto-ack is disabled and handler fails, message remains in queue
            // If auto-ack is enabled, message is already acked, so it's lost
            if (!autoAck) {
              // Re-queue the message for retry
              const stored = (this.queues.get(queue) ?? []) as StoredMessage<T>[];
              stored.unshift(message as StoredMessage<T>);
              this.queues.set(queue, stored);
            }
          }
        }
      } catch (error) {
        this.logger.error(`Error polling queue "${queue}": ${error}`);
      }

      if (isActive) {
        const timeoutId = setTimeout(poll, pollIntervalMs);
        const existing = this.subscriptions.get(queue) ?? [];
        existing.push(timeoutId);
        this.subscriptions.set(queue, existing);
      }
    };

    // Start polling immediately
    poll();

    this.logger.log(`Subscribed to queue "${queue}" with poll interval ${pollIntervalMs}ms`);

    return {
      unsubscribe: async () => {
        isActive = false;
        const timeouts = this.subscriptions.get(queue) ?? [];
        timeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.subscriptions.set(queue, []);
        this.logger.log(`Unsubscribed from queue "${queue}"`);
      },
    };
  }

  private push<T>(queue: string, message: StoredMessage<T>) {
    const current = (this.queues.get(queue) ?? []) as StoredMessage<T>[];
    current.push(message);
    this.queues.set(queue, current);
  }
}
