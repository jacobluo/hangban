import { Radio } from 'lucide-react';

import { BrowserTime } from './browser-time';

type Props = {
  minutes: number;
  lastUpdatedAt: string | null;
  onChange: (minutes: number) => void;
};

function playbackTime(lastUpdatedAt: string | null, minutes: number) {
  if (lastUpdatedAt === null) return null;
  const timestamp = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp - minutes * 60_000).toISOString();
}

export function PlaybackControl({ minutes, lastUpdatedAt, onChange }: Props) {
  return (
    <footer className="playback" aria-label="短时航迹回看">
      <strong>航迹回看</strong>
      <output aria-live="polite">{minutes === 0 ? '实时位置' : `${minutes} 分钟前`}</output>
      <input
        type="range"
        min="0"
        max="15"
        step="1"
        value={minutes}
        aria-label="航迹回看时间"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <BrowserTime value={playbackTime(lastUpdatedAt, minutes)} fallback="尚无观测时间" />
      {minutes === 0 ? (
        <span className="live-playback-state">
          <Radio size={13} /> 实时
        </span>
      ) : (
        <button type="button" aria-label="返回实时位置" onClick={() => onChange(0)}>
          返回实时
        </button>
      )}
    </footer>
  );
}
