import { afterEach, describe, expect, it } from 'vitest';

import {
  realtimeServerMessageSchema,
  sourceStatusSchema,
  type RealtimeServerMessage,
  type SourceStatus,
} from '@hangban/contracts';
import { airports, createDemoFlights } from '@hangban/testkit';

import { buildApp } from '../app';
import { createMemoryRepository } from '../memory-repository';

const firstStatus: SourceStatus = {
  providerId: 'adsb-lol',
  state: 'degraded',
  lastAttemptAt: '2026-07-12T08:00:00.000Z',
  lastSuccessAt: '2026-07-12T07:59:00.000Z',
  lastRecordCount: 1,
  errorCode: 'UPSTREAM_ERROR',
  message: '数据源暂时不可用',
};
const secondStatus: SourceStatus = {
  providerId: 'opensky',
  state: 'healthy',
  lastAttemptAt: '2026-07-12T08:00:00.000Z',
  lastSuccessAt: '2026-07-12T08:00:00.000Z',
  lastRecordCount: 3,
};

async function waitFor(
  messages: RealtimeServerMessage[],
  predicate: (message: RealtimeServerMessage) => boolean,
): Promise<RealtimeServerMessage> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const match = messages.find(predicate);
    if (match !== undefined) return match;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for WebSocket message');
}

describe('realtime socket source statuses', () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  it('sends changed flight and source status fields once, then stops after close', async () => {
    const now = new Date('2026-07-12T08:00:00.000Z');
    const [initialFlight] = createDemoFlights(now);
    if (initialFlight === undefined) throw new Error('Missing flight fixture');
    const repository = createMemoryRepository({
      airports,
      flights: [initialFlight],
      sourceStatuses: [firstStatus, secondStatus],
    });
    const app = buildApp({
      repository,
      now: () => now,
      logger: false,
      realtimePushIntervalMs: 5,
    });
    apps.push(app);
    await app.ready();
    const socket = await app.injectWS('/api/v1/live');
    const messages: RealtimeServerMessage[] = [];
    socket.on('message', (raw: { toString(): string }) => {
      messages.push(realtimeServerMessageSchema.parse(JSON.parse(raw.toString())));
    });
    socket.send(JSON.stringify({ type: 'subscription.update', bbox: [100, 20, 160, 60] }));
    await waitFor(messages, (message) => message.type === 'subscription.ready');
    messages.length = 0;

    const movedFlight = {
      ...initialFlight,
      longitude: initialFlight.longitude + 0.01,
      observedAt: '2026-07-12T08:00:05.000Z',
    };
    let status: SourceStatus = {
      ...firstStatus,
      lastAttemptAt: '2026-07-12T08:00:05.000Z',
    };
    const changedSecondStatus = { ...secondStatus, lastRecordCount: 4 };
    repository.replaceSnapshot([movedFlight], [status, changedSecondStatus]);
    await waitFor(messages, (message) => message.type === 'flight.upsert');
    await waitFor(
      messages,
      () => messages.filter((message) => message.type === 'source.status').length === 2,
    );
    expect(messages.filter((message) => message.type === 'source.status')).toEqual([
      { type: 'source.status', status },
      { type: 'source.status', status: changedSecondStatus },
    ]);

    messages.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messages).toEqual([]);

    const changes: Array<Partial<SourceStatus>> = [
      { state: 'down' },
      { lastAttemptAt: '2026-07-12T08:00:10.000Z' },
      { lastSuccessAt: '2026-07-12T08:00:09.000Z' },
      { lastRecordCount: 2 },
      { errorCode: 'TIMEOUT' },
      { message: '数据源请求超时' },
    ];
    for (const change of changes) {
      status = sourceStatusSchema.parse({ ...status, ...change });
      repository.replaceSnapshot([movedFlight], [status, changedSecondStatus]);
      const message = await waitFor(messages, (candidate) => candidate.type === 'source.status');
      expect(message).toEqual({ type: 'source.status', status });
      messages.length = 0;
    }

    socket.close();
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    repository.replaceSnapshot(
      [movedFlight],
      [{ ...status, message: '关闭后不发送' }, changedSecondStatus],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messages).toEqual([]);
  });
});
