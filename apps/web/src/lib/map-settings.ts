export type MapLayers = {
  baseMap: boolean;
  weatherRadar: boolean;
  flights: boolean;
  airports: boolean;
  tracks: boolean;
  labels: boolean;
};

export const defaultMapLayers: MapLayers = {
  baseMap: true,
  weatherRadar: false,
  flights: true,
  airports: true,
  tracks: true,
  labels: true,
};
