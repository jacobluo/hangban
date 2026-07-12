import { ArrowLeft, Plane } from 'lucide-react';

import type { Airport, Flight } from '@hangban/contracts';

type Props = {
  flight: Flight;
  airports: Airport[];
  onBack: () => void;
};

function metric(value: number | null, unit: string) {
  return value === null ? '未获得数据' : `${value.toLocaleString('zh-CN')} ${unit}`;
}

function airportFor(code: string | undefined, airports: Airport[]) {
  return airports.find((airport) => airport.iata === code);
}

export function FlightDetailsPage({ flight, airports, onBack }: Props) {
  const origin = airportFor(flight.origin, airports);
  const destination = airportFor(flight.destination, airports);
  const isDemo = flight.sources.includes('demo');

  return (
    <section className="full-detail-page" aria-label="完整航班详情">
      <div className="full-detail-container">
        <header className="full-detail-heading">
          <button className="back-to-map" type="button" aria-label="返回地图" onClick={onBack}>
            <ArrowLeft size={17} /> 返回地图
          </button>
          <div className="full-flight-identity">
            <Plane size={22} />
            <h1>{flight.callsign}</h1>
            <span>{flight.airline ?? '航空公司未知'}</span>
            <small>
              {flight.aircraftType ?? '机型未知'} · {flight.registration ?? '注册号未知'}
            </small>
          </div>
          <div className="detail-update-state">
            <span>更新于 {flight.observedAt.slice(11, 19)} UTC</span>
            <strong className={`freshness-label ${flight.freshness}`}>
              {flight.freshness === 'live'
                ? '实时'
                : flight.freshness === 'delayed'
                  ? '延迟'
                  : '过期'}
            </strong>
          </div>
        </header>

        <section className="full-route-card" aria-label="航线概览">
          <div>
            <strong>{flight.origin ?? '—'}</strong>
            <b>{origin?.name ?? '未获得出发机场'}</b>
            <span>{origin?.city ?? '—'}</span>
          </div>
          <div className="full-route-progress">
            <span>最后观测 {flight.observedAt.slice(11, 16)} UTC</span>
            <i>
              <b style={{ width: `${Math.round(flight.confidence * 100)}%` }} />
            </i>
            <small>融合覆盖度 {Math.round(flight.confidence * 100)}%</small>
          </div>
          <div>
            <strong>{flight.destination ?? '—'}</strong>
            <b>{destination?.name ?? '未获得到达机场'}</b>
            <span>{destination?.city ?? '—'}</span>
          </div>
        </section>
        {flight.inferredFields.includes('origin') ||
        flight.inferredFields.includes('destination') ? (
          <div className="information-note inferred-route">
            <b>根据公开路线信息推断</b>
            <span>该起终点不是航空公司或机场发布的官方飞行计划。</span>
          </div>
        ) : null}

        <div className="full-detail-grid">
          <section className="flight-data-card">
            <h2>实时飞行数据</h2>
            <div className="full-metric-grid">
              <div>
                <span>高度</span>
                <strong>{metric(flight.altitudeM, 'm')}</strong>
              </div>
              <div>
                <span>地速</span>
                <strong>{metric(flight.groundSpeedKmh, 'km/h')}</strong>
              </div>
              <div>
                <span>航向</span>
                <strong>{metric(flight.headingDeg, '°')}</strong>
              </div>
              <div>
                <span>升降率</span>
                <strong>{metric(flight.verticalRateMpm, 'm/min')}</strong>
              </div>
            </div>

            <div className="trend-heading">
              <h3>近 90 分钟观测趋势</h3>
              <span>{isDemo ? '演示数据趋势' : '历史趋势未获得'}</span>
            </div>
            {isDemo ? (
              <div className="flight-trend-chart" role="img" aria-label="高度与地速演示趋势图">
                <svg viewBox="0 0 800 230" preserveAspectRatio="none" aria-hidden="true">
                  <g className="chart-grid">
                    <path d="M30 30H780M30 85H780M30 140H780M30 195H780" />
                    <path d="M30 25V200M220 25V200M410 25V200M600 25V200M780 25V200" />
                  </g>
                  <path
                    className="altitude-line"
                    d="M30 175 C100 160 120 115 205 98 S340 45 430 53 S610 58 780 42"
                  />
                  <path className="speed-line" d="M30 155 C140 128 230 110 330 97 S520 80 780 77" />
                  <circle className="altitude-point" cx="780" cy="42" r="5" />
                  <circle className="speed-point" cx="780" cy="77" r="5" />
                </svg>
                <div className="chart-legend">
                  <span>高度 {metric(flight.altitudeM, 'm')}</span>
                  <span>地速 {metric(flight.groundSpeedKmh, 'km/h')}</span>
                </div>
                <p>演示数据趋势用于界面验证，不代表已保存的真实历史轨迹。</p>
              </div>
            ) : (
              <div className="trend-empty">当前数据源未提供可验证的历史趋势。</div>
            )}
          </section>

          <aside className="flight-event-card">
            <h2>航班事件</h2>
            <div className="event-list">
              <article className="current">
                <strong>{flight.observedAt.slice(11, 19)} UTC · 当前观测</strong>
                <span>记录位置、高度与地速</span>
              </article>
              <article>
                <strong>统一模型校验完成</strong>
                <span>{flight.sources.length} 个来源参与当前记录</span>
              </article>
            </div>
            <h3>飞机与数据</h3>
            <dl>
              <div>
                <dt>机型</dt>
                <dd>{flight.aircraftType ?? '未获得数据'}</dd>
              </div>
              <div>
                <dt>注册号</dt>
                <dd>{flight.registration ?? '未获得数据'}</dd>
              </div>
              <div>
                <dt>ICAO 24 位地址</dt>
                <dd>{flight.icao24.toUpperCase()}</dd>
              </div>
              <div>
                <dt>数据来源</dt>
                <dd>
                  {[
                    ...new Set([
                      ...flight.sources,
                      ...flight.fieldSources.map((source) => source.providerId),
                    ]),
                  ].join(' · ')}
                </dd>
              </div>
              <div>
                <dt>融合置信度</dt>
                <dd>{Math.round(flight.confidence * 100)}%</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </section>
  );
}
