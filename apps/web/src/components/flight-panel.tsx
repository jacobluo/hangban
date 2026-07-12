import { Star, X } from 'lucide-react';

import type { Flight } from '@hangban/contracts';

type Props = { flight: Flight; onClose: () => void; onOpenDetails: () => void };

function metric(value: number | null, unit: string) {
  return value === null ? '未获得数据' : `${value.toLocaleString('zh-CN')} ${unit}`;
}

export function FlightPanel({ flight, onClose, onOpenDetails }: Props) {
  return (
    <aside className="detail-panel flight-detail" aria-label="航班详情">
      <div className="panel-heading">
        <span>航班详情</span>
        <button className="icon-button" type="button" aria-label="关闭航班详情" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="flight-title-row">
        <h1>{flight.callsign}</h1>
        <Star aria-label="收藏功能暂未开放" size={21} />
        <span className="status-chip">飞行中</span>
      </div>
      <h2>{flight.airline ?? '航空公司未知'}</h2>
      <p className="mono muted">
        {flight.aircraftType ?? '机型未知'} · {flight.registration ?? '注册号未知'}
      </p>

      <div className="route-card">
        <div>
          <strong>{flight.origin ?? '—'}</strong>
          <span>出发地</span>
        </div>
        <div className="route-progress">
          <span>{flight.observedAt.slice(11, 16)} UTC</span>
          <i />
        </div>
        <div>
          <strong>{flight.destination ?? '—'}</strong>
          <span>目的地</span>
        </div>
      </div>
      {flight.inferredFields.includes('origin') || flight.inferredFields.includes('destination') ? (
        <div className="information-note inferred-route">
          <b>公开路线信息推断</b>
          <span>起终点并非官方飞行计划，可能随呼号复用而变化。</span>
        </div>
      ) : null}

      <p className="section-title">当前状态</p>
      <div className="metric-grid">
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

      <div className="source-note">
        <span>融合来源</span>
        <strong>
          {[
            ...new Set([
              ...flight.sources,
              ...flight.fieldSources.map((source) => source.providerId),
            ]),
          ].join(' · ')}
        </strong>
        <span>覆盖度 {Math.round(flight.confidence * 100)}%</span>
      </div>
      <button
        className="primary-button flight-details-button"
        type="button"
        onClick={onOpenDetails}
      >
        查看完整详情
      </button>
    </aside>
  );
}
