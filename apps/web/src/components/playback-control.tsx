import { Radio } from 'lucide-react';

type Props = {
  minutes: number;
  lastUpdatedAt: string | null;
  onChange: (minutes: number) => void;
};

function displayTime(lastUpdatedAt: string | null, minutes: number) {
  if (lastUpdatedAt === null) return '尚无观测时间';
  const value = new Date(lastUpdatedAt);
  value.setMinutes(value.getMinutes() - minutes);
  return `${value.toISOString().slice(11, 19)} UTC`;
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
      <time>{displayTime(lastUpdatedAt, minutes)}</time>
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
