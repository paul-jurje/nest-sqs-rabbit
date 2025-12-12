import { Logger } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { QueueMessage, MessageHandler, QueueConsumer } from '../../queue.types';

/**
 * Context for RabbitMQ consumer operations.
 */
export interface RabbitMqConsumerContext {
  channel: Channel;
  queue: string;
  autoAck: boolean;
}

/**
 * RabbitMQ consumer implementation.
 * Handles message consumption, parsing, and processing for RabbitMQ queues.
 */
export class RabbitMqConsumer implements QueueConsumer<RabbitMqConsumerContext> {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(RabbitMqConsumer.name);
  }

  /**
   * Creates a consumer function that can be used with RabbitMQ's channel.consume().
   * @param handler The message handler to invoke for each message
   * @param context The RabbitMQ consumer context
   * @returns A consumer function compatible with amqplib
   */
  createConsumer<T>(
    handler: MessageHandler<T>,
    context: RabbitMqConsumerContext,
  ): (msg: ConsumeMessage | null) => Promise<void> {
    return async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      const message = this.parseMessage<T>(msg);

      try {
        await handler(message);
        if (context.autoAck) {
          context.channel.ack(msg, false);
        }
      } catch (error) {
        this.handleErrorWithMessage(error, message, msg, context);
      }
    };
  }

  /**
   * Process a message from RabbitMQ.
   * This method is called by the consumer function to handle message processing.
   */
  async processMessage(
    message: QueueMessage<unknown>,
    context: RabbitMqConsumerContext,
  ): Promise<void> {
    // Message processing is handled by the handler in createConsumer
    // This method exists to satisfy the QueueConsumer interface
    // and can be extended for additional processing logic
  }

  /**
   * Handle errors that occur during message processing.
   */
  handleError(
    error: unknown,
    message: QueueMessage<unknown>,
    context: RabbitMqConsumerContext,
  ): void {
    this.logger.error(
      `Error processing message ${message.id} from queue "${context.queue}": ${error}`,
    );

    if (context.autoAck) {
      // If auto-ack is enabled and handler fails, message is lost
      // We can't ack here because we don't have the original msg object
      // This is handled in createConsumer where we have access to the msg
    } else {
      // Error handling for manual ack is done in createConsumer
      // where we have access to the original ConsumeMessage
    }
  }

  /**
   * Handle errors with access to the original ConsumeMessage.
   * This is used internally by createConsumer.
   */
  handleErrorWithMessage(
    error: unknown,
    message: QueueMessage<unknown>,
    msg: ConsumeMessage,
    context: RabbitMqConsumerContext,
  ): void {
    this.logger.error(
      `Error processing message ${message.id} from queue "${context.queue}": ${error}`,
    );

    if (context.autoAck) {
      // If auto-ack is enabled and handler fails, message is lost
      context.channel.ack(msg, false);
    } else {
      // Reject and requeue the message
      context.channel.nack(msg, false, true);
    }
  }

  /**
   * Parse a RabbitMQ ConsumeMessage into a QueueMessage.
   */
  private parseMessage<T>(msg: ConsumeMessage): QueueMessage<T> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.content.toString());
    } catch (err) {
      this.logger.warn(
        `Failed to parse RabbitMQ message body as JSON; using raw string. Error: ${err}`,
      );
      parsed = msg.content.toString();
    }

    const properties = msg.properties;
    const correlationId = properties.correlationId || properties.messageId;
    const attributes = properties.headers
      ? Object.entries(properties.headers).reduce<Record<string, string>>(
          (acc, [key, value]) => {
            if (key !== 'correlationId' && typeof value === 'string') {
              acc[key] = value;
            }
            return acc;
          },
          {},
        )
      : undefined;

    const timestamp = properties.timestamp
      ? new Date(properties.timestamp * 1000)
      : new Date();

    return {
      id: properties.messageId || `${Date.now()}`,
      receipt: msg.fields.deliveryTag.toString(),
      payload: parsed as T,
      publishedAt: timestamp,
      expiresAt: undefined,
      attributes,
      correlationId,
    };
  }
}

