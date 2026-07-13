import type { SourceStatus } from '@hangban/contracts';

type Props = { statuses: SourceStatus[]; compact?: boolean; onOpen: () => void };

export function DataStatus({ statuses, compact = false, onOpen }: Props) {
  const healthy = statuses.filter((status) => status.state === 'healthy').length;
  const degraded = statuses.some((status) => status.state !== 'healthy');
  const latestSuccess = statuses
    .flatMap((status) => (status.lastSuccessAt === null ? [] : [status.lastSuccessAt]))
    .sort()
    .at(-1);
  const updatedAt =
    latestSuccess === undefined
      ? '更新时间未知'
      : `${new Date(latestSuccess).toISOString().slice(11, 16)} UTC 更新`;
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
        {healthy}/{statuses.length} 来源正常 · {updatedAt}
      </span>
    </button>
  );
}
