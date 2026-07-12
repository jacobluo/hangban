import type { SourceStatus } from '@hangban/contracts';

type Props = { statuses: SourceStatus[]; compact?: boolean; onOpen: () => void };

export function DataStatus({ statuses, compact = false, onOpen }: Props) {
  const healthy = statuses.filter((status) => status.state === 'healthy').length;
  const degraded = statuses.some((status) => status.state !== 'healthy');
  return (
    <button
      type="button"
      className={compact ? 'data-status compact' : 'data-status'}
      aria-label={degraded ? '实时位置，部分覆盖' : '实时位置，数据正常'}
      onClick={onOpen}
    >
      <span className={degraded ? 'status-dot delayed' : 'status-dot'} />
      <strong>{degraded ? '部分覆盖' : '实时位置'}</strong>
      <span>
        {healthy}/{statuses.length} 来源正常
      </span>
    </button>
  );
}
