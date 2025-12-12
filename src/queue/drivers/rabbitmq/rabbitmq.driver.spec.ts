import type { Channel, ConsumeMessage } from 'amqplib';
import { RabbitMqQueueDriver } from './rabbitmq.driver';

describe('RabbitMqQueueDriver', () => {
  it('publishes using mocked channel', async () => {
    const driver = new RabbitMqQueueDriver({});

    const channelMock: Partial<Channel> & { sendToQueue?: jest.Mock } = {
      sendToQueue: jest.fn().mockReturnValue(true),
    };

    (driver as unknown as { getChannel?: () => Promise<Channel> }).getChannel =
      jest.fn().mockResolvedValue(channelMock as Channel);

    const res = await driver.publish('q', { hello: 'world' });
    expect(res.payload).toEqual({ hello: 'world' });
    expect(typeof res.id).toBe('string');
    expect(channelMock.sendToQueue).toHaveBeenCalled();
  });

  it('pulls messages from channel.get', async () => {
    const driver = new RabbitMqQueueDriver({});

    const payload = { a: 1 };
    const msg = {
      content: Buffer.from(JSON.stringify(payload)),
      properties: {
        messageId: 'mid',
        timestamp: Math.floor(Date.now() / 1000),
      },
      fields: { deliveryTag: 42 },
    } as unknown as ConsumeMessage;

    const channelMock: Partial<Channel> & { get?: jest.Mock } = {
      get: jest.fn().mockResolvedValue(msg),
    };

    (driver as unknown as { getChannel?: () => Promise<Channel> }).getChannel =
      jest.fn().mockResolvedValue(channelMock as Channel);

    const res = await driver.pull('q', 1);
    expect((channelMock.get as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect(res.length).toBe(1);
    expect(res[0].payload).toEqual(payload);
    expect(res[0].receipt).toBe('42');
  });

  it('acks messages by delivery tag', async () => {
    const driver = new RabbitMqQueueDriver({});

    const ackSpy = jest.fn();
    const channelMock: Partial<Channel> & { ack?: jest.Mock } = {
      ack: ackSpy,
    };

    (driver as unknown as { getChannel?: () => Promise<Channel> }).getChannel =
      jest.fn().mockResolvedValue(channelMock as Channel);

    await driver.ack('q', '123');

    expect(
      (driver as unknown as { getChannel?: jest.Mock }).getChannel,
    ).toHaveBeenCalledWith('q');
    expect(ackSpy).toHaveBeenCalled();
  });

  it('subscribes and unsubscribes via channel.consume/cancel', async () => {
    const driver = new RabbitMqQueueDriver({});

    const payload = { hi: 'there' };
    const mockMsg = {
      content: Buffer.from(JSON.stringify(payload)),
      properties: { messageId: 'm1', timestamp: Math.floor(Date.now() / 1000) },
      fields: { deliveryTag: 7 },
    } as unknown as ConsumeMessage;

    const consumeMock = jest
      .fn()
      .mockImplementation(
        async (
          _queue: string,
          consumer: (msg: ConsumeMessage | null) => Promise<void>,
        ) => {
          await consumer(mockMsg);
          return { consumerTag: 'ctag' } as any;
        },
      );

    const cancelMock = jest.fn().mockResolvedValue(undefined);

    const channelMock: Partial<Channel> & {
      consume?: jest.Mock;
      cancel?: jest.Mock;
    } = {
      consume: consumeMock,
      cancel: cancelMock,
      ack: jest.fn(),
      nack: jest.fn(),
    };

    (driver as unknown as { getChannel?: () => Promise<Channel> }).getChannel =
      jest.fn().mockResolvedValue(channelMock as Channel);

    const handler = jest.fn().mockResolvedValue(undefined);

    const sub = await driver.subscribe('q', handler as any, { autoAck: false });

    expect(consumeMock).toHaveBeenCalled();
    expect(handler).toHaveBeenCalled();

    await sub.unsubscribe();
    expect(cancelMock).toHaveBeenCalledWith('ctag');
  });
});
