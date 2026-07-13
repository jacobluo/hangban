import { useMemo, useState } from 'react';

import type { Airport, Flight } from '@hangban/contracts';
import { distanceKm, nearbyFlights } from '@hangban/domain';

type Props = {
  airports: Airport[];
  flights: Flight[];
  selected: Airport;
  onSelect: (airport: Airport) => void;
  onFlightSelect: (flight: Flight) => void;
  mobileDetailOpen: boolean;
  onMobileBack: () => void;
  total?: number;
  loading?: boolean;
  error?: string | null;
  hasMore?: boolean;
  onLoadMore?: () => void;
};

export function AirportExplorer({
  airports,
  flights,
  selected,
  onSelect,
  onFlightSelect,
  mobileDetailOpen,
  onMobileBack,
  total = airports.length,
  loading = false,
  error = null,
  hasMore = false,
  onLoadMore,
}: Props) {
  const [filter, setFilter] = useState<'all' | 'nearby' | 'popular'>('all');
  const nearby = nearbyFlights(flights, selected, 200);
  const realtimeSources = [...new Set(flights.flatMap((flight) => flight.sources))];
  const displayedAirports = useMemo(() => {
    if (filter === 'nearby') {
      return airports.toSorted(
        (left, right) =>
          distanceKm(selected.latitude, selected.longitude, left.latitude, left.longitude) -
          distanceKm(selected.latitude, selected.longitude, right.latitude, right.longitude),
      );
    }
    if (filter === 'popular') {
      const priority = ['PEK', 'JFK', 'SIN', 'HND', 'PVG'];
      return airports.toSorted(
        (left, right) => priority.indexOf(left.iata ?? '') - priority.indexOf(right.iata ?? ''),
      );
    }
    return airports;
  }, [airports, filter, selected.latitude, selected.longitude]);
  const filterDescription =
    filter === 'popular'
      ? '按大型枢纽排序'
      : filter === 'nearby'
        ? `按距 ${selected.iata ?? selected.icao} 的距离排序`
        : '当前数据集';
  return (
    <>
      <section
        className={`explorer-panel airport-list${mobileDetailOpen ? ' mobile-hidden' : ''}`}
        aria-labelledby="airport-explorer-title"
      >
        <div className="explorer-title-row">
          <h1 id="airport-explorer-title">机场探索</h1>
          <span>当前视野 {total}</span>
        </div>
        <div className="filter-row">
          <button
            type="button"
            className={filter === 'all' ? 'active' : ''}
            aria-label="全部机场"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          <button
            type="button"
            className={filter === 'nearby' ? 'active' : ''}
            aria-label="附近机场"
            aria-pressed={filter === 'nearby'}
            onClick={() => setFilter('nearby')}
          >
            附近
          </button>
          <button
            type="button"
            className={filter === 'popular' ? 'active' : ''}
            aria-label="热门机场"
            aria-pressed={filter === 'popular'}
            onClick={() => setFilter('popular')}
          >
            热门
          </button>
        </div>
        <p className="section-title">{filter === 'all' ? '当前地图视野' : filterDescription}</p>
        {error ? (
          <p className="empty-copy" role="alert">
            {error}
          </p>
        ) : null}
        {loading && airports.length === 0 ? (
          <p className="empty-copy" role="status">
            正在加载当前视野机场…
          </p>
        ) : null}
        <div className="airport-cards">
          {displayedAirports.map((airport) => {
            const active = airport.iata === selected.iata;
            const count = nearbyFlights(flights, airport, 200).length;
            return (
              <button
                key={airport.icao ?? airport.iata}
                className={active ? 'airport-card active' : 'airport-card'}
                type="button"
                onClick={() => onSelect(airport)}
              >
                <strong>{airport.iata ?? airport.icao}</strong>
                <span>
                  <b>{airport.name}</b>
                  <small>
                    {airport.city} · {airport.country} · 周边 {count} 架
                  </small>
                </span>
              </button>
            );
          })}
        </div>
        {hasMore ? (
          <button
            className="primary-button airport-load-more"
            type="button"
            disabled={loading}
            onClick={onLoadMore}
          >
            {loading ? '正在加载…' : `继续加载 · 已显示 ${airports.length} / ${total}`}
          </button>
        ) : null}
      </section>
      <aside
        className={`detail-panel airport-detail${mobileDetailOpen ? ' mobile-open' : ''}`}
        aria-label="机场概览"
      >
        <div className="panel-heading">
          <button className="mobile-back" type="button" onClick={onMobileBack}>
            返回机场列表
          </button>
          <span>机场概览</span>
          <em>更新 10 秒前</em>
        </div>
        <h1>{selected.iata ?? selected.icao}</h1>
        <h2>{selected.name}</h2>
        <p className="mono muted">
          {selected.icao} · {(selected.localizedCity ?? selected.city).toLocaleUpperCase()} ·{' '}
          {selected.country}
        </p>
        <div className="tag-row">
          <span>国际机场</span>
          <span className="healthy">实时覆盖良好</span>
        </div>
        <p className="mono coordinate">
          {selected.latitude.toFixed(4)}° N · {selected.longitude.toFixed(4)}° E · 海拔{' '}
          {selected.elevationM ?? '—'} m
        </p>
        <div className="metric-grid two">
          <div>
            <strong>{nearby.length === 0 ? '当前未获得记录' : nearby.length}</strong>
            <span>200 km 内实时位置</span>
          </div>
          <div>
            <strong>{realtimeSources.length === 0 ? '未获得' : realtimeSources.length}</strong>
            <span>实时位置来源</span>
          </div>
        </div>
        <div className="information-note">
          <b>实时空域观察</b>
          <span>周边航班不等同于到港或离港班次</span>
        </div>
        <div className="list-heading">
          <h3>周边实时航班</h3>
          <span>{nearby.length} ACTIVE</span>
        </div>
        <div className="flight-list">
          {nearby.length === 0 ? (
            <p className="empty-copy">当前未获得记录</p>
          ) : (
            nearby.slice(0, 4).map((flight) => (
              <button type="button" key={flight.id} onClick={() => onFlightSelect(flight)}>
                <strong>{flight.callsign}</strong>
                <span>
                  {metricCompact(flight.altitudeM, 'm')} ·{' '}
                  {metricCompact(flight.groundSpeedKmh, 'km/h')}
                </span>
              </button>
            ))
          )}
        </div>
        <p className="source-note mono">
          机场 OurAirports · 城市 GeoNames · 实时位置{' '}
          {flights
            .flatMap((flight) => flight.sources)
            .filter((source, index, values) => values.indexOf(source) === index)
            .join(' / ') || '暂未获得'}
        </p>
      </aside>
    </>
  );
}

function metricCompact(value: number | null, unit: string) {
  return value === null ? '—' : `${value.toLocaleString('zh-CN')} ${unit}`;
}
