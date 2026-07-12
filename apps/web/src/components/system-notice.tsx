import { LoaderCircle, RefreshCw, SearchX, TriangleAlert, WifiOff } from 'lucide-react';

import type { SourceStatus } from '@hangban/contracts';

import type { RealtimeConnectionState } from '../lib/use-realtime-flights';

type Props = {
  connectionState: RealtimeConnectionState;
  totalFlights: number;
  visibleFlights: number;
  filtersActive: boolean;
  sourceStatuses: SourceStatus[];
  onRetry: () => void;
  onClearFilters: () => void;
};

export function SystemNotice({
  connectionState,
  totalFlights,
  visibleFlights,
  filtersActive,
  sourceStatuses,
  onRetry,
  onClearFilters,
}: Props) {
  if (connectionState === 'loading') {
    return (
      <div className="system-notice loading" role="status">
        <LoaderCircle size={17} aria-hidden="true" />
        正在连接实时航班网络…
      </div>
    );
  }
  if (sourceStatuses.length > 0 && sourceStatuses.every((status) => status.state === 'down')) {
    return (
      <div className="system-notice critical" role="alert">
        <TriangleAlert size={17} aria-hidden="true" />
        <span>实时位置来源全部不可用，地图和机场静态信息仍可使用。</span>
        <button type="button" onClick={onRetry}>
          <RefreshCw size={14} /> 重试实时位置
        </button>
      </div>
    );
  }
  if (connectionState === 'reconnecting' || connectionState === 'offline') {
    return (
      <div className="system-notice warning" role="alert">
        <WifiOff size={17} />
        <span>
          {connectionState === 'offline'
            ? '实时连接已中断，地图保留最后位置。'
            : '实时连接中断，正在重新连接…'}
        </span>
        <button type="button" onClick={onRetry}>
          <RefreshCw size={14} /> 重新连接
        </button>
      </div>
    );
  }
  if (visibleFlights === 0) {
    return (
      <div className="system-notice empty" role="status">
        <SearchX size={17} aria-hidden="true" />
        <span>
          {filtersActive && totalFlights > 0
            ? '当前筛选暂无航班，可清除条件或扩大地图范围。'
            : '当前视野暂无航班，可扩大地图范围或使用搜索。'}
        </span>
        {filtersActive && totalFlights > 0 ? (
          <button type="button" onClick={onClearFilters}>
            清除筛选
          </button>
        ) : null}
      </div>
    );
  }
  return null;
}
