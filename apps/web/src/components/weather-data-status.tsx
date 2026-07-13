import type { WeatherRadarStatus } from '@hangban/contracts';

type Props = {
  status: WeatherRadarStatus | null;
  loading: boolean;
  error: string | null;
};

const unavailableCopy = {
  DISABLED: ['服务未启用', '服务端尚未启用天气雷达'],
  UPSTREAM_UNAVAILABLE: ['暂不可用', 'RainViewer 当前无法提供有效状态'],
  NO_VALID_FRAME: ['暂无有效雷达帧', '上游响应中没有可使用的雷达帧'],
  FRAME_EXPIRED: ['缓存已过期', '最近缓存帧已超过 24 小时有效范围'],
} as const;

const freshnessCopy = {
  latest: ['最新', '雷达帧处于当前天气窗口内'],
  delayed: ['数据延迟', '雷达帧存在延迟，请结合帧时间判断'],
  'historical-cache': ['非当前天气', '缓存帧仅供参考，不能作为当前天气判断'],
} as const;

const frameTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function WeatherDataStatus({ status, loading, error }: Props) {
  const copy = loading
    ? ['正在检查', '正在获取天气雷达状态']
    : status?.available === true
      ? freshnessCopy[status.freshness]
      : status?.available === false
        ? unavailableCopy[status.reason]
        : error === null
          ? ['尚未检查', '打开状态页后检查天气雷达状态']
          : ['检查失败', '天气雷达状态检查失败，可以重新获取数据'];
  const frameTime =
    status?.available === true
      ? `${frameTimeFormatter.format(new Date(status.frameTime))} UTC`
      : '当前没有可用帧时间';
  const attribution =
    status?.available === true
      ? status.attribution
      : {
          label: 'Weather radar by RainViewer',
          url: 'https://www.rainviewer.com/',
        };
  const stateClass = loading
    ? 'checking'
    : status?.available === true
      ? status.freshness === 'latest'
        ? 'healthy'
        : 'delayed'
      : status?.available === false || error !== null
        ? 'down'
        : 'checking';

  return (
    <section className="weather-data-status" role="region" aria-label="天气数据" aria-live="polite">
      <header className="weather-status-heading">
        <div>
          <h3>天气数据</h3>
          <span>可选能力</span>
        </div>
        <strong className={`weather-status-badge ${stateClass}`}>{copy[0]}</strong>
      </header>
      <p className="weather-status-provider">
        供应商 <strong>RainViewer</strong>
      </p>
      <dl className="weather-status-details">
        <div>
          <dt>雷达帧时间</dt>
          <dd>{frameTime}</dd>
        </div>
        <div>
          <dt>状态说明</dt>
          <dd>{copy[1]}</dd>
        </div>
      </dl>
      <p className="weather-status-note">雷达帧时间不代表所有区域的精确观测时间。</p>
      <a
        className="weather-status-attribution"
        href={attribution.url}
        target="_blank"
        rel="noreferrer"
      >
        {attribution.label}
      </a>
    </section>
  );
}
