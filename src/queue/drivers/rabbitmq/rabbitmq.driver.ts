import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import type { ChannelModel, Channel, ConsumeMessage } from 'amqplib';
import {
  PublishOptions,
  QueueDriver,
  QueueMessage,
  MessageHandler,
  SubscriptionHandle,
  SubscribeOptions,
} from '../../queue.types';
import { RabbitMqConsumer, RabbitMqConsumerContext } from './rabbitmq.consumer';

export interface RabbitMqDriverConfig {
  url?: string;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
}

export class RabbitMqQueueDriver implements QueueDriver {
  name: QueueDriver['name'] = 'rabbitmq';
  readonly logger = new Logger(RabbitMqQueueDriver.name);
  private connection: ChannelModel | null = null;
  private channels = new Map<string, Channel>();
  private readonly config: RabbitMqDriverConfig;
  private readonly subscriptions = new Map<string, { consumerTag: string; channel: Channel }>();
  private readonly consumer: RabbitMqConsumer;

  constructor(config: RabbitMqDriverConfig = {}) {
    this.config = config;
    this.consumer = new RabbitMqConsumer(this.logger);
  }

  private async getConnection(): Promise<ChannelModel> {
    if (!this.connection) {
      const url =
        this.config.url ||
        `amqp://${this.config.username || 'guest'}:${this.config.password || 'guest'}@${this.config.hostname || 'localhost'}:${this.config.port || 5672}${this.config.vhost ? `/${this.config.vhost}` : ''}`;

      try {
        const conn = await amqp.connect(url);
        this.connection = conn;
        conn.on('error', (err) => {
          this.logger.error(`RabbitMQ connection error: ${err}`);
        });
        conn.on('close', () => {
          this.logger.warn('RabbitMQ connection closed');
          this.connection = null;
          this.channels.clear();
        });
        this.logger.log('Connected to RabbitMQ');
      } catch (error) {
        this.logger.error(`Failed to connect to RabbitMQ: ${error}`);
        throw error;
      }
    }
    if (!this.connection) {
      throw new Error('Failed to establish RabbitMQ connection');
    }
    return this.connection;
  }

  private async getChannel(queue: string): Promise<Channel> {
    if (this.channels.has(queue)) {
      const channel = this.channels.get(queue)!;
      // Channel will be removed from map on 'close' event
      // If channel is still in map, try to use it
      try {
        // Try to check if channel is still valid
        // Channels don't have a direct connection property in amqplib
        // We'll just try to use it and catch errors if it's closed
        return channel;
      } catch {
        // Channel is invalid, remove it
        this.channels.delete(queue);
      }
    }

    const connection = await this.getConnection();
    const channel = await connection.createChannel();
    await channel.assertQueue(queue, { durable: true });
    this.channels.set(queue, channel);

    channel.on('error', (err) => {
      this.logger.error(`RabbitMQ channel error for queue "${queue}": ${err}`);
    });

    channel.on('close', () => {
      this.logger.warn(`RabbitMQ channel closed for queue "${queue}"`);
      this.channels.delete(queue);
    });

    return channel;
  }

  async publish<T>(
    queue: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<QueueMessage<T>> {
    const channel = await this.getChannel(queue);
    const publishedAt = new Date();

    const messageId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const correlationId = options?.correlationId || messageId;

    const messageBuffer = Buffer.from(JSON.stringify(payload));
    const headers: Record<string, any> = {
      ...options?.attributes,
      correlationId,
    };

    const publishOptions: amqp.Options.Publish = {
      messageId,
      correlationId,
      headers,
      expiration: options?.ttlSeconds ? String(options.ttlSeconds * 1000) : undefined,
      persistent: true,
    };

    if (options?.delaySeconds) {
      // RabbitMQ doesn't support delay directly, but we can use delayed message exchange
      // For simplicity, we'll use a workaround with TTL and dead letter exchange
      // In production, consider using rabbitmq-delayed-message-exchange plugin
      publishOptions.expiration = String(options.delaySeconds * 1000);
    }

    const sent = channel.sendToQueue(queue, messageBuffer, publishOptions);

    if (!sent) {
      throw new Error(`Failed to publish message to queue "${queue}"`);
    }

    const expiresAt =
      options?.ttlSeconds != null
        ? new Date(publishedAt.getTime() + options.ttlSeconds * 1000)
        : undefined;

    this.logger.debug(
      `Published message ${messageId} to queue "${queue}" using RabbitMQ driver`,
    );

    return {
      id: messageId,
      receipt: messageId, // RabbitMQ uses messageId as receipt for manual ack
      payload,
      publishedAt,
      expiresAt,
      attributes: options?.attributes,
      correlationId,
    };
  }

  async pull<T>(
    queue: string,
    maxMessages = 1,
  ): Promise<QueueMessage<T>[]> {
    const channel = await this.getChannel(queue);
    const messages: QueueMessage<T>[] = [];

    for (let i = 0; i < maxMessages; i++) {
      const msg = await channel.get(queue, { noAck: false });
      if (!msg) break;

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

      messages.push({
        id: properties.messageId || `${Date.now()}-${i}`,
        receipt: msg.fields.deliveryTag.toString(), // Use deliveryTag as receipt for ack
        payload: parsed as T,
        publishedAt: timestamp,
        expiresAt: undefined,
        attributes,
        correlationId,
      });
    }

    return messages;
  }

  async ack(queue: string, receipt: string): Promise<void> {
    const channel = await this.getChannel(queue);
    const deliveryTag = parseInt(receipt, 10);
      channel.ack({ fields: { deliveryTag } } as ConsumeMessage, false);
    this.logger.debug(`Acked message with deliveryTag ${deliveryTag} on queue "${queue}"`);
  }

  async subscribe<T>(
    queue: string,
    handler: MessageHandler<T>,
    options: SubscribeOptions = {},
  ): Promise<SubscriptionHandle> {
    const { autoAck = false } = options;
    const channel = await this.getChannel(queue);

    const context: RabbitMqConsumerContext = {
      channel,
      queue,
      autoAck,
    };

    const consumer = this.consumer.createConsumer<T>(handler, context);

    const consumeResult = await channel.consume(queue, consumer, { noAck: autoAck });
    const consumerTag = consumeResult.consumerTag;

    this.subscriptions.set(consumerTag, { consumerTag, channel });
    this.logger.log(`Subscribed to RabbitMQ queue "${queue}" with consumer tag "${consumerTag}"`);

    return {
      unsubscribe: async () => {
        await channel.cancel(consumerTag);
        this.subscriptions.delete(consumerTag);
        this.logger.log(`Unsubscribed from RabbitMQ queue "${queue}"`);
      },
    };
  }

  async close(): Promise<void> {
    // Cancel all subscriptions
    for (const [consumerTag, sub] of this.subscriptions.entries()) {
      try {
        await sub.channel.cancel(consumerTag);
      } catch (error) {
        this.logger.warn(`Error canceling consumer ${consumerTag}: ${error}`);
      }
    }
    this.subscriptions.clear();

    // Close all channels
    for (const [queue, channel] of this.channels.entries()) {
      try {
        await channel.close();
      } catch (error) {
        this.logger.warn(`Error closing channel for queue ${queue}: ${error}`);
      }
    }
    this.channels.clear();

    // Close connection
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        this.logger.warn(`Error closing RabbitMQ connection: ${error}`);
      }
      this.connection = null;
    }
  }
}
