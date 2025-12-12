import { DynamicModule, Module, Provider } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QUEUE_DRIVERS } from './queue.constants';
import { QueueDriver, QueueProvider } from './queue.types';
import { InMemoryQueueDriver } from './drivers/in-memory/in-memory.driver';
import { SqsQueueDriver, SqsDriverConfig } from './drivers/sqs/sqs.driver';
import { RabbitMqQueueDriver, RabbitMqDriverConfig } from './drivers/rabbitmq/rabbitmq.driver';

function createSqsDriver(): SqsQueueDriver {
  const config: SqsDriverConfig = {
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.QUEUE_SQS_ENDPOINT,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
  return new SqsQueueDriver(config);
}

function createRabbitMqDriver(): RabbitMqQueueDriver {
  const config: RabbitMqDriverConfig = {
    url: process.env.QUEUE_RABBITMQ_URL,
    hostname: process.env.QUEUE_RABBITMQ_HOSTNAME,
    port: process.env.QUEUE_RABBITMQ_PORT
      ? parseInt(process.env.QUEUE_RABBITMQ_PORT, 10)
      : undefined,
    username: process.env.QUEUE_RABBITMQ_USERNAME,
    password: process.env.QUEUE_RABBITMQ_PASSWORD,
    vhost: process.env.QUEUE_RABBITMQ_VHOST,
  };
  return new RabbitMqQueueDriver(config);
}

function createInMemoryDriver(): InMemoryQueueDriver {
  return new InMemoryQueueDriver();
}

const queueDriversProvider: Provider = {
  provide: QUEUE_DRIVERS,
  useFactory: (): Map<QueueProvider, QueueDriver> => {
    const drivers = new Map<QueueProvider, QueueDriver>();
    
    // Always create both SQS and RabbitMQ drivers
    drivers.set('sqs', createSqsDriver());
    drivers.set('rabbitmq', createRabbitMqDriver());
    
    // Also create in-memory driver for fallback/testing
    drivers.set('memory', createInMemoryDriver());
    
    return drivers;
  },
};

@Module({})
export class QueueModule {
  static register(): DynamicModule {
    return {
      module: QueueModule,
      providers: [queueDriversProvider, QueueService],
      exports: [QueueService],
    };
  }
}
