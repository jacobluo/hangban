// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BrowserTime } from './browser-time';

describe('BrowserTime', () => {
  it('uses the same placeholder for server rendering and initial hydration', () => {
    const markup = renderToString(
      <BrowserTime value="2026-07-13T15:20:00.000Z" format="compact" timeZone="Asia/Shanghai" />,
    );

    expect(markup).toContain('>—</time>');
    expect(markup).toContain('dateTime="2026-07-13T15:20:00.000Z"');
    expect(markup).toContain('title="UTC：2026-07-13 15:20:00"');
  });

  it('renders browser-local text while preserving UTC metadata', async () => {
    render(<BrowserTime value="2026-07-13T15:20:00.000Z" format="full" timeZone="Asia/Shanghai" />);

    const time = await screen.findByText('2026/7/13 23:20:00 GMT+8');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-07-13T15:20:00.000Z');
    expect(time).toHaveAttribute('title', 'UTC：2026-07-13 15:20:00');
  });

  it('renders the requested fallback for an invalid value', () => {
    render(<BrowserTime value="not-a-date" fallback="暂无时间" />);

    expect(screen.getByText('暂无时间')).toBeVisible();
    expect(document.querySelector('time')).not.toBeInTheDocument();
  });
});
