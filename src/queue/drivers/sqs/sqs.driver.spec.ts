import { SqsQueueDriver } from './sqs.driver';

describe('SqsQueueDriver', () => {
  const baseClient = () =>
    ({
      send: jest.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor?.name;
        if (name === 'GetQueueUrlCommand')
          return Promise.resolve({ QueueUrl: 'http://queue' });
        if (name === 'CreateQueueCommand')
          return Promise.resolve({ QueueUrl: 'http://queue' });
        if (name === 'SendMessageCommand')
          return Promise.resolve({ MessageId: 'msg-1' });
        if (name === 'ReceiveMessageCommand')
          return Promise.resolve({ Messages: [] });
        if (name === 'DeleteMessageCommand') return Promise.resolve({});
        return Promise.resolve({});
      }),
    }) as any;

  it('publishes using internal client', async () => {
    const driver = new SqsQueueDriver({ region: 'us-east-1' });
    (driver as any).client = baseClient();

    const res = await driver.publish('q', { x: 1 });
    expect(res.id).toBe('msg-1');
    expect(res.payload).toEqual({ x: 1 });
  });

  it('pulls and parses messages', async () => {
    const payload = { a: 1 };
    const now = Date.now();
    const message = {
      MessageId: 'm1',
      ReceiptHandle: 'r1',
      Body: JSON.stringify(payload),
      Attributes: { SentTimestamp: String(now) },
      MessageAttributes: {
        correlationId: { StringValue: 'cid' },
        foo: { StringValue: 'bar' },
      },
    };

    const driver = new SqsQueueDriver({});
    (driver as any).client = {
      send: jest.fn().mockImplementation((cmd: any) => {
        const name = cmd.constructor?.name;
        if (name === 'GetQueueUrlCommand')
          return Promise.resolve({ QueueUrl: 'http://queue' });
        if (name === 'ReceiveMessageCommand')
          return Promise.resolve({ Messages: [message] });
        return Promise.resolve({});
      }),
    } as any;

    const res = await driver.pull('q', 1);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('m1');
    expect(res[0].receipt).toBe('r1');
    expect(res[0].payload).toEqual(payload);
    expect(res[0].correlationId).toBe('cid');
    expect(res[0].attributes).toMatchObject({ foo: 'bar' });
  });

  it('acks calls DeleteMessageCommand', async () => {
    const driver = new SqsQueueDriver({});
    // ensureQueue needs to return a QueueUrl when asked
    (driver as any).client = baseClient();

    await driver.ack('q', 'receipt-1');

    const sent = (driver as any).client.send as jest.Mock;
    expect(sent.mock.calls.length).toBeGreaterThan(0);
    const calledWithDelete = sent.mock.calls.some(
      (call: any[]) => call[0].constructor?.name === 'DeleteMessageCommand',
    );
    expect(calledWithDelete).toBe(true);
  });

  it('subscribe invokes handler and auto-acks', async () => {
    const payload = { hello: 'sub' };
    const message = {
      MessageId: 'm-s',
      ReceiptHandle: 'r-s',
      Body: JSON.stringify(payload),
      Attributes: { SentTimestamp: String(Date.now()) },
    };

    const sendMock = jest.fn().mockImplementation((cmd: any) => {
      const name = cmd.constructor?.name;
      if (name === 'GetQueueUrlCommand')
        return Promise.resolve({ QueueUrl: 'http://queue' });
      if (name === 'ReceiveMessageCommand')
        return Promise.resolve({ Messages: [message] });
      if (name === 'DeleteMessageCommand') return Promise.resolve({});
      return Promise.resolve({});
    });

    const driver = new SqsQueueDriver({});
    (driver as any).client = { send: sendMock } as any;

    const handlerCalled = new Promise<void>((resolve) => {
      const handler = async () => resolve();
      driver
        .subscribe('q', handler as any, { autoAck: true })
        .then(async (sub) => {
          // wait for handler to be invoked
          await handlerCalled.catch(() => {});
          await sub.unsubscribe();
        });
    });

    await handlerCalled;
    // give a short moment for the ack/delete to be invoked
    await new Promise((r) => setTimeout(r, 20));

    const deleted = sendMock.mock.calls.some(
      (call: any[]) => call[0].constructor?.name === 'DeleteMessageCommand',
    );
    expect(deleted).toBe(true);
  });
});
