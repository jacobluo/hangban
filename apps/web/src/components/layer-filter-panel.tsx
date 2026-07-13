import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { Flight } from '@hangban/contracts';

import { defaultFlightFilters, filterFlights, type FlightFilters } from '../lib/flight-filters';
import { defaultMapLayers, type MapLayers } from '../lib/map-settings';

type Props = {
  flights: Flight[];
  filters: FlightFilters;
  layers: MapLayers;
  weatherRadarLoading: boolean;
  onApply: (filters: FlightFilters, layers: MapLayers) => void;
  onClose: () => void;
};

const layerOptions: Array<{ key: keyof MapLayers; label: string }> = [
  { key: 'baseMap', label: '航空底图' },
  { key: 'flights', label: '实时航班' },
  { key: 'airports', label: '机场与代码' },
  { key: 'tracks', label: '最近 15 分钟航迹' },
  { key: 'labels', label: '地图标签' },
  { key: 'weatherRadar', label: '天气雷达' },
];

const freshnessOptions: Array<{ value: Flight['freshness']; label: string }> = [
  { value: 'live', label: '实时' },
  { value: 'delayed', label: '延迟' },
  { value: 'stale', label: '过期' },
];

export function LayerFilterPanel({
  flights,
  filters,
  layers,
  weatherRadarLoading,
  onApply,
  onClose,
}: Props) {
  const [draftFilters, setDraftFilters] = useState<FlightFilters>(() => ({
    ...filters,
    freshness: [...filters.freshness],
  }));
  const [draftLayers, setDraftLayers] = useState<MapLayers>(layers);
  const airlines = useMemo(
    () => [...new Set(flights.map((flight) => flight.airline).filter(Boolean))].toSorted(),
    [flights],
  );
  const resultCount = filterFlights(flights, draftFilters).length;

  useEffect(() => {
    setDraftLayers(layers);
  }, [layers]);

  const applyFilters = (next: FlightFilters) => {
    setDraftFilters(next);
    onApply(next, draftLayers);
  };

  const applyLayers = (next: MapLayers) => {
    setDraftLayers(next);
    onApply(draftFilters, next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const toggleFreshness = (value: Flight['freshness']) => {
    applyFilters({
      ...draftFilters,
      freshness: draftFilters.freshness.includes(value)
        ? draftFilters.freshness.filter((item) => item !== value)
        : [...draftFilters.freshness, value],
    });
  };

  return (
    <aside
      className="detail-panel settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="layer-panel-title"
    >
      <div className="panel-heading settings-heading">
        <h2 id="layer-panel-title">筛选与图层</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="关闭筛选与图层"
          autoFocus
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      <fieldset className="settings-group">
        <legend>地图图层</legend>
        {layerOptions.map((option) => (
          <label
            className={`switch-row${option.key === 'weatherRadar' && weatherRadarLoading ? ' disabled-row' : ''}`}
            key={option.key}
          >
            <span>{option.label}</span>
            <input
              type="checkbox"
              checked={draftLayers[option.key]}
              disabled={option.key === 'weatherRadar' && weatherRadarLoading}
              aria-label={
                option.key === 'weatherRadar' && weatherRadarLoading ? '天气雷达加载中' : undefined
              }
              onChange={(event) =>
                applyLayers({
                  ...draftLayers,
                  [option.key]: event.target.checked,
                })
              }
            />
          </label>
        ))}
      </fieldset>

      <fieldset className="settings-group filter-settings">
        <legend>航班筛选</legend>
        <label className="range-field">
          <span>
            最大高度 <strong>{draftFilters.maxAltitudeM.toLocaleString('zh-CN')} m</strong>
          </span>
          <input
            type="range"
            min="1000"
            max="13000"
            step="1000"
            value={draftFilters.maxAltitudeM}
            aria-label="最大高度"
            onChange={(event) =>
              applyFilters({
                ...draftFilters,
                maxAltitudeM: Number(event.target.value),
              })
            }
          />
        </label>

        <div className="freshness-options" aria-label="数据新鲜度">
          {freshnessOptions.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={draftFilters.freshness.includes(option.value)}
                onChange={() => toggleFreshness(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>

        <label className="select-field">
          <span>航空公司</span>
          <select
            aria-label="航空公司"
            value={draftFilters.airline}
            onChange={(event) => applyFilters({ ...draftFilters, airline: event.target.value })}
          >
            <option value="">全部航空公司</option>
            {airlines.map((airline) => (
              <option key={airline} value={airline}>
                {airline}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div className="settings-actions">
        <button
          className="secondary-button"
          type="button"
          aria-label="重置筛选"
          onClick={() => {
            const nextFilters = {
              ...defaultFlightFilters,
              freshness: [...defaultFlightFilters.freshness],
            };
            setDraftFilters(nextFilters);
            setDraftLayers(defaultMapLayers);
            onApply(nextFilters, defaultMapLayers);
          }}
        >
          重置
        </button>
        <output aria-live="polite">当前显示 {resultCount} 架航班</output>
      </div>
    </aside>
  );
}
