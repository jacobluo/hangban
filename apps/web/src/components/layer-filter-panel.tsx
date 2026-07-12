import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { Flight } from '@hangban/contracts';

import { defaultFlightFilters, filterFlights, type FlightFilters } from '../lib/flight-filters';
import { defaultMapLayers, type MapLayers } from '../lib/map-settings';

type Props = {
  flights: Flight[];
  filters: FlightFilters;
  layers: MapLayers;
  onApply: (filters: FlightFilters, layers: MapLayers) => void;
  onClose: () => void;
};

const layerOptions: Array<{ key: keyof MapLayers; label: string }> = [
  { key: 'baseMap', label: '航空底图' },
  { key: 'flights', label: '实时航班' },
  { key: 'airports', label: '机场与代码' },
  { key: 'tracks', label: '最近 15 分钟航迹' },
  { key: 'labels', label: '地图标签' },
];

const freshnessOptions: Array<{ value: Flight['freshness']; label: string }> = [
  { value: 'live', label: '实时' },
  { value: 'delayed', label: '延迟' },
  { value: 'stale', label: '过期' },
];

export function LayerFilterPanel({ flights, filters, layers, onApply, onClose }: Props) {
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const toggleFreshness = (value: Flight['freshness']) => {
    setDraftFilters((current) => ({
      ...current,
      freshness: current.freshness.includes(value)
        ? current.freshness.filter((item) => item !== value)
        : [...current.freshness, value],
    }));
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
        <button className="icon-button" type="button" aria-label="关闭筛选与图层" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <fieldset className="settings-group">
        <legend>地图图层</legend>
        {layerOptions.map((option) => (
          <label className="switch-row" key={option.key}>
            <span>{option.label}</span>
            <input
              type="checkbox"
              checked={draftLayers[option.key]}
              onChange={(event) =>
                setDraftLayers((current) => ({
                  ...current,
                  [option.key]: event.target.checked,
                }))
              }
            />
          </label>
        ))}
        <label className="switch-row disabled-row">
          <span>天气雷达</span>
          <input type="checkbox" disabled aria-label="天气雷达，当前不可用" />
        </label>
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
              setDraftFilters((current) => ({
                ...current,
                maxAltitudeM: Number(event.target.value),
              }))
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
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, airline: event.target.value }))
            }
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
            setDraftFilters({
              ...defaultFlightFilters,
              freshness: [...defaultFlightFilters.freshness],
            });
            setDraftLayers(defaultMapLayers);
          }}
        >
          重置
        </button>
        <button
          className="primary-button"
          type="button"
          aria-label={`应用筛选，显示 ${resultCount} 架航班`}
          onClick={() => onApply(draftFilters, draftLayers)}
        >
          显示 {resultCount} 架航班
        </button>
      </div>
    </aside>
  );
}
