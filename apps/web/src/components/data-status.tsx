import type { SourceStatus } from '@hangban/contracts';

type Props = { statuses: SourceStatus[]; compact?: boolean; onOpen: () => void };

export function DataStatus({ statuses, compact = false, onOpen }: Props) {
  const healthy = statuses.filter((status) => status.state === 'healthy').length;
  const degraded = statuses.some((status) => status.state !== 'healthy');
  return (
    <button
      type="button"
      className={compact ? 'data-status compact' : 'data-status'}
      aria-label="实时数据状态"
      onClick={onOpen}
    >
      <span className={degraded ? 'status-dot delayed' : 'status-dot'} />
      <strong>{degraded ? '部分数据延迟' : '实时数据'}</strong>
      <span>
        {healthy}/{statuses.length} 来源正常
      </span>
    </button>
  );
}
