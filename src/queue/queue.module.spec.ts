import { Test, TestingModule } from '@nestjs/testing';
import { QueueModule } from './queue.module';
import { QUEUE_DRIVERS } from './queue.constants';
import { InMemoryQueueDriver } from './drivers/in-memory/in-memory.driver';
import { SqsQueueDriver } from './drivers/sqs/sqs.driver';
import { RabbitMqQueueDriver } from './drivers/rabbitmq/rabbitmq.driver';
import { QueueService } from './queue.service';

describe('QueueModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [QueueModule.register()],
    }).compile();
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
  });

  it('compiles and provides QueueService', () => {
    const svc = moduleRef.get<QueueService>(QueueService);
    expect(svc).toBeDefined();
  });

  it('provides QUEUE_DRIVERS map with drivers', () => {
    const drivers = moduleRef.get<Map<string, any>>(QUEUE_DRIVERS as any);
    expect(drivers).toBeInstanceOf(Map);
    expect(drivers.has('sqs')).toBe(true);
    expect(drivers.has('rabbitmq')).toBe(true);
    expect(drivers.has('memory')).toBe(true);

    const mem = drivers.get('memory');
    const sqs = drivers.get('sqs');
    const rmq = drivers.get('rabbitmq');

    expect(mem).toBeInstanceOf(InMemoryQueueDriver);
    expect(sqs).toBeInstanceOf(SqsQueueDriver);
    expect(rmq).toBeInstanceOf(RabbitMqQueueDriver);
  });
});
