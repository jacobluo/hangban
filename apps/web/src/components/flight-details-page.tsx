import { ArrowLeft, Plane } from 'lucide-react';

import type { Airport, Flight } from '@hangban/contracts';

import { BrowserTime } from './browser-time';

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
  const inferredRoute =
    flight.inferredFields.includes('origin') || flight.inferredFields.includes('destination');
  const sources = [
    ...new Set([...flight.sources, ...flight.fieldSources.map((source) => source.providerId)]),
  ];

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
            <span>
              更新于 <BrowserTime value={flight.observedAt} format="full" />
            </span>
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
            <span>
              最后观测 <BrowserTime value={flight.observedAt} format="full" />
            </span>
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
        {inferredRoute ? (
          <section className="information-note inferred-route" aria-label="路线推断说明">
            <h2>路线推断</h2>
            <span>该起终点不是航空公司或机场发布的官方飞行计划。</span>
          </section>
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
          </section>

          <aside className="flight-event-card">
            <h2>航班事件</h2>
            <div className="event-list">
              <article className="current">
                <strong>
                  <BrowserTime value={flight.observedAt} format="full" /> · 当前观测
                </strong>
                <span>记录位置、高度与地速</span>
              </article>
              <article>
                <strong>统一模型校验完成</strong>
                <span>{flight.sources.length} 个来源参与当前记录</span>
              </article>
            </div>
            <h2>补充资料</h2>
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
                <dd>{sources.join(' · ')}</dd>
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
