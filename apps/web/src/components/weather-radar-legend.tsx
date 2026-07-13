import type { WeatherRadarAvailableStatus } from '@hangban/contracts';

type Props = {
  radar: WeatherRadarAvailableStatus;
  playbackActive: boolean;
};

const frameTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
});

const SCALE_SEGMENTS = 5;

function radarStatusText(radar: WeatherRadarAvailableStatus) {
  if (radar.freshness === 'historical-cache') {
    const ageHours = Math.max(
      1,
      Math.floor((Date.now() - new Date(radar.frameTime).getTime()) / (60 * 60_000)),
    );
    return `非当前天气 · ${ageHours} 小时前`;
  }

  const frameTime = frameTimeFormatter.format(new Date(radar.frameTime));
  return radar.freshness === 'latest' ? `最新 · ${frameTime}` : `数据延迟 · ${frameTime}`;
}

export function WeatherRadarLegend({ radar, playbackActive }: Props) {
  const historical = radar.freshness === 'historical-cache';
  return (
    <aside
      className={`weather-radar-legend${playbackActive ? ' weather-radar-legend--playback-active' : ''}${historical ? ' weather-radar-legend--historical' : ''}`}
      role="region"
      aria-label="天气雷达图例"
    >
      <header>
        <strong>天气雷达</strong>
        <span>{radarStatusText(radar)}</span>
      </header>
      <div className="weather-radar-scale" aria-label="天气雷达强度，从弱到强">
        <div className="weather-radar-scale__bar" aria-hidden="true">
          {Array.from({ length: SCALE_SEGMENTS }, (_, index) => (
            <i key={index} data-testid="weather-radar-scale-segment" />
          ))}
        </div>
        <div className="weather-radar-scale__labels">
          <span>弱</span>
          <span>中</span>
          <span>强</span>
        </div>
      </div>
      <a
        className="weather-radar-attribution"
        href={radar.attribution.url}
        target="_blank"
        rel="noreferrer"
      >
        {radar.attribution.label}
      </a>
    </aside>
  );
}
