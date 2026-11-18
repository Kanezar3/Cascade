import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronRight,
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
  const [expandedHashes, setExpandedHashes] = useState<Record<string, boolean>>({})

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

  function toggleExpanded(hash: string) {
    setExpandedHashes((prev) => ({ ...prev, [hash]: !prev[hash] }))
  }

  return (
    <div className="space-y-4">
      {/* Control & Manual Track Bar */}
      <div className="rounded-lg border border-white/[0.08] bg-[#0F0F12] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleLoadAllExhibits}
              disabled={proofTxs.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#FAFAFA] px-3 py-1.5 text-xs font-medium text-[#09090B] transition hover:bg-white/90 disabled:opacity-40"
            >
              <Zap className="h-3.5 w-3.5" />
              Load All {proofTxs.length} Exhibit Txs
            </button>

            <button
              type="button"
              onClick={() => void pollAll()}
              disabled={polling || tracked.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#16161B] px-3 py-1.5 text-xs font-medium text-[#FAFAFA] transition hover:border-white/[0.2] disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#A1A1AA] ${polling ? 'animate-spin' : ''}`}
              />
              {polling ? 'Polling StudioNet...' : 'Poll Now'}
            </button>

            <label className="inline-flex cursor-pointer items-center gap-2 pl-1 text-xs text-[#A1A1AA]">
              <input
                type="checkbox"
                checked={autoPoll}
                onChange={(e) => setAutoPoll(e.target.checked)}
                className="accent-[#FAFAFA]"
              />
              8s Auto-Poll
            </label>
          </div>

          <div className="font-mono text-xs text-[#71717A]">
            {tracked.length} tracked ·{' '}
            {lastPollAt
              ? `Synced ${new Date(lastPollAt).toLocaleTimeString()}`
              : 'Awaiting poll'}
          </div>
        </div>

        <form
          onSubmit={handleAddManual}
          className="flex flex-wrap items-end gap-2.5 border-t border-white/[0.08] pt-3.5"
        >
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-xs font-medium text-[#A1A1AA]">
              Transaction Hash (0x...)
            </label>
            <input
              type="text"
              value={manualHash}
              onChange={(e) => setManualHash(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-md border border-white/[0.08] bg-[#09090B] px-3 py-1.5 font-mono text-xs text-[#FAFAFA] placeholder-[#52525B] focus:border-white/25 focus:outline-none"
            />
          </div>
          <div className="w-56">
            <label className="mb-1 block text-xs font-medium text-[#A1A1AA]">
              Label (Optional)
            </label>
            <input
              type="text"
              value={manualLabel}
              onChange={(e) => setManualLabel(e.target.value)}
              placeholder="e.g. Audit #4"
              className="w-full rounded-md border border-white/[0.08] bg-[#09090B] px-3 py-1.5 font-mono text-xs text-[#FAFAFA] placeholder-[#52525B] focus:border-white/25 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#16161B] px-3 py-1.5 text-xs font-medium text-[#FAFAFA] transition hover:border-white/[0.2]"
          >
            <Plus className="h-3.5 w-3.5 text-[#A1A1AA]" />
            Track Tx
          </button>
          {inputError && (
            <p className="w-full font-mono text-xs text-red-300">{inputError}</p>
          )}
        </form>
      </div>

      {/* Scannable Consensus Ledger Table */}
      {tracked.length === 0 ? (
        <div className="rounded-lg border border-white/[0.08] bg-[#0F0F12] p-10 text-center">
          <Activity className="mx-auto mb-2.5 h-6 w-6 text-[#52525B]" />
          <p className="text-xs text-[#A1A1AA]">
            No transactions tracked yet. Click &ldquo;Load All {proofTxs.length} Exhibit
            Txs&rdquo; or paste a StudioNet transaction hash above.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#0F0F12]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-[11px] font-medium text-[#71717A]">
                <th className="px-4 py-3">Transaction</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">5-Stage Consensus</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Links &amp; Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {tracked.map((item) => {
                const stage = item.status?.stage ?? 'pending'
                const activeIdx = getStageIndex(stage)
                const isErr = stage === 'finalized-error'
                const isFinalized = item.status?.isFinalized ?? false
                const isAppealable = item.status?.isAppealable ?? false
                const showAppealRow =
                  Boolean(expandedHashes[item.hash]) ||
                  isAppealable ||
                  Boolean(item.status?.error)

                const statusDot = isErr
                  ? 'bg-red-400'
                  : isFinalized
                    ? 'bg-emerald-400'
                    : item.status
                      ? 'bg-amber-400'
                      : 'bg-[#71717A]'

                return (
                  <FragmentRow
                    key={item.hash}
                    item={item}
                    activeIdx={activeIdx}
                    isErr={isErr}
                    isFinalized={isFinalized}
                    statusDot={statusDot}
                    showAppealRow={showAppealRow}
                    expanded={Boolean(expandedHashes[item.hash])}
                    walletAddress={walletAddress}
                    onToggleExpand={() => toggleExpanded(item.hash)}
                    onRemove={() => handleRemove(item.hash)}
                    onAppealSubmitted={() => void pollAll()}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface FragmentRowProps {
  item: TrackedTxRecord
  activeIdx: number
  isErr: boolean
  isFinalized: boolean
  statusDot: string
  showAppealRow: boolean
  expanded: boolean
  walletAddress: string | null
  onToggleExpand: () => void
  onRemove: () => void
  onAppealSubmitted: () => void
}

function FragmentRow({
  item,
  activeIdx,
  isErr,
  isFinalized,
  statusDot,
  showAppealRow,
  expanded,
  walletAddress,
  onToggleExpand,
  onRemove,
  onAppealSubmitted,
}: FragmentRowProps) {
  const shortHash = `${item.hash.slice(0, 10)}…${item.hash.slice(-6)}`
  const currentStageLabel = isErr
    ? STAGE_LABELS['finalized-error']
    : STAGE_LABELS[TX_STAGE_ORDER[activeIdx]]

  return (
    <>
      <tr className="transition hover:bg-white/[0.02]">
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleExpand}
              title="Toggle appeal window details"
              className="text-[#71717A] hover:text-[#FAFAFA]"
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            <div>
              <div className="font-medium text-[#FAFAFA]">{item.label}</div>
              <div className="mt-0.5 font-mono text-[11px] text-[#71717A]">
                {shortHash}
              </div>
            </div>
          </div>
        </td>

        <td className="px-4 py-3">
          <span className="rounded border border-white/[0.08] bg-[#16161B] px-2 py-0.5 font-mono text-[11px] text-[#A1A1AA]">
            {item.action}
          </span>
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">
              {TX_STAGE_ORDER.map((step, idx) => {
                const reached = idx <= activeIdx
                const barClass = reached
                  ? isErr && idx === 4
                    ? 'bg-red-400'
                    : 'bg-emerald-400'
                  : 'bg-white/[0.1]'
                return (
                  <span
                    key={step}
                    title={`${idx + 1}. ${STAGE_LABELS[step]}`}
                    className={`h-1.5 w-5 rounded-full ${barClass}`}
                  />
                )
              })}
            </div>
            <span className="ml-1.5 font-mono text-[11px] text-[#A1A1AA]">
              {activeIdx + 1}/5 {currentStageLabel}
            </span>
          </div>
        </td>

        <td className="px-4 py-3 font-mono text-[11px]">
          {item.status ? (
            <span
              className={`inline-flex items-center gap-1.5 ${
                isErr
                  ? 'text-red-300'
                  : isFinalized
                    ? 'text-emerald-300'
                    : 'text-amber-300'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
              {item.status.statusName} · {item.status.executionResultName}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[#71717A]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#71717A]" />
              Pending poll
            </span>
          )}
        </td>

        <td className="px-4 py-3 text-right">
          <div className="inline-flex items-center gap-2">
            <a
              href={`${STUDIONET_EXPLORER_BASE}/tx/${item.hash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-[#16161B] px-2 py-1 font-mono text-[11px] text-[#A1A1AA] transition hover:border-white/[0.16] hover:text-[#FAFAFA]"
            >
              Explorer <ExternalLink className="h-3 w-3" />
            </a>
            <button
              type="button"
              onClick={onRemove}
              title="Remove from tracker"
              className="rounded border border-white/[0.08] bg-[#16161B] p-1 text-[#71717A] transition hover:border-red-500/30 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>

      {showAppealRow && (
        <tr className="bg-[#09090B]/60">
          <td colSpan={5} className="px-4 py-3">
            {item.status?.error && (
              <p className="mb-2 font-mono text-xs text-red-300">
                RPC Note: {item.status.error}
              </p>
            )}
            <AppealWindowPanel
              txHash={item.hash}
              liveStatus={item.status}
              walletAddress={walletAddress}
              onAppealSubmitted={onAppealSubmitted}
            />
          </td>
        </tr>
      )}
    </>
  )
}
