'use client';

import { Plane } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { type Airport, type Flight } from '@hangban/contracts';
import { matchRouteFlights } from '@hangban/domain';

import type { AppData } from '../lib/demo-data';
import { defaultFlightFilters, filterFlights, type FlightFilters } from '../lib/flight-filters';
import { defaultMapLayers, type MapLayers } from '../lib/map-settings';
import { projectFlightsBack } from '../lib/flight-playback';
import { searchAirports } from '../lib/api-client';
import { useRealtimeFlights } from '../lib/use-realtime-flights';
import { useAirports } from '../lib/use-airports';
import { useWeatherRadar } from '../lib/use-weather-radar';
import { AirportExplorer } from './airport-explorer';
import { DataStatus } from './data-status';
import { DataStatusPage } from './data-status-page';
import { FlightDetailsPage } from './flight-details-page';
import { FlightMap, type FlightMapHandle } from './flight-map';
import { FlightPanel } from './flight-panel';
import { LayerFilterPanel } from './layer-filter-panel';
import { MapControls } from './map-controls';
import { PlaybackControl } from './playback-control';
import { RouteExplorer } from './route-explorer';
import { SearchBox } from './search-box';
import { SystemNotice } from './system-notice';
import { WeatherRadarLegend } from './weather-radar-legend';

type View = 'live' | 'airports' | 'routes';

type Props = { initialData: AppData; mapEnabled?: boolean };

export function AppShell({ initialData, mapEnabled = true }: Props) {
  const [view, setView] = useState<View>('live');
  const { flights, sourceStatuses, connectionState, lastUpdatedAt, retry, updateViewport } =
    useRealtimeFlights(initialData, mapEnabled);
  const airportState = useAirports(initialData.airports, mapEnabled);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(
    initialData.flights[0] ?? null,
  );
  const [selectedAirport, setSelectedAirport] = useState<Airport | null>(
    initialData.airports.find((airport) => airport.iata === 'PEK') ??
      initialData.airports[0] ??
      null,
  );
  const [routeOrigin, setRouteOrigin] = useState<Airport | null>(
    initialData.airports.find((airport) => airport.iata === 'PEK') ?? null,
  );
  const [routeDestination, setRouteDestination] = useState<Airport | null>(
    initialData.airports.find((airport) => airport.iata === 'JFK') ?? null,
  );
  const [mobileAirportDetailOpen, setMobileAirportDetailOpen] = useState(false);
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [statusPageOpen, setStatusPageOpen] = useState(false);
  const [fullDetailOpen, setFullDetailOpen] = useState(false);
  const [filters, setFilters] = useState<FlightFilters>(defaultFlightFilters);
  const [mapLayers, setMapLayers] = useState<MapLayers>(defaultMapLayers);
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [playbackMinutes, setPlaybackMinutes] = useState(0);
  const weatherRadarRequested = mapLayers.weatherRadar || statusPageOpen;
  const weatherRadar = useWeatherRadar(weatherRadarRequested);
  const mapRef = useRef<FlightMapHandle>(null);
  const airportChosenRef = useRef(false);
  const statusTriggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!airportChosenRef.current && selectedAirport === null && airportState.airports[0])
      setSelectedAirport(
        airportState.airports.find((airport) => airport.iata === 'PEK') ?? airportState.airports[0],
      );
  }, [airportState.airports, selectedAirport]);
  useEffect(() => {
    if (!mapEnabled || routeOrigin !== null || routeDestination !== null) return;
    const controller = new AbortController();
    void Promise.all([
      searchAirports('PEK', controller.signal),
      searchAirports('JFK', controller.signal),
    ])
      .then(([origins, destinations]) => {
        if (origins[0]) setRouteOrigin(origins[0]);
        if (destinations[0]) setRouteDestination(destinations[0]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [mapEnabled, routeDestination, routeOrigin]);

  useEffect(() => {
    if (!mapLayers.weatherRadar) return;
    if (weatherRadar.error === null && weatherRadar.status?.available !== false) return;
    setMapLayers((current) => ({ ...current, weatherRadar: false }));
    setMapMessage('天气雷达暂时不可用，航班数据不受影响。');
  }, [mapLayers.weatherRadar, weatherRadar.error, weatherRadar.status]);

  const placeholder =
    view === 'airports'
      ? '搜索机场或城市'
      : view === 'routes'
        ? '搜索出发地或目的地'
        : '搜索航班、机场或城市';
  const visibleFlight = useMemo(
    () =>
      selectedFlight === null
        ? null
        : (flights.find((flight) => flight.id === selectedFlight.id) ?? selectedFlight),
    [flights, selectedFlight],
  );
  const filteredFlights = useMemo(() => filterFlights(flights, filters), [filters, flights]);
  const flightFiltersActive = useMemo(
    () =>
      filters.maxAltitudeM !== defaultFlightFilters.maxAltitudeM ||
      filters.airline !== defaultFlightFilters.airline ||
      filters.freshness.length !== defaultFlightFilters.freshness.length ||
      defaultFlightFilters.freshness.some((freshness) => !filters.freshness.includes(freshness)),
    [filters],
  );
  const filtersActive = useMemo(
    () =>
      flightFiltersActive ||
      Object.entries(mapLayers).some(
        ([key, value]) => defaultMapLayers[key as keyof MapLayers] !== value,
      ),
    [flightFiltersActive, mapLayers],
  );
  const routeFlights = useMemo(
    () =>
      routeOrigin === null || routeDestination === null
        ? []
        : matchRouteFlights(filteredFlights, routeOrigin.iata ?? '', routeDestination.iata ?? ''),
    [filteredFlights, routeDestination, routeOrigin],
  );
  const mapFlights =
    view === 'routes' && routeOrigin !== null && routeDestination !== null
      ? routeFlights
      : filteredFlights;
  const projectedMapFlights = useMemo(
    () => projectFlightsBack(mapFlights, playbackMinutes),
    [mapFlights, playbackMinutes],
  );

  const chooseFlight = (flight: Flight) => {
    setSelectedFlight(flight);
    setView('live');
    setFullDetailOpen(false);
    setLayerPanelOpen(false);
    mapRef.current?.flyTo(flight.longitude, flight.latitude);
  };
  const chooseAirport = (airport: Airport) => {
    airportChosenRef.current = true;
    setSelectedAirport(airport);
    setSelectedFlight(null);
    setView('airports');
    setMobileAirportDetailOpen(true);
    setLayerPanelOpen(false);
    mapRef.current?.flyTo(airport.longitude, airport.latitude, 7);
  };
  const clearFilters = () => {
    setFilters(defaultFlightFilters);
    setMapLayers(defaultMapLayers);
  };

  const openStatusPage = () => {
    statusTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLayerPanelOpen(false);
    setFullDetailOpen(false);
    setStatusPageOpen(true);
  };

  const closeStatusPage = () => {
    setStatusPageOpen(false);
  };

  useEffect(() => {
    if (statusPageOpen || statusTriggerRef.current === null) return;
    statusTriggerRef.current.focus();
    statusTriggerRef.current = null;
  }, [statusPageOpen]);

  const locateUser = () => {
    if (!('geolocation' in navigator)) {
      setMapMessage('当前浏览器不支持定位，可继续使用搜索定位机场或航班。');
      return;
    }
    setMapMessage('正在获取当前位置…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        mapRef.current?.flyTo(position.coords.longitude, position.coords.latitude, 8);
        setMapMessage('已定位到当前位置');
      },
      () => setMapMessage('未获得定位权限，可继续使用搜索定位机场或航班。'),
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 },
    );
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Plane size={25} fill="currentColor" />
          <strong>航迹</strong>
        </div>
        <nav role="tablist" aria-label="主要页面">
          <button
            role="tab"
            aria-selected={view === 'live'}
            className={view === 'live' ? 'active' : ''}
            onClick={() => {
              setView('live');
              setFullDetailOpen(false);
              setLayerPanelOpen(false);
            }}
          >
            全球实时
          </button>
          <button
            role="tab"
            aria-selected={view === 'airports'}
            className={view === 'airports' ? 'active' : ''}
            onClick={() => {
              setView('airports');
              setSelectedFlight(null);
              setMobileAirportDetailOpen(false);
              setLayerPanelOpen(false);
              setFullDetailOpen(false);
            }}
          >
            机场
          </button>
          <button
            role="tab"
            aria-selected={view === 'routes'}
            className={view === 'routes' ? 'active' : ''}
            onClick={() => {
              setView('routes');
              setSelectedFlight(null);
              setLayerPanelOpen(false);
              setFullDetailOpen(false);
            }}
          >
            航线
          </button>
        </nav>
        <DataStatus statuses={sourceStatuses} compact onOpen={openStatusPage} />
      </header>

      {statusPageOpen ? (
        <DataStatusPage
          statuses={sourceStatuses}
          connectionState={connectionState}
          flightCount={flights.length}
          lastUpdatedAt={lastUpdatedAt}
          weatherRadarStatus={weatherRadar.status}
          weatherRadarLoading={weatherRadar.loading}
          weatherRadarError={weatherRadar.error}
          onBack={closeStatusPage}
          onRetry={retry}
          onRetryWeather={weatherRadar.retry}
        />
      ) : (
        <section
          className="map-stage"
          role="main"
          aria-label="全球实时航班地图"
          aria-hidden={fullDetailOpen}
          inert={fullDetailOpen ? true : undefined}
        >
          <FlightMap
            ref={mapRef}
            airports={airportState.airports}
            flights={projectedMapFlights}
            selectedFlight={visibleFlight}
            selectedAirport={view === 'airports' ? selectedAirport : null}
            enabled={mapEnabled}
            layers={mapLayers}
            weatherRadar={mapLayers.weatherRadar ? weatherRadar.radar : null}
            weatherRadarTileTemplate={weatherRadar.tileTemplate}
            routeActive={view === 'routes'}
            routeOrigin={routeOrigin}
            routeDestination={routeDestination}
            onFlightSelect={chooseFlight}
            onAirportSelect={chooseAirport}
            onViewportChange={(bbox) => {
              updateViewport(bbox);
              airportState.updateViewport(bbox);
            }}
          />
          {mapLayers.weatherRadar && weatherRadar.radar !== null ? (
            <WeatherRadarLegend radar={weatherRadar.radar} playbackActive={playbackMinutes > 0} />
          ) : null}
          <SearchBox
            airports={airportState.airports}
            flights={flights}
            onFlightSelect={chooseFlight}
            onAirportSelect={chooseAirport}
            placeholder={placeholder}
            statusDegraded={
              sourceStatuses.length === 0 ||
              sourceStatuses.some((status) => status.state !== 'healthy')
            }
            onStatusOpen={openStatusPage}
          />
          <MapControls
            filtersActive={filtersActive}
            onLayersOpen={() => {
              setLayerPanelOpen(true);
            }}
            onLocate={locateUser}
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
          />
          <SystemNotice
            connectionState={connectionState}
            totalFlights={flights.length}
            visibleFlights={view === 'routes' ? flights.length : filteredFlights.length}
            filtersActive={filtersActive}
            sourceStatuses={sourceStatuses}
            onRetry={retry}
            onClearFilters={clearFilters}
          />

          {flightFiltersActive && filteredFlights.length > 0 ? (
            <div className="filter-summary" role="status">
              <span>
                已显示 {filteredFlights.length} / {flights.length} 架航班
              </span>
              <button type="button" onClick={clearFilters}>
                清除筛选
              </button>
            </div>
          ) : null}
          {mapMessage !== null ? (
            <div className="map-message" role="status">
              <span>{mapMessage}</span>
              <button type="button" aria-label="关闭定位提示" onClick={() => setMapMessage(null)}>
                ×
              </button>
            </div>
          ) : null}

          {view === 'airports' && selectedAirport !== null ? (
            <AirportExplorer
              airports={airportState.airports}
              flights={filteredFlights}
              selected={selectedAirport}
              onSelect={chooseAirport}
              onFlightSelect={chooseFlight}
              mobileDetailOpen={mobileAirportDetailOpen}
              onMobileBack={() => setMobileAirportDetailOpen(false)}
              total={airportState.total}
              loading={airportState.loading}
              error={airportState.error}
              hasMore={airportState.nextCursor !== null}
              onLoadMore={airportState.loadMore}
            />
          ) : view === 'airports' ? (
            <section className="explorer-panel airport-list">
              <h1>机场探索</h1>
              <p className="empty-copy">
                {airportState.loading
                  ? '正在加载当前视野机场…'
                  : (airportState.error ?? '当前视野内没有可展示的机场')}
              </p>
            </section>
          ) : null}
          {view === 'routes' ? (
            <RouteExplorer
              airports={airportState.airports}
              flights={filteredFlights}
              origin={routeOrigin}
              destination={routeDestination}
              onOriginChange={setRouteOrigin}
              onDestinationChange={setRouteDestination}
              onFlightSelect={chooseFlight}
              onFocusRoute={() => {
                if (routeOrigin !== null && routeDestination !== null) {
                  mapRef.current?.fitRoute(routeOrigin, routeDestination);
                }
              }}
            />
          ) : null}
          {view === 'live' && visibleFlight !== null ? (
            <FlightPanel
              flight={visibleFlight}
              onClose={() => setSelectedFlight(null)}
              onOpenDetails={() => {
                setLayerPanelOpen(false);
                setFullDetailOpen(true);
              }}
            />
          ) : null}

          {layerPanelOpen ? (
            <LayerFilterPanel
              flights={flights}
              filters={filters}
              layers={mapLayers}
              weatherRadarLoading={weatherRadar.loading}
              onClose={() => setLayerPanelOpen(false)}
              onApply={(nextFilters, nextLayers) => {
                setFilters(nextFilters);
                setMapLayers(nextLayers);
              }}
            />
          ) : null}
          <PlaybackControl
            minutes={playbackMinutes}
            lastUpdatedAt={lastUpdatedAt}
            onChange={setPlaybackMinutes}
          />
        </section>
      )}
      {fullDetailOpen && visibleFlight !== null ? (
        <FlightDetailsPage
          flight={visibleFlight}
          airports={airportState.airports}
          onBack={() => setFullDetailOpen(false)}
        />
      ) : null}
    </main>
  );
}
