export type MapLayers = {
  baseMap: boolean;
  flights: boolean;
  airports: boolean;
  tracks: boolean;
  labels: boolean;
};

export const defaultMapLayers: MapLayers = {
  baseMap: true,
  flights: true,
  airports: true,
  tracks: true,
  labels: true,
};
