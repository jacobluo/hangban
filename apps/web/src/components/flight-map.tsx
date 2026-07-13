import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

import type { Airport, Bbox, Flight, WeatherRadarAvailableStatus } from '@hangban/contracts';

import { emptyLineData, greatCircleGeometry } from '../lib/map-geometry';
import { type MapLayers } from '../lib/map-settings';
import { resolveMapStyle } from '../lib/map-style';
import { syncWeatherRadarLayer } from '../lib/weather-radar-layer';

export type FlightMapHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (longitude: number, latitude: number, zoom?: number) => void;
  fitRoute: (origin: Airport, destination: Airport) => void;
};

type Props = {
  airports: Airport[];
  flights: Flight[];
  selectedFlight: Flight | null;
  selectedAirport: Airport | null;
  layers: MapLayers;
  weatherRadar: WeatherRadarAvailableStatus | null;
  weatherRadarTileTemplate: string | null;
  routeOrigin: Airport | null;
  routeDestination: Airport | null;
  enabled?: boolean;
  routeActive?: boolean;
  onFlightSelect: (flight: Flight) => void;
  onAirportSelect: (airport: Airport) => void;
  onViewportChange?: (bbox: Bbox) => void;
};

type PointFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, string | number>;
  }>;
};

function flightsToGeoJson(
  flights: Flight[],
  selectedFlight: Flight | null,
): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: flights.map((flight) => ({
      type: 'Feature',
      id: flight.id,
      geometry: { type: 'Point', coordinates: [flight.longitude, flight.latitude] },
      properties: {
        id: flight.id,
        callsign: flight.callsign,
        freshness: flight.freshness,
        selected: flight.id === selectedFlight?.id ? 1 : 0,
        selectionActive: selectedFlight === null ? 0 : 1,
        rotation: (flight.headingDeg ?? 0) - 45,
      },
    })),
  };
}

function airportsToGeoJson(
  airports: Airport[],
  selectedAirport: Airport | null,
): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: airports.map((airport) => {
      const id = airport.icao ?? airport.iata ?? airport.name;
      return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [airport.longitude, airport.latitude] },
        properties: {
          id,
          code: airport.iata ?? airport.icao ?? '—',
          selected: id === (selectedAirport?.icao ?? selectedAirport?.iata) ? 1 : 0,
        },
      };
    }),
  };
}

function trackData(
  selectedFlight: Flight | null,
  airports: Airport[],
  routeActive: boolean,
  routeOrigin: Airport | null,
  routeDestination: Airport | null,
) {
  if (selectedFlight !== null) {
    const origin = airports.find((airport) => airport.iata === selectedFlight.origin);
    const destination = airports.find((airport) => airport.iata === selectedFlight.destination);
    return {
      flown:
        origin === undefined
          ? emptyLineData()
          : {
              type: 'Feature' as const,
              properties: {},
              geometry: greatCircleGeometry(origin, selectedFlight),
            },
      planned:
        destination === undefined
          ? emptyLineData()
          : {
              type: 'Feature' as const,
              properties: {},
              geometry: greatCircleGeometry(selectedFlight, destination),
            },
    };
  }

  if (routeActive && routeOrigin !== null && routeDestination !== null) {
    return {
      flown: emptyLineData(),
      planned: {
        type: 'Feature' as const,
        properties: {},
        geometry: greatCircleGeometry(routeOrigin, routeDestination),
      },
    };
  }

  return { flown: emptyLineData(), planned: emptyLineData() };
}

function setLayerVisibility(map: MapLibreMap, layerId: string, visible: boolean) {
  if (map.getLayer(layerId) !== undefined) {
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  }
}

function createPlaneIcon(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Canvas 2D context is unavailable');
  context.scale(2, 2);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  const plane = new Path2D(
    'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  );
  context.strokeStyle = '#ffffff';
  context.lineWidth = 3.5;
  context.stroke(plane);
  context.fillStyle = color;
  context.fill(plane);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export const FlightMap = forwardRef<FlightMapHandle, Props>(function FlightMap(
  {
    airports,
    flights,
    selectedFlight,
    selectedAirport,
    layers,
    weatherRadar,
    weatherRadarTileTemplate,
    routeOrigin,
    routeDestination,
    enabled = true,
    routeActive = false,
    onFlightSelect,
    onAirportSelect,
    onViewportChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.45);
  const pendingZoomRef = useRef(0);
  const airportsRef = useRef(airports);
  const flightsRef = useRef(flights);
  const selectedFlightRef = useRef(selectedFlight);
  const selectedAirportRef = useRef(selectedAirport);
  const layersRef = useRef(layers);
  const weatherRadarRef = useRef(weatherRadar);
  const weatherRadarTileTemplateRef = useRef(weatherRadarTileTemplate);
  const routeActiveRef = useRef(routeActive);
  const routeOriginRef = useRef(routeOrigin);
  const routeDestinationRef = useRef(routeDestination);
  const flightSelectionRef = useRef(onFlightSelect);
  const airportSelectionRef = useRef(onAirportSelect);
  const viewportRef = useRef(onViewportChange);
  airportsRef.current = airports;
  flightsRef.current = flights;
  selectedFlightRef.current = selectedFlight;
  selectedAirportRef.current = selectedAirport;
  layersRef.current = layers;
  weatherRadarRef.current = weatherRadar;
  weatherRadarTileTemplateRef.current = weatherRadarTileTemplate;
  routeActiveRef.current = routeActive;
  routeOriginRef.current = routeOrigin;
  routeDestinationRef.current = routeDestination;
  flightSelectionRef.current = onFlightSelect;
  airportSelectionRef.current = onAirportSelect;
  viewportRef.current = onViewportChange;

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      if (mapRef.current === null) {
        pendingZoomRef.current += 1;
        setZoomLevel((current) => current + 1);
      } else {
        mapRef.current.zoomIn({ duration: 250 });
      }
    },
    zoomOut: () => {
      if (mapRef.current === null) {
        pendingZoomRef.current -= 1;
        setZoomLevel((current) => Math.max(0, current - 1));
      } else {
        mapRef.current.zoomOut({ duration: 250 });
      }
    },
    flyTo: (longitude, latitude, zoom) =>
      mapRef.current?.flyTo({
        center: [longitude, latitude],
        ...(zoom === undefined ? {} : { zoom }),
        duration: 600,
      }),
    fitRoute: (origin, destination) => {
      const longitudeDifference = destination.longitude - origin.longitude;
      const adjustedDestination =
        longitudeDifference > 180
          ? destination.longitude - 360
          : longitudeDifference < -180
            ? destination.longitude + 360
            : destination.longitude;
      mapRef.current?.fitBounds(
        [
          [
            Math.min(origin.longitude, adjustedDestination),
            Math.min(origin.latitude, destination.latitude),
          ],
          [
            Math.max(origin.longitude, adjustedDestination),
            Math.max(origin.latitude, destination.latitude),
          ],
        ],
        { padding: 100, duration: 650 },
      );
    },
  }));

  useEffect(() => {
    if (!enabled || containerRef.current === null || mapRef.current !== null) return;
    let disposed = false;
    let mountedMap: MapLibreMap | null = null;
    let radarStyleLoadHandler: (() => void) | null = null;
    void import('maplibre-gl').then(({ Map }) => {
      if (disposed || containerRef.current === null) return;
      const map = new Map({
        container: containerRef.current,
        center: [116, 34],
        zoom: 1.45,
        attributionControl: false,
        style: resolveMapStyle(process.env.NEXT_PUBLIC_MAP_STYLE_URL),
      });
      mountedMap = map;
      mapRef.current = map;
      radarStyleLoadHandler = () => {
        if (
          map.getLayer('planned-route') === undefined &&
          map.getLayer('airport-points') === undefined
        ) {
          return;
        }
        syncWeatherRadarLayer(map, weatherRadarRef.current, weatherRadarTileTemplateRef.current);
      };
      map.on('style.load', radarStyleLoadHandler);
      const reportZoom = () => setZoomLevel(map.getZoom());
      map.on('zoomend', reportZoom);
      if (pendingZoomRef.current !== 0) {
        map.setZoom(map.getZoom() + pendingZoomRef.current);
        pendingZoomRef.current = 0;
      }
      map.on('load', () => {
        const currentTracks = trackData(
          selectedFlightRef.current,
          airportsRef.current,
          routeActiveRef.current,
          routeOriginRef.current,
          routeDestinationRef.current,
        );
        map.addSource('flights', {
          type: 'geojson',
          data: flightsToGeoJson(flightsRef.current, selectedFlightRef.current),
        });
        map.addSource('airports', {
          type: 'geojson',
          data: airportsToGeoJson(airportsRef.current, selectedAirportRef.current),
        });
        map.addSource('planned-route', { type: 'geojson', data: currentTracks.planned });
        map.addSource('flown-route', { type: 'geojson', data: currentTracks.flown });
        map.addImage('flight-plane', createPlaneIcon('#0f62fe'), { pixelRatio: 2 });
        map.addImage('flight-plane-selected', createPlaneIcon('#ff6f3d'), { pixelRatio: 2 });

        map.addLayer({
          id: 'planned-route',
          type: 'line',
          source: 'planned-route',
          paint: { 'line-color': '#0f62fe', 'line-width': 2, 'line-dasharray': [3, 2] },
        });
        map.addLayer({
          id: 'flown-route',
          type: 'line',
          source: 'flown-route',
          paint: { 'line-color': '#ff6f3d', 'line-width': 3 },
        });
        map.addLayer({
          id: 'airport-points',
          type: 'circle',
          source: 'airports',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'selected'], 1], 7, 4],
            'circle-color': '#ffffff',
            'circle-stroke-color': '#0f62fe',
            'circle-stroke-width': 2,
          },
        });
        map.addLayer({
          id: 'airport-labels',
          type: 'symbol',
          source: 'airports',
          minzoom: 2.4,
          layout: { 'text-field': ['get', 'code'], 'text-size': 11, 'text-offset': [0, 1.35] },
          paint: { 'text-color': '#102a43', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
        });
        map.addLayer({
          id: 'flight-selection-halo',
          type: 'circle',
          source: 'flights',
          filter: ['==', ['get', 'selected'], 1],
          paint: {
            'circle-radius': 17,
            'circle-color': '#ff6f3d',
            'circle-opacity': 0.14,
            'circle-stroke-color': '#ff6f3d',
            'circle-stroke-width': 1.5,
            'circle-stroke-opacity': 0.5,
          },
        });
        map.addLayer({
          id: 'flight-points',
          type: 'symbol',
          source: 'flights',
          layout: {
            'icon-image': [
              'case',
              ['==', ['get', 'selected'], 1],
              'flight-plane-selected',
              'flight-plane',
            ],
            'icon-size': ['case', ['==', ['get', 'selected'], 1], 1.15, 0.9],
            'icon-rotate': ['get', 'rotation'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
          },
          paint: {
            'icon-opacity': [
              'case',
              ['==', ['get', 'selected'], 1],
              1,
              ['==', ['get', 'selectionActive'], 1],
              0.4,
              ['match', ['get', 'freshness'], 'stale', 0.32, 'delayed', 0.52, 0.72],
            ],
          },
        });
        map.addLayer({
          id: 'flight-labels',
          type: 'symbol',
          source: 'flights',
          minzoom: 2.2,
          layout: { 'text-field': ['get', 'callsign'], 'text-size': 11, 'text-offset': [0, 1.5] },
          paint: { 'text-color': '#102a43', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
        });

        syncWeatherRadarLayer(map, weatherRadarRef.current, weatherRadarTileTemplateRef.current);

        const currentLayers = layersRef.current;
        setLayerVisibility(map, 'osm', currentLayers.baseMap);
        setLayerVisibility(map, 'flight-selection-halo', currentLayers.flights);
        setLayerVisibility(map, 'flight-points', currentLayers.flights);
        setLayerVisibility(map, 'flight-labels', currentLayers.flights && currentLayers.labels);
        setLayerVisibility(map, 'airport-points', currentLayers.airports);
        setLayerVisibility(map, 'airport-labels', currentLayers.airports && currentLayers.labels);
        setLayerVisibility(map, 'planned-route', currentLayers.tracks);
        setLayerVisibility(map, 'flown-route', currentLayers.tracks);

        map.on('click', 'flight-points', (event) => {
          const id = event.features?.[0]?.properties?.id as string | undefined;
          const flight = flightsRef.current.find((item) => item.id === id);
          if (flight !== undefined) flightSelectionRef.current(flight);
        });
        map.on('click', 'airport-points', (event) => {
          const id = event.features?.[0]?.properties?.id as string | undefined;
          const airport = airportsRef.current.find(
            (item) => (item.icao ?? item.iata ?? item.name) === id,
          );
          if (airport !== undefined) airportSelectionRef.current(airport);
        });
        for (const layerId of ['flight-points', 'airport-points']) {
          map.on('mouseenter', layerId, () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', layerId, () => {
            map.getCanvas().style.cursor = '';
          });
        }
        const reportViewport = () => {
          const bounds = map.getBounds();
          viewportRef.current?.([
            Math.max(-180, bounds.getWest()),
            Math.max(-90, bounds.getSouth()),
            Math.min(180, bounds.getEast()),
            Math.min(90, bounds.getNorth()),
          ]);
        };
        reportViewport();
        map.on('moveend', reportViewport);
        reportZoom();
      });
    });
    return () => {
      disposed = true;
      if (mountedMap !== null && radarStyleLoadHandler !== null) {
        mountedMap.off('style.load', radarStyleLoadHandler);
      }
      mountedMap?.remove();
      if (mapRef.current === mountedMap) mapRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource('flights') as GeoJSONSource | undefined;
    source?.setData(flightsToGeoJson(flights, selectedFlight));
    if (map === null || map === undefined || !map.isStyleLoaded()) return;
    const tracks = trackData(selectedFlight, airports, routeActive, routeOrigin, routeDestination);
    (map.getSource('planned-route') as GeoJSONSource | undefined)?.setData(tracks.planned);
    (map.getSource('flown-route') as GeoJSONSource | undefined)?.setData(tracks.flown);
  }, [airports, flights, routeActive, routeDestination, routeOrigin, selectedFlight]);

  useEffect(() => {
    const source = mapRef.current?.getSource('airports') as GeoJSONSource | undefined;
    source?.setData(airportsToGeoJson(airports, selectedAirport));
  }, [airports, selectedAirport]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !map.isStyleLoaded()) return;
    syncWeatherRadarLayer(map, weatherRadar, weatherRadarTileTemplate);
  }, [weatherRadar, weatherRadarTileTemplate]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !map.isStyleLoaded()) return;
    setLayerVisibility(map, 'osm', layers.baseMap);
    setLayerVisibility(map, 'flight-selection-halo', layers.flights);
    setLayerVisibility(map, 'flight-points', layers.flights);
    setLayerVisibility(map, 'flight-labels', layers.flights && layers.labels);
    setLayerVisibility(map, 'airport-points', layers.airports);
    setLayerVisibility(map, 'airport-labels', layers.airports && layers.labels);
    setLayerVisibility(
      map,
      'planned-route',
      layers.tracks && (routeActive || selectedFlight !== null),
    );
    setLayerVisibility(
      map,
      'flown-route',
      layers.tracks && (routeActive || selectedFlight !== null),
    );
  }, [layers, routeActive, selectedFlight]);

  return (
    <>
      <div ref={containerRef} className="flight-map" aria-label="实时航班地图" />
      <output className="sr-only" aria-label="地图缩放级别" aria-live="polite">
        {zoomLevel.toFixed(2)}
      </output>
    </>
  );
});
