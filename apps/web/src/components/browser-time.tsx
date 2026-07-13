'use client';

import { useSyncExternalStore } from 'react';

import {
  formatBrowserTime,
  formatUtcTitle,
  type BrowserTimeFormat,
  type BrowserTimeValue,
} from '../lib/browser-time';

export interface BrowserTimeProps {
  value: BrowserTimeValue;
  format?: BrowserTimeFormat;
  locale?: Intl.LocalesArgument;
  timeZone?: string;
  fallback?: string;
  className?: string;
}

const subscribeToBrowser = () => () => undefined;

export function useBrowserTimeReady(): boolean {
  return useSyncExternalStore(
    subscribeToBrowser,
    () => true,
    () => false,
  );
}

export function BrowserTime({
  value,
  format = 'compact',
  locale,
  timeZone,
  fallback = '—',
  className,
}: BrowserTimeProps) {
  const ready = useBrowserTimeReady();
  const title = formatUtcTitle(value);
  if (!title) {
    return <span className={className}>{fallback}</span>;
  }

  const dateTime = new Date(value as Date | number | string).toISOString();
  const formatted = ready
    ? formatBrowserTime(value, {
        format,
        ...(locale === undefined ? {} : { locale }),
        ...(timeZone === undefined ? {} : { timeZone }),
      })
    : null;

  return (
    <time className={className} dateTime={dateTime} title={title}>
      {formatted ?? fallback}
    </time>
  );
}
