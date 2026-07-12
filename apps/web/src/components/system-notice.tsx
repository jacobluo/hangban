import { RefreshCw, WifiOff } from 'lucide-react';

import type { RealtimeConnectionState } from '../lib/use-realtime-flights';

type Props = {
  connectionState: RealtimeConnectionState;
  totalFlights: number;
  visibleFlights: number;
  filtersActive: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
};

export function SystemNotice({
  connectionState,
  totalFlights,
  visibleFlights,
  filtersActive,
  onRetry,
  onClearFilters,
}: Props) {
  if (connectionState === 'loading') {
    return (
      <div className="system-notice loading" role="status">
        正在连接实时航班网络…
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
