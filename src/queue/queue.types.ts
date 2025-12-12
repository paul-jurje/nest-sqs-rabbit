import { Logger } from '@nestjs/common';

export type QueueProvider = 'memory' | 'sqs' | 'rabbitmq';
export const QUEUE_PROVIDERS: readonly QueueProvider[] = [
  'memory',
  'sqs',
  'rabbitmq',
];

export interface PublishOptions {
  delaySeconds?: number;
  ttlSeconds?: number;
  correlationId?: string;
  attributes?: Record<string, string>;
}

export interface QueueMessage<T> {
  id: string;
  payload: T;
  publishedAt: Date;
  expiresAt?: Date;
  receipt: string;
  attributes?: Record<string, string>;
  correlationId?: string;
}

export type MessageHandler<T> = (message: QueueMessage<T>) => Promise<void> | void;

export interface SubscriptionHandle {
  unsubscribe(): Promise<void>;
}

export interface QueueDriver {
  name: QueueProvider;
  publish<T>(
    queue: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<QueueMessage<T>>;
  pull<T>(queue: string, maxMessages?: number): Promise<QueueMessage<T>[]>;
  ack(queue: string, receipt: string): Promise<void>;
  subscribe<T>(
    queue: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<SubscriptionHandle>;
  logger?: Logger;
}

export interface SubscribeOptions {
  maxMessages?: number;
  pollIntervalMs?: number;
  autoAck?: boolean;
}

/**
 * Base interface for queue consumers.
 * All consumer implementations should extend this interface.
 */
export interface QueueConsumer<TContext = unknown> {
  /**
   * Process a message from the queue.
   * @param message The message to process
   * @param context Optional context specific to the consumer implementation
   * @returns Promise that resolves when message processing is complete
   */
  processMessage(message: QueueMessage<unknown>, context: TContext): Promise<void>;

  /**
   * Handle errors that occur during message processing.
   * @param error The error that occurred
   * @param message The message that was being processed when the error occurred
   * @param context Optional context specific to the consumer implementation
   */
  handleError(error: unknown, message: QueueMessage<unknown>, context: TContext): Promise<void> | void;
}
