import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react'
import type { NormalizedProof, TrackedTxRecord, TxStage } from '../types/cascade'
import {
  fetchTransactionStatus,
  STUDIONET_EXPLORER_BASE,
} from '../lib/genlayerClient'
import {
  loadTrackedTxs,
  removeTrackedTx,
  saveTrackedTxs,
  TX_STAGE_ORDER,
  upsertTrackedTx,
} from '../lib/txTracker'
import { AppealWindowPanel } from './AppealWindowPanel'

interface TxLifecycleMonitorProps {
  proof: NormalizedProof
  walletAddress: string | null
}

const STAGE_LABELS: Record<TxStage, string> = {
  submitted: 'Submitted',
  pending: 'Pending',
  proposing: 'Proposing',
  accepted: 'Accepted',
  'finalized-success': 'Finalized',
  'finalized-error': 'Finalized (Err)',
}

function getStageIndex(stage: TxStage): number {
  if (stage === 'finalized-error') return 4
  const idx = TX_STAGE_ORDER.indexOf(stage)
  return idx >= 0 ? idx : 1
}

export function TxLifecycleMonitor({ proof, walletAddress }: TxLifecycleMonitorProps) {
  const [tracked, setTracked] = useState<TrackedTxRecord[]>(() => loadTrackedTxs())
  const [manualHash, setManualHash] = useState('')
  const [manualLabel, setManualLabel] = useState('')
  const [polling, setPolling] = useState(false)
  const [autoPoll, setAutoPoll] = useState(true)
  const [lastPollAt, setLastPollAt] = useState<number | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)

  const proofTxs = useMemo(() => {
    const items: Array<{ hash: string; label: string; action: string; caseId: string }> = []
    const seen = new Set<string>()
    for (const c of proof.cases) {
      const candidates: Array<{ hash: string; suffix: string; action: string }> = [
        { hash: c.pool_tx_hash, suffix: 'Pool', action: 'open_indemnity_pool' },
        { hash: c.tx_hash, suffix: c.action, action: c.action },
        { hash: c.expiry_tx_hash, suffix: 'Expiry', action: 'settle_expired_pool' },
        { hash: c.withdraw_tx_hash, suffix: 'Withdraw', action: 'withdraw_refundable' },
      ]
      for (const cand of candidates) {
        if (cand.hash && cand.hash.startsWith('0x') && !seen.has(cand.hash.toLowerCase())) {
          seen.add(cand.hash.toLowerCase())
          items.push({
            hash: cand.hash,
            label: `${c.exhibit_code} · ${c.label} (${cand.suffix})`,
            action: cand.action,
            caseId: c.case_id,
          })
        }
      }
    }
    return items
  }, [proof.cases])

  async function pollAll(recordsToPoll?: TrackedTxRecord[]) {
    const list = recordsToPoll ?? tracked
    if (list.length === 0) return
    setPolling(true)
    try {
      const updated = await Promise.all(
        list.map(async (item) => {
          try {
            const status = await fetchTransactionStatus(item.hash)
            return { ...item, lastCheckedAt: Date.now(), status }
          } catch (err) {
            return {
              ...item,
              lastCheckedAt: Date.now(),
              status: {
                ...(item.status ?? {
                  hash: item.hash,
                  stage: 'pending' as TxStage,
                  statusName: 'RPC_ERROR',
                  executionResultName: 'UNKNOWN',
                  isFinalized: false,
                  isAppealable: false,
                  appealWindowSecondsRemaining: null,
                  appealed: false,
                }),
                error: err instanceof Error ? err.message : 'RPC lookup failed',
              },
            }
          }
        })
      )
      setTracked(updated)
      saveTrackedTxs(updated)
      setLastPollAt(Date.now())
    } finally {
      setPolling(false)
    }
  }

  useEffect(() => {
    if (!autoPoll || tracked.length === 0) return
    const timer = setInterval(() => {
      void pollAll()
    }, 8000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPoll, tracked.length])

  function handleAddManual(e: React.FormEvent) {
    e.preventDefault()
    const clean = manualHash.trim()
    if (!/^0x[0-9a-fA-F]{16,}$/.test(clean)) {
      setInputError('Enter a valid 0x-prefixed GenLayer transaction hash.')
      return
    }
    setInputError(null)
    const next = upsertTrackedTx({
      hash: clean,
      label: manualLabel.trim() || `Manual Tx ${clean.slice(0, 10)}`,
      action: 'manual_track',
      addedAt: Date.now(),
    })
    setTracked(next)
    setManualHash('')
    setManualLabel('')
    void pollAll(next)
  }

  function handleLoadAllExhibits() {
    let next = [...tracked]
    for (const item of proofTxs) {
      next = upsertTrackedTx({
        hash: item.hash,
        label: item.label,
        action: item.action,
        caseId: item.caseId,
        addedAt: Date.now(),
      })
    }
    setTracked(next)
    void pollAll(next)
  }

  function handleRemove(hash: string) {
    setTracked(removeTrackedTx(hash))
  }

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#1F293B] bg-[#11161F] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleLoadAllExhibits}
            disabled={proofTxs.length === 0}
            className="inline-flex items-center gap-2 rounded border border-[#D97706]/50 bg-[#451A03]/60 px-3 py-1.5 font-mono text-xs font-medium text-[#FCD34D] transition hover:bg-[#451A03] disabled:opacity-40"
          >
            <Zap className="h-3.5 w-3.5" />
            Load All {proofTxs.length} Exhibit Txs
          </button>

          <button
            type="button"
            onClick={() => void pollAll()}
            disabled={polling || tracked.length === 0}
            className="inline-flex items-center gap-1.5 rounded border border-[#1F293B] bg-[#151C28] px-3 py-1.5 font-mono text-xs text-[#F1F5F9] transition hover:border-[#334155] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${polling ? 'animate-spin' : ''}`} />
            {polling ? 'Polling StudioNet...' : 'Poll Now'}
          </button>

          <label className="inline-flex cursor-pointer items-center gap-2 font-mono text-xs text-[#94A3B8]">
            <input
              type="checkbox"
              checked={autoPoll}
              onChange={(e) => setAutoPoll(e.target.checked)}
              className="accent-[#F59E0B]"
            />
            8s Auto-Poll
          </label>
        </div>

        <div className="font-mono text-[11px] text-[#94A3B8]">
          {tracked.length} tracked ·{' '}
          {lastPollAt
            ? `Last sync ${new Date(lastPollAt).toLocaleTimeString()}`
            : 'Awaiting poll'}
        </div>
      </div>

      {/* Manual Tracker Form */}
      <form
        onSubmit={handleAddManual}
        className="flex flex-wrap items-end gap-3 rounded border border-[#1F293B] bg-[#11161F] p-4"
      >
        <div className="min-w-[260px] flex-1">
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
            Transaction Hash (0x...)
          </label>
          <input
            type="text"
            value={manualHash}
            onChange={(e) => setManualHash(e.target.value)}
            placeholder="0x..."
            className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-3 py-1.5 font-mono text-xs text-[#F1F5F9] placeholder-[#475569] focus:border-[#F59E0B] focus:outline-none"
          />
        </div>
        <div className="w-56">
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
            Label (Optional)
          </label>
          <input
            type="text"
            value={manualLabel}
            onChange={(e) => setManualLabel(e.target.value)}
            placeholder="e.g. Audit #4"
            className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-3 py-1.5 font-mono text-xs text-[#F1F5F9] placeholder-[#475569] focus:border-[#F59E0B] focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded border border-[#059669]/50 bg-[#064E3B]/50 px-3.5 py-1.5 font-mono text-xs font-medium text-[#6EE7B7] transition hover:bg-[#064E3B]"
        >
          <Plus className="h-3.5 w-3.5" />
          Track Tx
        </button>
        {inputError && (
          <p className="w-full font-mono text-xs text-[#FCA5A5]">{inputError}</p>
        )}
      </form>

      {/* Tracked List */}
      {tracked.length === 0 ? (
        <div className="rounded border border-[#1F293B] bg-[#11161F] p-8 text-center">
          <Activity className="mx-auto mb-2 h-6 w-6 text-[#475569]" />
          <p className="font-mono text-xs text-[#94A3B8]">
            No transactions tracked yet. Click &ldquo;Load All {proofTxs.length} Exhibit
            Txs&rdquo; or paste a StudioNet transaction hash above.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tracked.map((item) => {
            const stage = item.status?.stage ?? 'pending'
            const activeIdx = getStageIndex(stage)
            const isErr = stage === 'finalized-error'

            return (
              <div
                key={item.hash}
                className="rounded border border-[#1F293B] bg-[#11161F] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-semibold text-[#F1F5F9]">
                        {item.label}
                      </span>
                      <span className="rounded border border-[#1F293B] bg-[#151C28] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8]">
                        {item.action}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-xs text-[#94A3B8]">
                      <span>{item.hash}</span>
                      <a
                        href={`${STUDIONET_EXPLORER_BASE}/tx/${item.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[#FCD34D] hover:underline"
                      >
                        Explorer <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {item.status && (
                      <span
                        className={`rounded border px-2 py-0.5 font-mono text-[11px] ${
                          isErr
                            ? 'border-[#DC2626]/50 bg-[#450A0A]/60 text-[#FCA5A5]'
                            : item.status.isFinalized
                              ? 'border-[#059669]/50 bg-[#064E3B]/50 text-[#6EE7B7]'
                              : 'border-[#D97706]/50 bg-[#451A03]/60 text-[#FCD34D]'
                        }`}
                      >
                        {item.status.statusName} · {item.status.executionResultName}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemove(item.hash)}
                      title="Remove from tracker"
                      className="rounded border border-[#1F293B] bg-[#151C28] p-1 text-[#94A3B8] hover:text-[#FCA5A5]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* 5-Stage Consensus Pipeline */}
                <div className="grid grid-cols-5 gap-1.5">
                  {TX_STAGE_ORDER.map((step, idx) => {
                    const reached = idx <= activeIdx
                    const stepLabel =
                      idx === 4 && isErr ? STAGE_LABELS['finalized-error'] : STAGE_LABELS[step]
                    return (
                      <div
                        key={step}
                        className={`rounded border px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider ${
                          reached
                            ? isErr && idx === 4
                              ? 'border-[#DC2626]/60 bg-[#450A0A]/60 text-[#FCA5A5]'
                              : 'border-[#059669]/60 bg-[#064E3B]/50 text-[#6EE7B7]'
                            : 'border-[#1F293B] bg-[#0A0D12] text-[#475569]'
                        }`}
                      >
                        {idx + 1}. {stepLabel}
                      </div>
                    )
                  })}
                </div>

                {item.status?.error && (
                  <p className="font-mono text-xs text-[#FCA5A5]">
                    RPC Note: {item.status.error}
                  </p>
                )}

                <AppealWindowPanel
                  txHash={item.hash}
                  liveStatus={item.status}
                  walletAddress={walletAddress}
                  onAppealSubmitted={() => void pollAll()}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
