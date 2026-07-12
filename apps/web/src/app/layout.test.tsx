import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import RootLayout from './layout';

describe('root layout', () => {
  it('tolerates browser extensions adding attributes to the body before hydration', () => {
    const layout = RootLayout({ children: <div>content</div> }) as ReactElement<{
      children: ReactElement<{ suppressHydrationWarning?: boolean }>;
    }>;

    expect(layout.props.children.props.suppressHydrationWarning).toBe(true);
  });
});
