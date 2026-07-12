import { RefreshCw, X } from 'lucide-react';
import { useEffect } from 'react';

import type { SourceStatus } from '@hangban/contracts';

import type { RealtimeConnectionState } from '../lib/use-realtime-flights';

type Props = {
  statuses: SourceStatus[];
  connectionState: RealtimeConnectionState;
  flightCount: number;
  lastUpdatedAt: string | null;
  onClose: () => void;
  onRetry: () => void;
};

const providerNames: Record<string, string> = {
  'adsb-lol': 'ADSB.lol',
  opensky: 'OpenSky Network',
  'airplanes-live': 'Airplanes.live',
  demo: '演示数据',
};

const stateLabels: Record<SourceStatus['state'], string> = {
  healthy: '正常',
  degraded: '部分延迟',
  down: '不可用',
};

function utcTime(value: string | null) {
  if (value === null) return '尚无成功记录';
  return `${value.slice(11, 19)} UTC`;
}

export function DataStatusPanel({
  statuses,
  connectionState,
  flightCount,
  lastUpdatedAt,
  onClose,
  onRetry,
}: Props) {
  const healthyCount = statuses.filter((status) => status.state === 'healthy').length;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      className="detail-panel data-status-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-status-title"
    >
      <div className="panel-heading settings-heading">
        <h2 id="data-status-title">数据覆盖与服务状态</h2>
        <button className="icon-button" type="button" aria-label="关闭数据状态" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className={`overall-health ${connectionState}`} role="status">
        <span className="status-dot" />
        <strong>
          {connectionState === 'online'
            ? healthyCount === statuses.length
              ? '全部服务正常'
              : '部分服务降级'
            : connectionState === 'loading'
              ? '正在连接实时服务'
              : connectionState === 'reconnecting'
                ? '正在重新连接'
                : '实时连接已中断'}
        </strong>
      </div>

      <div className="status-metrics">
        <div>
          <strong>
            {healthyCount} / {statuses.length}
          </strong>
          <span>正常来源</span>
        </div>
        <div>
          <strong>{flightCount.toLocaleString('zh-CN')}</strong>
          <span>当前航班</span>
        </div>
        <div>
          <strong>{utcTime(lastUpdatedAt)}</strong>
          <span>最后更新</span>
        </div>
      </div>

      <h3 className="status-section-title">数据源</h3>
      <div className="provider-list">
        {statuses.map((status) => (
          <article className={`provider-row ${status.state}`} key={status.providerId}>
            <span className={`status-dot ${status.state === 'healthy' ? '' : 'delayed'}`} />
            <div>
              <strong>{providerNames[status.providerId] ?? status.providerId}</strong>
              <span>
                {stateLabels[status.state]} · {utcTime(status.lastSuccessAt)}
              </span>
              {status.message === undefined ? null : <em>{status.message}</em>}
            </div>
          </article>
        ))}
      </div>

      <p className="status-disclaimer">
        实时位置可能存在延迟、遗漏或误差，不用于飞行安全、空管或机场运行决策。
      </p>
      <button className="primary-button retry-button" type="button" onClick={onRetry}>
        <RefreshCw size={15} /> 重新获取数据
      </button>
    </aside>
  );
}
