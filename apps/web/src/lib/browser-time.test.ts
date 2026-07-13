import { describe, expect, it } from 'vitest';

import { formatBrowserTime, formatUtcTitle } from './browser-time';

describe('formatBrowserTime', () => {
  it('formats a compact time in the requested browser timezone', () => {
    expect(
      formatBrowserTime('2026-07-13T15:20:00.000Z', {
        format: 'compact',
        locale: 'zh-CN',
        timeZone: 'Asia/Shanghai',
      }),
    ).toBe('23:20 GMT+8');
  });

  it('formats a full time in the requested browser timezone', () => {
    expect(
      formatBrowserTime('2026-07-13T15:20:00.000Z', {
        format: 'full',
        locale: 'zh-CN',
        timeZone: 'Asia/Shanghai',
      }),
    ).toBe('2026/7/13 23:20:00 GMT+8');
  });

  it('lets Intl apply daylight-saving offsets', () => {
    const options = {
      format: 'compact' as const,
      locale: 'en-US',
      timeZone: 'America/New_York',
    };

    expect(formatBrowserTime('2026-01-15T12:00:00.000Z', options)).toBe('07:00 GMT-5');
    expect(formatBrowserTime('2026-07-15T12:00:00.000Z', options)).toBe('08:00 GMT-4');
  });

  it('returns null for missing or invalid values', () => {
    expect(formatBrowserTime(null, { timeZone: 'Asia/Shanghai' })).toBeNull();
    expect(formatBrowserTime('not-a-date', { timeZone: 'Asia/Shanghai' })).toBeNull();
  });
});

describe('formatUtcTitle', () => {
  it('keeps the original instant available as full UTC text', () => {
    expect(formatUtcTitle('2026-07-13T15:20:00.000Z')).toBe('UTC：2026-07-13 15:20:00');
  });

  it('returns null for invalid values', () => {
    expect(formatUtcTitle('not-a-date')).toBeNull();
  });
});
