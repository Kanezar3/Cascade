import type { LiveTxStatus, TrackedTxRecord, TxStage } from '../types/cascade'

export const TRACKED_TXS_STORAGE_KEY = 'cascade_tracked_txs_v1'

export const TX_STAGE_ORDER: TxStage[] = [
  'submitted',
  'pending',
  'proposing',
  'accepted',
  'finalized-success',
]

/**
 * Maps a raw GenLayer getTransaction response into normalized lifecycle stage + appeal window state.
 */
export function mapGenLayerTxStage(
  hash: string,
  rawTx: Record<string, unknown> | null | undefined
): LiveTxStatus {
  if (!rawTx) {
    return {
      hash,
      stage: 'pending',
      statusName: 'PENDING',
      executionResultName: 'UNKNOWN',
      isFinalized: false,
      isAppealable: false,
      appealWindowSecondsRemaining: null,
      appealed: false,
    }
  }

  const rawStatus = rawTx.status ?? rawTx.statusName ?? ''
  const statusStr = String(rawStatus).toUpperCase()
  const statusNum = typeof rawStatus === 'number' ? rawStatus : Number.NaN

  const consensusData = (rawTx.consensus_data ?? {}) as Record<string, unknown>
  const leaderReceipts = Array.isArray(consensusData.leader_receipt)
    ? (consensusData.leader_receipt as Record<string, unknown>[])
    : []
  const leaderExecResult = String(
    leaderReceipts[0]?.execution_result ??
      rawTx.execution_result ??
      rawTx.executionResultName ??
      'UNKNOWN'
  ).toUpperCase()

  const appealed = Boolean(rawTx.appealed ?? false)
  const appealWindowEnd =
    typeof rawTx.appeal_window_end === 'number'
      ? rawTx.appeal_window_end
      : typeof rawTx.timestamp_appeal === 'number'
        ? rawTx.timestamp_appeal
        : null

  const nowSec = Math.floor(Date.now() / 1000)
  const remaining =
    appealWindowEnd !== null ? Math.max(0, appealWindowEnd - nowSec) : null

  let stage: TxStage = 'pending'
  let statusName = statusStr || 'PENDING'
  let isFinalized = false
  let isAppealable = false

  if (statusNum === 7 || statusStr.includes('FINALIZED')) {
    statusName = 'FINALIZED'
    isFinalized = true
    if (leaderExecResult === 'ERROR' || leaderExecResult.includes('FAIL')) {
      stage = 'finalized-error'
    } else {
      stage = 'finalized-success'
    }
  } else if (statusNum === 6 || statusStr.includes('ACCEPTED')) {
    statusName = 'ACCEPTED'
    stage = 'accepted'
    isAppealable = !appealed
  } else if (
    statusNum === 4 ||
    statusNum === 5 ||
    statusStr.includes('PROPOS') ||
    statusStr.includes('COMMIT') ||
    statusStr.includes('REVEAL')
  ) {
    statusName = statusStr || 'PROPOSING'
    stage = 'proposing'
  } else if (statusNum === 1 || statusNum === 2 || statusNum === 3 || statusStr.includes('PENDING')) {
    statusName = statusStr || 'PENDING'
    stage = 'pending'
  } else if (statusStr.includes('UNDETERMINED') || statusStr.includes('APPEAL')) {
    statusName = statusStr
    stage = 'accepted'
    isAppealable = !appealed
  } else if (statusStr === 'SUBMITTED' || statusNum === 0) {
    statusName = 'SUBMITTED'
    stage = 'submitted'
  }

  return {
    hash,
    stage,
    statusName,
    executionResultName: leaderExecResult,
    isFinalized,
    isAppealable,
    appealWindowSecondsRemaining: remaining,
    appealed,
    timestamp: typeof rawTx.created_at === 'number' ? rawTx.created_at : undefined,
    blockNumber: typeof rawTx.block_number === 'number' ? rawTx.block_number : null,
    raw: rawTx,
  }
}

export function loadTrackedTxs(): TrackedTxRecord[] {
  if (typeof globalThis.localStorage === 'undefined') return []
  try {
    const raw = globalThis.localStorage.getItem(TRACKED_TXS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TrackedTxRecord[]) : []
  } catch {
    return []
  }
}

export function saveTrackedTxs(records: TrackedTxRecord[]): void {
  if (typeof globalThis.localStorage === 'undefined') return
  try {
    globalThis.localStorage.setItem(TRACKED_TXS_STORAGE_KEY, JSON.stringify(records))
  } catch {
    // ignore quota errors
  }
}

export function upsertTrackedTx(record: TrackedTxRecord): TrackedTxRecord[] {
  const current = loadTrackedTxs()
  const idx = current.findIndex(
    (item) => item.hash.toLowerCase() === record.hash.toLowerCase()
  )
  const next =
    idx >= 0
      ? current.map((item, i) => (i === idx ? { ...item, ...record } : item))
      : [record, ...current]
  saveTrackedTxs(next)
  return next
}

export function removeTrackedTx(hash: string): TrackedTxRecord[] {
  const next = loadTrackedTxs().filter(
    (item) => item.hash.toLowerCase() !== hash.toLowerCase()
  )
  saveTrackedTxs(next)
  return next
}
