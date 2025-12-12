import { QueueController } from './queue.controller';

describe('QueueController', () => {
  let controller: QueueController;
  const mockService = {
    getAvailableProviders: jest.fn().mockReturnValue(['memory']),
    publish: jest.fn(),
    pull: jest.fn(),
    ack: jest.fn(),
  } as any;

  beforeEach(() => {
    controller = new QueueController(mockService as any);
    jest.clearAllMocks();
    process.env.QUEUE_PROVIDER = 'memory';
  });

  it('returns providers and activeProvider', () => {
    const res = controller.providers();
    expect(res.providers).toEqual(['memory']);
    expect(res.activeProvider).toEqual('memory');
  });

  it('calls publish on the service with parsed body', () => {
    const body = { payload: { x: 1 }, ttlSeconds: 10 } as any;
    controller.publish('myqueue', 'memory', body);
    expect(mockService.publish).toHaveBeenCalledWith('memory', 'myqueue', { x: 1 }, { ttlSeconds: 10 });
  });

  it('calls pull and ack on the service', () => {
    controller.pull('myqueue', 'memory', { maxMessages: 2 } as any);
    expect(mockService.pull).toHaveBeenCalledWith('memory', 'myqueue', 2);

    controller.ack('myqueue', 'memory', { receipt: 'r' } as any);
    expect(mockService.ack).toHaveBeenCalledWith('memory', 'myqueue', 'r');
  });
});
