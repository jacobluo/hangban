import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

export const metadata: Metadata = {
  title: '航迹 · 全球实时航班',
  description: '全球航班实时地图、机场探索与航线观察',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
