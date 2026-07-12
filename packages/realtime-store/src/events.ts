import { realtimeServerMessageSchema, type RealtimeServerMessage } from '@hangban/contracts';

import type { RedisConnection } from './client';

export type RealtimeChangeEvent = Extract<
  RealtimeServerMessage,
  { type: 'flight.upsert' | 'flight.remove' | 'source.status' }
>;

const isChangeEvent = (event: RealtimeServerMessage): event is RealtimeChangeEvent =>
  event.type === 'flight.upsert' ||
  event.type === 'flight.remove' ||
  event.type === 'source.status';

export async function publishChanges(
  publisher: Pick<RedisConnection, 'publish'>,
  prefix: string,
  events: readonly unknown[],
): Promise<void> {
  for (const candidate of events) {
    const event = realtimeServerMessageSchema.parse(candidate);
    if (!isChangeEvent(event)) throw new Error('INVALID_REALTIME_EVENT');
    await publisher.publish(`${prefix}:changes`, JSON.stringify(event));
  }
}

export async function subscribeChanges(
  subscriber: Pick<RedisConnection, 'subscribe' | 'unsubscribe'>,
  {
    prefix,
    onEvent,
    onInvalid = () => undefined,
  }: {
    prefix: string;
    onEvent: (event: RealtimeChangeEvent) => void | Promise<void>;
    onInvalid?: (code: 'INVALID_REALTIME_EVENT') => void;
  },
): Promise<() => Promise<void>> {
  const channel = `${prefix}:changes`;
  await subscriber.subscribe(channel, async (message) => {
    try {
      const event = realtimeServerMessageSchema.parse(JSON.parse(message));
      if (!isChangeEvent(event)) throw new Error();
      await onEvent(event);
    } catch {
      onInvalid('INVALID_REALTIME_EVENT');
    }
  });
  return async () => subscriber.unsubscribe(channel);
}
