import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { Airport } from '@hangban/contracts';
import { searchAirports } from '../lib/api-client';

type Props = {
  kind: 'origin' | 'destination';
  airports: Airport[];
  selected: Airport | null;
  onSelect: (airport: Airport) => void;
  onClose: () => void;
};

export function AirportPicker({ kind, airports, selected, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [globalResults, setGlobalResults] = useState<Airport[] | null>(null);
  const [loading, setLoading] = useState(false);
  const label = kind === 'origin' ? '出发机场' : '到达机场';
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleUpperCase();
    if (normalized.length === 0) return airports;
    return (globalResults ?? airports).filter((airport) =>
      [
        airport.iata ?? '',
        airport.icao ?? '',
        airport.name,
        airport.city,
        airport.localizedCity ?? '',
        airport.country,
      ].some((value) => value.toLocaleUpperCase().includes(normalized)),
    );
  }, [airports, globalResults, query]);

  useEffect(() => {
    if (!query.trim()) {
      setGlobalResults(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void searchAirports(query.trim(), controller.signal)
        .then(setGlobalResults)
        .catch(() => setGlobalResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="airport-picker" aria-label={`${label}选择器`}>
      <div className="airport-picker-search">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={query}
          autoFocus
          aria-label={`搜索${label}`}
          placeholder={`搜索代码、机场或城市`}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" aria-label={`关闭${label}选择器`} onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="airport-option-list" role="listbox" aria-label={`${label}选项`}>
        {loading ? <p className="empty-copy">正在全球搜索机场…</p> : null}
        {!loading && results.length === 0 ? (
          <p className="empty-copy">未找到对应机场，可修改关键字。</p>
        ) : results.length > 0 ? (
          results.map((airport) => (
            <button
              type="button"
              role="option"
              aria-selected={(airport.icao ?? airport.iata) === (selected?.icao ?? selected?.iata)}
              aria-label={`${airport.iata ?? airport.icao} ${airport.name} ${airport.city}`}
              key={airport.icao ?? airport.iata}
              onClick={() => onSelect(airport)}
            >
              <strong>{airport.iata ?? airport.icao}</strong>
              <span>{airport.name}</span>
              <small>
                {airport.city} · {airport.country}
              </small>
            </button>
          ))
        ) : null}
      </div>
    </div>
  );
}
