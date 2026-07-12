import { createClient } from 'redis';

export type RedisConnection = ReturnType<typeof createClient>;

export function createRedisConnections(url: string) {
  const command = createClient({ url });
  const publisher = command.duplicate();
  const subscriber = command.duplicate();
  for (const connection of [command, publisher, subscriber]) {
    connection.on('error', () => {
      // Callers observe availability through commands/isReady; connection details stay private.
    });
  }
  return {
    command,
    publisher,
    subscriber,
    async connect() {
      await Promise.all([command.connect(), publisher.connect(), subscriber.connect()]);
    },
    async close() {
      await Promise.all(
        [command, publisher, subscriber].map(async (connection) => {
          if (connection.isOpen) await connection.quit();
        }),
      );
    },
  };
}

export async function checkRedis(connection: Pick<RedisConnection, 'ping'>): Promise<void> {
  await connection.ping();
}
