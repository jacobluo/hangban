import type { SourceStatus } from '@hangban/contracts';

import { BrowserTime } from './browser-time';

type Props = { statuses: SourceStatus[]; compact?: boolean; onOpen: () => void };

export function DataStatus({ statuses, compact = false, onOpen }: Props) {
  const statusUnavailable = statuses.length === 0;
  const healthy = statuses.filter((status) => status.state === 'healthy').length;
  const degraded = statuses.some((status) => status.state !== 'healthy');
  const latestSuccess = statuses
    .flatMap((status) => (status.lastSuccessAt === null ? [] : [status.lastSuccessAt]))
    .sort()
    .at(-1);
  return (
    <button
      type="button"
      className={compact ? 'data-status compact' : 'data-status'}
      aria-label={
        statusUnavailable
          ? '实时位置，等待来源状态'
          : degraded
            ? '实时位置，部分覆盖'
            : '实时位置，数据正常'
      }
      onClick={onOpen}
    >
      <span className={degraded || statusUnavailable ? 'status-dot delayed' : 'status-dot'} />
      <strong>{statusUnavailable ? '等待状态' : degraded ? '部分覆盖' : '实时位置'}</strong>
      <span>
        {statusUnavailable ? '尚未获得来源状态' : `${healthy}/${statuses.length} 来源正常`} ·{' '}
        {latestSuccess === undefined ? (
          '更新时间未知'
        ) : (
          <>
            <BrowserTime value={latestSuccess} /> 更新
          </>
        )}
      </span>
    </button>
  );
}
