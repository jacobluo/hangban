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

const errorLabels: Record<NonNullable<SourceStatus['errorCode']>, string> = {
  RATE_LIMITED: '请求频率受限',
  AUTH_FAILED: '鉴权失败',
  TIMEOUT: '请求超时',
  INVALID_RESPONSE: '响应格式异常',
  UPSTREAM_ERROR: '上游服务异常',
};

export function DataStatusPanel({
  statuses,
  connectionState,
  flightCount,
  lastUpdatedAt,
  onClose,
  onRetry,
}: Props) {
  const healthyCount = statuses.filter((status) => status.state === 'healthy').length;
  const lastSuccessAt = statuses
    .flatMap((status) => (status.lastSuccessAt === null ? [] : [status.lastSuccessAt]))
    .sort()
    .at(-1);

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
          <strong>{utcTime(lastSuccessAt ?? lastUpdatedAt)}</strong>
          <span>最后成功时间</span>
        </div>
      </div>

      <p className="coverage-note">当前航班数不代表全球实际在途总数，仅反映当前数据覆盖。</p>

      <h3 className="status-section-title">数据源</h3>
      <div className="provider-list">
        {statuses.map((status) => (
          <article className={`provider-row ${status.state}`} key={status.providerId}>
            <span className={`status-dot ${status.state === 'healthy' ? '' : 'delayed'}`} />
            <div>
              <strong>{providerNames[status.providerId] ?? status.providerId}</strong>
              <dl className="provider-details">
                <div>
                  <dt>最近结果</dt>
                  <dd>{stateLabels[status.state]}</dd>
                </div>
                <div>
                  <dt>最后成功时间</dt>
                  <dd>{utcTime(status.lastSuccessAt)}</dd>
                </div>
                <div>
                  <dt>记录数</dt>
                  <dd>{status.lastRecordCount ?? '未获得'}</dd>
                </div>
                <div>
                  <dt>错误类型</dt>
                  <dd>{status.errorCode === undefined ? '无' : errorLabels[status.errorCode]}</dd>
                </div>
                <div>
                  <dt>结果语义</dt>
                  <dd>
                    {status.state === 'healthy'
                      ? '使用当前结果'
                      : status.lastSuccessAt === null
                        ? '无可用缓存'
                        : '最近成功结果仅供降级参考'}
                  </dd>
                </div>
              </dl>
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
