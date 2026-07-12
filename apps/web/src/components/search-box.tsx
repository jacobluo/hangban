import { Search, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import type { Airport, Flight } from '@hangban/contracts';
import { searchAirports } from '../lib/api-client';

type Props = {
  airports: Airport[];
  flights: Flight[];
  onFlightSelect: (flight: Flight) => void;
  onAirportSelect: (airport: Airport) => void;
  placeholder?: string;
  statusDegraded?: boolean;
  onStatusOpen?: () => void;
};

export function SearchBox({
  airports,
  flights,
  onFlightSelect,
  onAirportSelect,
  placeholder = '搜索航班、机场或城市',
  statusDegraded = false,
  onStatusOpen,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleUpperCase());
  const [globalAirports, setGlobalAirports] = useState<Airport[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  useEffect(() => {
    if (!query.trim()) {
      setGlobalAirports(null);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchAirports(query.trim(), controller.signal)
        .then((result) => {
          setGlobalAirports(result);
          setSearchError(false);
        })
        .catch((reason: unknown) => {
          if (!(reason instanceof DOMException && reason.name === 'AbortError'))
            setSearchError(true);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const results = useMemo(() => {
    if (deferredQuery.length === 0) return { flights: [], airports: [] };
    return {
      flights: flights
        .filter((flight) =>
          [
            flight.callsign,
            flight.airline ?? '',
            flight.origin ?? '',
            flight.destination ?? '',
          ].some((value) => value.toLocaleUpperCase().includes(deferredQuery)),
        )
        .slice(0, 4),
      airports: (globalAirports ?? airports)
        .filter((airport) =>
          [
            airport.iata ?? '',
            airport.icao ?? '',
            airport.name,
            airport.city,
            airport.localizedCity ?? '',
          ].some((value) => value.toLocaleUpperCase().includes(deferredQuery)),
        )
        .slice(0, 4),
    };
  }, [airports, deferredQuery, flights, globalAirports]);
  const open = query.trim().length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.key === 'Escape' && query.length > 0) {
        setQuery('');
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [query]);

  return (
    <div className="search-wrap">
      <div className="search-field">
        <Search aria-hidden="true" size={21} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label="搜索航班、机场或城市"
        />
        {query.length > 0 ? (
          <button
            className="icon-button clear-search"
            type="button"
            aria-label="清除搜索"
            onClick={() => setQuery('')}
          >
            <X size={17} />
          </button>
        ) : (
          <>
            <kbd>⌘ K</kbd>
            {onStatusOpen === undefined ? null : (
              <button
                className="mobile-status-trigger"
                type="button"
                aria-label="打开数据状态"
                onClick={onStatusOpen}
              >
                <span className={statusDegraded ? 'status-dot delayed' : 'status-dot'} />
              </button>
            )}
          </>
        )}
      </div>
      {open ? (
        <div className="search-results" aria-label="搜索结果">
          {results.flights.length === 0 && results.airports.length === 0 ? (
            <p className="empty-copy">
              {searchError ? '全球搜索暂时不可用，请稍后重试' : '未找到对应航班或机场'}
            </p>
          ) : null}
          {results.flights.length > 0 ? <p className="result-label">航班</p> : null}
          {results.flights.map((flight) => (
            <button
              key={flight.id}
              type="button"
              aria-label={`${flight.callsign} ${flight.airline ?? '航空公司未知'}`}
              onClick={() => {
                onFlightSelect(flight);
                setQuery('');
              }}
            >
              <strong>{flight.callsign}</strong>
              <span>
                {flight.airline ?? '航空公司未知'} · {flight.origin ?? '—'} TO{' '}
                {flight.destination ?? '—'}
              </span>
            </button>
          ))}
          {results.airports.length > 0 ? <p className="result-label">机场</p> : null}
          {results.airports.map((airport) => (
            <button
              key={airport.icao ?? airport.iata}
              type="button"
              aria-label={`${airport.name} ${airport.iata ?? airport.icao}`}
              onClick={() => {
                onAirportSelect(airport);
                setQuery('');
              }}
            >
              <strong>{airport.iata ?? airport.icao}</strong>
              <span>
                {airport.name} · {airport.localizedCity ?? airport.city}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
