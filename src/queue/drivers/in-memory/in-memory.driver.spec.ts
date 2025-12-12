import { InMemoryQueueDriver } from './in-memory.driver';

describe('InMemoryQueueDriver', () => {
  let driver: InMemoryQueueDriver;

  beforeEach(() => {
    driver = new InMemoryQueueDriver();
    jest.useRealTimers();
  });

  it('publishes and pulls messages', async () => {
    const msg = await driver.publish('q', { a: 1 });
    expect(msg.payload).toEqual({ a: 1 });

    const pulled = await driver.pull('q');
    expect(pulled.length).toBe(1);
    expect(pulled[0].payload).toEqual({ a: 1 });
  });

  it('ack removes message', async () => {
    const m1 = await driver.publish('q', 'one');
    const m2 = await driver.publish('q', 'two');

    await driver.ack('q', m1.receipt);
    const pulled = await driver.pull('q', 10);
    expect(pulled.length).toBe(1);
    expect(pulled[0].payload).toBe('two');
  });

  it('supports delaySeconds', async () => {
    jest.useFakeTimers();
    const p = driver.publish('del', 'later', { delaySeconds: 1 });
    // Immediately pulling returns none
    const immediate = await driver.pull('del');
    expect(immediate.length).toBe(0);

    // Fast-forward timers
    jest.advanceTimersByTime(1000);
    await p; // ensure publish completion
    const after = await driver.pull('del');
    expect(after.length).toBe(1);
    jest.useRealTimers();
  });
});
