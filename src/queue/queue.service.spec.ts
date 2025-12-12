import { BadRequestException } from '@nestjs/common';
import { QueueService } from './queue.service';

describe('QueueService', () => {
  let service: QueueService;
  const mockDriver = {
    publish: jest.fn(),
    pull: jest.fn(),
    ack: jest.fn(),
    subscribe: jest.fn(),
    name: 'memory',
  } as any;

  beforeEach(() => {
    const drivers = new Map([['memory', mockDriver]]);
    service = new QueueService(drivers as any);
    jest.clearAllMocks();
  });

  it('returns available providers', () => {
    expect(service.getAvailableProviders()).toEqual(['memory']);
  });

  it('delegates publish to driver', async () => {
    const expected = { id: '1', payload: { a: 1 } };
    mockDriver.publish.mockResolvedValue(expected);
    await expect(service.publish('memory' as any, 'q', { a: 1 })).resolves.toEqual(expected);
    expect(mockDriver.publish).toHaveBeenCalledWith('q', { a: 1 }, undefined);
  });

  it('delegates pull/ack/subscribe to driver', async () => {
    const pulled = [{ id: '1', payload: 'x' }];
    mockDriver.pull.mockResolvedValue(pulled);
    await expect(service.pull('memory' as any, 'q', 2)).resolves.toEqual(pulled);
    expect(mockDriver.pull).toHaveBeenCalledWith('q', 2);

    mockDriver.ack.mockResolvedValue(undefined);
    await expect(service.ack('memory' as any, 'q', 'r')).resolves.toBeUndefined();
    expect(mockDriver.ack).toHaveBeenCalledWith('q', 'r');

    const handle = { unsubscribe: jest.fn() };
    mockDriver.subscribe.mockResolvedValue(handle);
    await expect(service.subscribe('memory' as any, 'q', async () => {})).resolves.toEqual(handle);
    expect(mockDriver.subscribe).toHaveBeenCalled();
  });

  it('throws on unknown provider', () => {
    expect(() => service.publish('bad' as any, 'q', {})).toThrow(BadRequestException);
  });
});
