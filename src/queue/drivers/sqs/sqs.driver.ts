import { Logger } from '@nestjs/common';
import {
  GetQueueUrlCommand,
  CreateQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  DeleteMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  PublishOptions,
  QueueDriver,
  QueueMessage,
  MessageHandler,
  SubscriptionHandle,
  SubscribeOptions,
} from '../../queue.types';

export interface SqsDriverConfig {
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class SqsQueueDriver implements QueueDriver {
  name: QueueDriver['name'] = 'sqs';
  readonly logger = new Logger(SqsQueueDriver.name);
  private readonly client: SQSClient;
  private readonly queueUrlCache = new Map<string, string>();
  private readonly activeSubscriptions = new Map<
    string,
    { isActive: boolean; timeoutId?: NodeJS.Timeout }
  >();

  constructor(config: SqsDriverConfig = {}) {
    this.client = new SQSClient({
      region: config.region ?? 'us-east-1',
      endpoint: config.endpoint,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
          : undefined,
    });
  }

  async publish<T>(
    queue: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<QueueMessage<T>> {
    const queueUrl = await this.ensureQueue(queue);
    const cmd = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
      DelaySeconds: options?.delaySeconds,
      MessageAttributes: this.toMessageAttributes(options),
    });
    const response = await this.client.send(cmd);

    const publishedAt = new Date();
    const expiresAt =
      options?.ttlSeconds != null
        ? new Date(publishedAt.getTime() + options.ttlSeconds * 1000)
        : undefined;

    return {
      id: response.MessageId ?? '',
      receipt: response.SequenceNumber ?? response.MessageId ?? '',
      payload,
      publishedAt,
      expiresAt,
      attributes: options?.attributes,
      correlationId: options?.correlationId,
    };
  }

  async pull<T>(
    queue: string,
    maxMessages = 1,
  ): Promise<QueueMessage<T>[]> {
    const queueUrl = await this.ensureQueue(queue);
    const cmd = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: Math.min(10, Math.max(1, maxMessages)),
      MessageAttributeNames: ['All'],
      AttributeNames: ['All'],
      WaitTimeSeconds: 1,
    });

    const res = await this.client.send(cmd);
    const messages = res.Messages ?? [];

    return messages.map((msg) => {
      const raw = msg.Body ?? '';
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        this.logger.warn(`Failed to parse SQS message body as JSON; using raw string. Error: ${err}`);
      }

      const sentTimestamp = msg.Attributes?.SentTimestamp
        ? new Date(Number(msg.Attributes.SentTimestamp))
        : new Date();

      const correlationId = msg.MessageAttributes?.correlationId?.StringValue;
      const attributes = Object.entries(msg.MessageAttributes ?? {}).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (key !== 'correlationId' && value.StringValue) {
            acc[key] = value.StringValue;
          }
          return acc;
        },
        {},
      );

      return {
        id: msg.MessageId ?? '',
        receipt: msg.ReceiptHandle ?? '',
        payload: parsed as T,
        publishedAt: sentTimestamp,
        expiresAt: undefined,
        attributes,
        correlationId: correlationId ?? undefined,
      };
    });
  }

  async ack(queue: string, receipt: string): Promise<void> {
    const queueUrl = await this.ensureQueue(queue);
    if (!receipt) return;
    const cmd = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receipt,
    });
    await this.client.send(cmd);
  }

  async subscribe<T>(
    queue: string,
    handler: MessageHandler<T>,
    options: SubscribeOptions = {},
  ): Promise<SubscriptionHandle> {
    const {
      maxMessages = 1,
      pollIntervalMs = 20000, // SQS long polling default
      autoAck = false,
    } = options;

    const subscriptionKey = `${queue}-${Date.now()}`;
    const subscription: { isActive: boolean; timeoutId?: NodeJS.Timeout } = {
      isActive: true,
    };
    this.activeSubscriptions.set(subscriptionKey, subscription);

    const poll = async () => {
      if (!subscription.isActive) return;

      try {
        const messages = await this.pull<T>(queue, maxMessages);

        for (const message of messages) {
          if (!subscription.isActive) break;

          try {
            await handler(message);

            if (autoAck) {
              await this.ack(queue, message.receipt);
            }
          } catch (error) {
            this.logger.error(
              `Error processing message ${message.id} from queue "${queue}": ${error}`,
            );
            // If auto-ack is disabled and handler fails, message will become visible again after visibility timeout
            // If auto-ack is enabled, message is already deleted, so it's lost
          }
        }
      } catch (error) {
        this.logger.error(`Error polling SQS queue "${queue}": ${error}`);
      }

      if (subscription.isActive) {
        const timeoutId = setTimeout(poll, pollIntervalMs);
        subscription.timeoutId = timeoutId;
      }
    };

    // Start polling immediately
    poll();

    this.logger.log(
      `Subscribed to SQS queue "${queue}" with poll interval ${pollIntervalMs}ms`,
    );

    return {
      unsubscribe: async () => {
        subscription.isActive = false;
        if (subscription.timeoutId) {
          clearTimeout(subscription.timeoutId);
        }
        this.activeSubscriptions.delete(subscriptionKey);
        this.logger.log(`Unsubscribed from SQS queue "${queue}"`);
      },
    };
  }

  private async ensureQueue(queue: string): Promise<string> {
    if (this.queueUrlCache.has(queue)) return this.queueUrlCache.get(queue)!;
    try {
      const urlRes = await this.client.send(new GetQueueUrlCommand({ QueueName: queue }));
      if (urlRes.QueueUrl) {
        this.queueUrlCache.set(queue, urlRes.QueueUrl);
        return urlRes.QueueUrl;
      }
    } catch (err) {
      this.logger.log(`Queue "${queue}" not found, creating it. Reason: ${err}`);
    }
    const createRes = await this.client.send(new CreateQueueCommand({ QueueName: queue }));
    if (!createRes.QueueUrl) {
      throw new Error(`Unable to create or find queue "${queue}"`);
    }
    this.queueUrlCache.set(queue, createRes.QueueUrl);
    return createRes.QueueUrl;
  }

  private toMessageAttributes(options?: PublishOptions) {
    const attrs =
      options?.attributes &&
      Object.entries(options.attributes).reduce(
        (acc, [key, value]) => ({
          ...acc,
          [key]: { DataType: 'String', StringValue: value },
        }),
        {} as Record<string, { DataType: string; StringValue: string }>,
      );

    return {
      ...(attrs ?? {}),
      ...(options?.correlationId
        ? { correlationId: { DataType: 'String', StringValue: options.correlationId } }
        : {}),
    };
  }
}
