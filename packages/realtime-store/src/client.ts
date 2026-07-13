import { createClient } from 'redis';

export type RedisConnection = ReturnType<typeof createClient>;

export function createRedisConnections(url: string) {
  const command = createClient({ url });
  const publisher = command.duplicate();
  const subscriber = command.duplicate();
  const connections = [command, publisher, subscriber];
  for (const connection of connections) {
    connection.on('error', () => {
      // Callers observe availability through commands/isReady; connection details stay private.
    });
  }

  const closeOpenConnections = async (): Promise<void> => {
    const results = await Promise.allSettled(
      connections.map(async (connection) => {
        if (connection.isOpen) await connection.quit();
      }),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  };

  return {
    command,
    publisher,
    subscriber,
    async connect() {
      const results = await Promise.allSettled(
        connections.map(async (connection) => connection.connect()),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) {
        try {
          await closeOpenConnections();
        } catch {
          // Preserve the connection failure; external cleanup can retry any failed close.
        }
        throw failure.reason;
      }
    },
    async close() {
      await closeOpenConnections();
    },
  };
}

export async function checkRedis(connection: Pick<RedisConnection, 'ping'>): Promise<void> {
  await connection.ping();
}
