CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE cities (
  geonames_id bigint PRIMARY KEY,
  name text NOT NULL,
  ascii_name text NOT NULL,
  localized_name text,
  country char(2) NOT NULL,
  population bigint NOT NULL CHECK (population >= 0),
  location geography(Point, 4326) NOT NULL,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cities_location_gist ON cities USING gist (location);
CREATE INDEX cities_country_name_idx ON cities (country, lower(name));
CREATE INDEX cities_ascii_name_trgm ON cities USING gin (lower(ascii_name) gin_trgm_ops);
CREATE INDEX cities_localized_name_trgm ON cities USING gin (lower(localized_name) gin_trgm_ops);

CREATE TABLE city_aliases (
  geonames_id bigint NOT NULL REFERENCES cities(geonames_id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL,
  PRIMARY KEY (geonames_id, normalized_alias)
);
CREATE INDEX city_aliases_normalized_trgm ON city_aliases USING gin (normalized_alias gin_trgm_ops);

CREATE TABLE airports (
  airport_key text PRIMARY KEY,
  iata char(3),
  icao varchar(4),
  name text NOT NULL,
  city text NOT NULL,
  localized_city text,
  country char(2) NOT NULL,
  elevation_m integer,
  airport_type text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  source text NOT NULL,
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX airports_iata_unique ON airports (iata) WHERE iata IS NOT NULL;
CREATE UNIQUE INDEX airports_icao_unique ON airports (icao) WHERE icao IS NOT NULL;
CREATE INDEX airports_location_gist ON airports USING gist (location);
CREATE INDEX airports_name_trgm ON airports USING gin (lower(name) gin_trgm_ops);
CREATE INDEX airports_city_trgm ON airports USING gin (lower(city) gin_trgm_ops);
CREATE INDEX airports_localized_city_trgm ON airports USING gin (lower(localized_city) gin_trgm_ops);

CREATE TABLE airport_aliases (
  airport_key text NOT NULL REFERENCES airports(airport_key) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL,
  PRIMARY KEY (airport_key, normalized_alias)
);
CREATE INDEX airport_aliases_normalized_trgm ON airport_aliases USING gin (normalized_alias gin_trgm_ops);

CREATE TABLE static_imports (
  source text PRIMARY KEY,
  source_version text NOT NULL,
  record_count integer NOT NULL CHECK (record_count >= 0),
  imported_at timestamptz NOT NULL DEFAULT now()
);
