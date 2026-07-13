export type BrowserTimeFormat = 'compact' | 'full';

export type BrowserTimeValue = Date | number | string | null | undefined;

export interface FormatBrowserTimeOptions {
  format?: BrowserTimeFormat;
  locale?: Intl.LocalesArgument;
  timeZone?: string;
}

function toValidDate(value: BrowserTimeValue): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatBrowserTime(
  value: BrowserTimeValue,
  options: FormatBrowserTimeOptions = {},
): string | null {
  const date = toValidDate(value);
  if (!date) {
    return null;
  }

  const format = options.format ?? 'compact';

  try {
    const formatter = new Intl.DateTimeFormat(options.locale, {
      ...(format === 'full' ? { year: 'numeric', month: 'numeric', day: 'numeric' } : undefined),
      hour: '2-digit',
      minute: '2-digit',
      ...(format === 'full' ? { second: '2-digit' } : undefined),
      hourCycle: 'h23',
      timeZone: options.timeZone,
      timeZoneName: 'shortOffset',
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    const time = `${parts.hour}:${parts.minute}${format === 'full' ? `:${parts.second}` : ''}`;

    return format === 'full'
      ? `${parts.year}/${parts.month}/${parts.day} ${time} ${parts.timeZoneName}`
      : `${time} ${parts.timeZoneName}`;
  } catch {
    return null;
  }
}

export function formatUtcTitle(value: BrowserTimeValue): string | null {
  const date = toValidDate(value);
  if (!date) {
    return null;
  }

  return `UTC：${date.toISOString().slice(0, 19).replace('T', ' ')}`;
}
