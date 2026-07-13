import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { SourceStatus, WeatherRadarStatus } from '@hangban/contracts';

import type { RealtimeConnectionState } from '../lib/use-realtime-flights';
import { BrowserTime } from './browser-time';
import { WeatherDataStatus } from './weather-data-status';

type Props = {
  statuses: SourceStatus[];
  connectionState: RealtimeConnectionState;
  flightCount: number;
  lastUpdatedAt: string | null;
  weatherRadarStatus: WeatherRadarStatus | null;
  weatherRadarLoading: boolean;
  weatherRadarError: string | null;
  onBack: () => void;
  onRetry: () => void;
  onRetryWeather: () => void;
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

const errorLabels: Record<NonNullable<SourceStatus['errorCode']>, string> = {
  RATE_LIMITED: '请求频率受限',
  AUTH_FAILED: '鉴权失败',
  TIMEOUT: '请求超时',
  INVALID_RESPONSE: '响应格式异常',
  UPSTREAM_ERROR: '上游服务异常',
};

function overallLabel(
  connectionState: RealtimeConnectionState,
  healthyCount: number,
  sourceCount: number,
) {
  if (sourceCount === 0) return '尚未获得来源状态';
  if (connectionState === 'loading') return '正在连接实时服务';
  if (connectionState === 'reconnecting') return '正在重新连接';
  if (connectionState !== 'online') return '实时连接已中断';
  return healthyCount === sourceCount ? '全部服务正常' : '部分服务降级';
}

export function DataStatusPage({
  statuses,
  connectionState,
  flightCount,
  lastUpdatedAt,
  weatherRadarStatus,
  weatherRadarLoading,
  weatherRadarError,
  onBack,
  onRetry,
  onRetryWeather,
}: Props) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const healthyCount = statuses.filter((status) => status.state === 'healthy').length;
  const lastSuccessAt = statuses
    .flatMap((status) => (status.lastSuccessAt === null ? [] : [status.lastSuccessAt]))
    .sort()
    .at(-1);
  const retryAll = () => {
    onRetry();
    onRetryWeather();
  };

  useEffect(() => {
    backButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  return (
    <section className="data-status-page" role="region" aria-labelledby="data-status-title">
      <div className="data-status-container">
        <header className="data-status-heading">
          <button
            ref={backButtonRef}
            className="back-to-map"
            type="button"
            aria-label="返回地图"
            onClick={onBack}
          >
            <ArrowLeft size={17} /> 返回地图
          </button>
          <div className="data-status-title-block">
            <h1 id="data-status-title">数据覆盖与服务状态</h1>
            <p>查看实时数据源、覆盖范围和数据新鲜度</p>
          </div>
          <div className={`overall-health ${connectionState}`} role="status">
            <span className="status-dot" />
            <strong>{overallLabel(connectionState, healthyCount, statuses.length)}</strong>
          </div>
        </header>

        <div className="status-metrics" aria-label="数据状态摘要">
          <div>
            <strong>
              {healthyCount} / {statuses.length}
            </strong>
            <span>正常来源</span>
          </div>
          <div>
            <strong>{flightCount.toLocaleString('zh-CN')}</strong>
            <span>当前已获得航班</span>
          </div>
          <div>
            <strong>
              <BrowserTime
                value={lastSuccessAt ?? lastUpdatedAt}
                format="full"
                fallback="尚无成功记录"
              />
            </strong>
            <span>最后成功时间</span>
          </div>
        </div>

        <div className="data-status-content">
          <section className="data-source-section" aria-labelledby="provider-status-title">
            <h2 id="provider-status-title">数据源</h2>
            <div className="provider-list">
              {statuses.length === 0 ? (
                <p className="empty-copy">尚未获得数据源状态</p>
              ) : (
                statuses.map((status) => (
                  <article className={`provider-row ${status.state}`} key={status.providerId}>
                    <span className={`status-dot ${status.state === 'healthy' ? '' : 'delayed'}`} />
                    <div>
                      <strong>{providerNames[status.providerId] ?? status.providerId}</strong>
                      <span>{stateLabels[status.state]}</span>
                      <dl className="provider-details">
                        <div>
                          <dt>最近结果</dt>
                          <dd>{stateLabels[status.state]}</dd>
                        </div>
                        <div>
                          <dt>最后成功时间</dt>
                          <dd>
                            <BrowserTime
                              value={status.lastSuccessAt}
                              format="full"
                              fallback="尚无成功记录"
                            />
                          </dd>
                        </div>
                        <div>
                          <dt>记录数</dt>
                          <dd>{status.lastRecordCount ?? '未获得'}</dd>
                        </div>
                        <div>
                          <dt>错误类型</dt>
                          <dd>
                            {status.errorCode === undefined ? '无' : errorLabels[status.errorCode]}
                          </dd>
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
                ))
              )}
            </div>
            <WeatherDataStatus
              status={weatherRadarStatus}
              loading={weatherRadarLoading}
              error={weatherRadarError}
            />
          </section>

          <aside className="coverage-summary" aria-labelledby="coverage-boundary-title">
            <h2 id="coverage-boundary-title">当前覆盖边界</h2>
            <strong>实时位置持续更新，但不代表完整全球覆盖</strong>
            <p className="coverage-note">当前航班数不代表全球实际在途总数，仅反映当前数据覆盖。</p>
            <dl className="coverage-definitions">
              <div>
                <dt>「实时」的含义</dt>
                <dd>位置处于产品规定的新鲜度窗口内，不表示零延迟。</dd>
              </div>
              <div>
                <dt>覆盖范围</dt>
                <dd>免费公开来源受接收站分布、供应商策略和当前采集视野影响。</dd>
              </div>
              <div>
                <dt>降级数据</dt>
                <dd>来源异常时可能保留最近成功结果，并明确标记延迟或过期。</dd>
              </div>
            </dl>
            <p className="status-disclaimer">
              实时位置可能存在延迟、遗漏或误差，不用于飞行安全、空管或机场运行决策。
            </p>
            <button
              className="primary-button retry-button"
              type="button"
              aria-busy={weatherRadarLoading}
              onClick={retryAll}
            >
              <RefreshCw size={15} /> 重新获取数据
            </button>
          </aside>
        </div>
      </div>
    </section>
  );
}
