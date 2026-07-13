import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('redis', () => redisMock);

import { createRedisConnections } from './client';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeClient(connectResult: Promise<void>) {
  const client = {
    isOpen: false,
    connect: vi.fn(async () => {
      await connectResult;
      client.isOpen = true;
    }),
    quit: vi.fn(async () => {
      client.isOpen = false;
    }),
    on: vi.fn(),
    duplicate: vi.fn(),
  };
  return client;
}

describe('createRedisConnections', () => {
  beforeEach(() => {
    redisMock.createClient.mockReset();
  });

  it('waits for every connection to settle and closes successful peers before rejecting', async () => {
    const commandConnect = deferred<void>();
    const publisherConnect = deferred<void>();
    const subscriberConnect = deferred<void>();
    const command = fakeClient(commandConnect.promise);
    const publisher = fakeClient(publisherConnect.promise);
    const subscriber = fakeClient(subscriberConnect.promise);
    command.duplicate.mockReturnValueOnce(publisher).mockReturnValueOnce(subscriber);
    redisMock.createClient.mockReturnValue(command);
    const connections = createRedisConnections('redis://cache');

    let outcome: 'pending' | 'resolved' | Error = 'pending';
    const connecting = connections.connect().then(
      () => {
        outcome = 'resolved';
      },
      (error: Error) => {
        outcome = error;
      },
    );

    const commandFailure = new Error('command connection failed');
    commandConnect.reject(commandFailure);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcome).toBe('pending');
    expect(publisher.quit).not.toHaveBeenCalled();
    expect(subscriber.quit).not.toHaveBeenCalled();

    publisherConnect.resolve();
    await Promise.resolve();
    expect(outcome).toBe('pending');

    subscriberConnect.resolve();
    await connecting;
    expect(outcome).toBe(commandFailure);
    expect(command.quit).not.toHaveBeenCalled();
    expect(publisher.quit).toHaveBeenCalledOnce();
    expect(subscriber.quit).toHaveBeenCalledOnce();

    await connections.close();
    expect(publisher.quit).toHaveBeenCalledOnce();
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });
});
