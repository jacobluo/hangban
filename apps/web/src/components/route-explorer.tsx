import { ArrowLeftRight, X } from 'lucide-react';
import { useState } from 'react';

import type { Airport, Flight } from '@hangban/contracts';
import { distanceKm, matchRouteFlights } from '@hangban/domain';

import { AirportPicker } from './airport-picker';

type Props = {
  airports: Airport[];
  flights: Flight[];
  origin: Airport | null;
  destination: Airport | null;
  onOriginChange: (airport: Airport | null) => void;
  onDestinationChange: (airport: Airport | null) => void;
  onFlightSelect: (flight: Flight) => void;
  onFocusRoute: () => void;
};

export function RouteExplorer({
  airports,
  flights,
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  onFlightSelect,
  onFocusRoute,
}: Props) {
  const [picker, setPicker] = useState<'origin' | 'destination' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const routeReady = origin !== null && destination !== null;
  const activeFlights = routeReady
    ? matchRouteFlights(flights, origin.iata ?? '', destination.iata ?? '')
    : [];
  const distance = routeReady
    ? Math.round(
        distanceKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude),
      )
    : null;
  const coverage =
    activeFlights.length === 0
      ? 0
      : Math.round(
          (activeFlights.reduce((sum, flight) => sum + flight.confidence, 0) /
            activeFlights.length) *
            100,
        );
  const lastObservedAt = activeFlights
    .map((flight) => flight.observedAt)
    .sort()
    .at(-1);

  const selectAirport = (kind: 'origin' | 'destination', airport: Airport) => {
    const other = kind === 'origin' ? destination : origin;
    if ((airport.icao ?? airport.iata) === (other?.icao ?? other?.iata)) {
      setError('起点和终点不能相同，请重新选择。');
      return;
    }
    setError(null);
    if (kind === 'origin') onOriginChange(airport);
    else onDestinationChange(airport);
    setPicker(null);
  };

  return (
    <>
      <section className="explorer-panel route-builder" aria-labelledby="route-explorer-title">
        <div className="explorer-title-row">
          <h1 id="route-explorer-title">航线探索</h1>
          <span>选择起点和终点</span>
        </div>
        <div className="endpoint-grid">
          <div className="endpoint-slot">
            <button
              className="endpoint active"
              type="button"
              aria-label={`选择出发机场，当前 ${origin?.iata ?? '未选择'}`}
              onClick={() => setPicker('origin')}
            >
              <span>出发机场</span>
              <strong>{origin?.iata ?? '—'}</strong>
              <b>{origin?.city ?? '选择机场'}</b>
            </button>
            {origin === null ? null : (
              <button
                className="endpoint-clear"
                type="button"
                aria-label="清除出发机场"
                onClick={() => onOriginChange(null)}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className="endpoint-swap"
            type="button"
            aria-label="交换起点和终点"
            onClick={() => {
              onOriginChange(destination);
              onDestinationChange(origin);
            }}
          >
            <ArrowLeftRight size={17} />
          </button>
          <div className="endpoint-slot">
            <button
              className="endpoint"
              type="button"
              aria-label={`选择到达机场，当前 ${destination?.iata ?? '未选择'}`}
              onClick={() => setPicker('destination')}
            >
              <span>到达机场</span>
              <strong>{destination?.iata ?? '—'}</strong>
              <b>{destination?.city ?? '选择机场'}</b>
            </button>
            {destination === null ? null : (
              <button
                className="endpoint-clear"
                type="button"
                aria-label="清除到达机场"
                onClick={() => onDestinationChange(null)}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        {error === null ? null : (
          <p className="route-error" role="alert">
            {error}
          </p>
        )}
        {picker === null ? null : (
          <AirportPicker
            kind={picker}
            airports={airports}
            selected={picker === 'origin' ? origin : destination}
            onSelect={(airport) => selectAirport(picker, airport)}
            onClose={() => setPicker(null)}
          />
        )}
        <p className="mono route-meta">
          {routeReady && distance !== null
            ? `${distance.toLocaleString('zh-CN')} km · 当前 ${activeFlights.length} 架在途`
            : '选择两个不同机场后查看实时航线'}
        </p>
        <button
          className="primary-button"
          type="button"
          disabled={!routeReady}
          onClick={onFocusRoute}
        >
          在地图中查看航线
        </button>
      </section>
      <aside className="detail-panel route-detail" aria-label="航线概览">
        <div className="panel-heading">
          <span>航线概览</span>
          <em>更新 10 秒前</em>
        </div>
        <div className="route-identity">
          <div>
            <strong>{origin?.iata ?? '—'}</strong>
            <span>{origin?.city ?? '未选择'}</span>
          </div>
          <b>TO</b>
          <div>
            <strong>{destination?.iata ?? '—'}</strong>
            <span>{destination?.city ?? '未选择'}</span>
          </div>
        </div>
        {routeReady && distance !== null ? (
          <p className="mono coordinate route-code">
            {origin.iata} → {destination.iata}
          </p>
        ) : null}
        <div className="metric-grid two">
          <div>
            <strong>{activeFlights.length}</strong>
            <span>当前在途航班</span>
          </div>
          <div>
            <strong>{coverage}%</strong>
            <span>轨迹覆盖度</span>
          </div>
        </div>
        <div className="information-note">
          <b>实时航线视图</b>
          <span>基于公开航班信息和实时位置归并，不代表官方完整班次，也不承诺完整覆盖。</span>
        </div>
        <p className="mono route-observed-at">
          {lastObservedAt === undefined
            ? '更新时间未获得'
            : `更新于 ${lastObservedAt.slice(11, 19)} UTC`}
        </p>
        <div className="list-heading">
          <h3>当前在途航班</h3>
          <span>{activeFlights.length} ACTIVE</span>
        </div>
        <div className="flight-list">
          {!routeReady ? (
            <p className="empty-copy">请选择起点和终点。</p>
          ) : activeFlights.length === 0 ? (
            <p className="empty-copy">当前没有匹配的在途航班</p>
          ) : (
            activeFlights.map((flight) => (
              <button type="button" key={flight.id} onClick={() => onFlightSelect(flight)}>
                <strong>{flight.callsign}</strong>
                <span>
                  {flight.altitudeM?.toLocaleString('zh-CN') ?? '—'} m ·{' '}
                  {flight.groundSpeedKmh ?? '—'} km/h
                </span>
                <em>{Math.round(flight.confidence * 100)}%</em>
              </button>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
