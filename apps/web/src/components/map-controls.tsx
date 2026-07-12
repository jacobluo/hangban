import { Crosshair, Layers3, Minus, Plus } from 'lucide-react';

type Props = {
  filtersActive: boolean;
  onLayersOpen: () => void;
  onLocate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function MapControls({ filtersActive, onLayersOpen, onLocate, onZoomIn, onZoomOut }: Props) {
  return (
    <div className="map-tools" aria-label="地图控制">
      <button
        type="button"
        aria-label="打开图层与筛选"
        aria-pressed={filtersActive}
        className={filtersActive ? 'control-active' : ''}
        onClick={onLayersOpen}
      >
        <Layers3 size={20} />
      </button>
      <button type="button" aria-label="定位到当前位置" onClick={onLocate}>
        <Crosshair size={20} />
      </button>
      <button type="button" aria-label="放大" onClick={onZoomIn}>
        <Plus size={19} />
      </button>
      <button type="button" aria-label="缩小" onClick={onZoomOut}>
        <Minus size={19} />
      </button>
    </div>
  );
}
