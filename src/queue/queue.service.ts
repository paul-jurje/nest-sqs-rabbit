import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { QUEUE_DRIVERS } from './queue.constants';
import type {
  PublishOptions,
  QueueDriver,
  QueueMessage,
  MessageHandler,
  SubscriptionHandle,
  SubscribeOptions,
  QueueProvider,
} from './queue.types';

@Injectable()
export class QueueService {
  constructor(
    @Inject(QUEUE_DRIVERS)
    private readonly drivers: Map<QueueProvider, QueueDriver>,
  ) { }

  private getDriver(provider: QueueProvider): QueueDriver {
    const driver = this.drivers.get(provider);
    if (!driver) {
      throw new BadRequestException(
        `Invalid queue provider: ${provider}. Available providers: ${Array.from(this.drivers.keys()).join(', ')}`,
      );
    }
    return driver;
  }

  publish<T>(
    provider: QueueProvider,
    queue: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<QueueMessage<T>> {
    const driver = this.getDriver(provider);
    return driver.publish(queue, payload, options);
  }

  pull<T>(
    provider: QueueProvider,
    queue: string,
    maxMessages?: number,
  ): Promise<QueueMessage<T>[]> {
    const driver = this.getDriver(provider);
    return driver.pull(queue, maxMessages);
  }

  ack(
    provider: QueueProvider,
    queue: string,
    receipt: string,
  ): Promise<void> {
    const driver = this.getDriver(provider);
    return driver.ack(queue, receipt);
  }

  subscribe<T>(
    provider: QueueProvider,
    queue: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<SubscriptionHandle> {
    const driver = this.getDriver(provider);
    return driver.subscribe(queue, handler, options);
  }

  getAvailableProviders(): QueueProvider[] {
    return Array.from(this.drivers.keys());
  }
}
