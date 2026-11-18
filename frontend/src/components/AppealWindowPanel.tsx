import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Gavel, ShieldAlert } from 'lucide-react'
import type { LiveTxStatus } from '../types/cascade'
import { appealCascadeTransaction } from '../lib/genlayerClient'

interface AppealWindowPanelProps {
  txHash: string
  liveStatus?: LiveTxStatus
  walletAddress: string | null
  onAppealSubmitted?: (resultHash: string) => void
}

export function AppealWindowPanel({
  txHash,
  liveStatus,
  walletAddress,
  onAppealSubmitted,
}: AppealWindowPanelProps) {
  const [submitting, setSubmitting] = useState(false)
  const [appealError, setAppealError] = useState<string | null>(null)
  const [appealResult, setAppealResult] = useState<string | null>(null)

  if (!txHash) return null

  const stage = liveStatus?.stage ?? 'pending'
  const isFinalized = liveStatus?.isFinalized ?? false
  const isAppealable = liveStatus?.isAppealable ?? false
  const appealed = liveStatus?.appealed ?? false
  const remaining = liveStatus?.appealWindowSecondsRemaining

  async function handleAppeal() {
    if (!walletAddress) {
      setAppealError('Connect MetaMask on StudioNet (61999) to submit an appeal.')
      return
    }
    setSubmitting(true)
    setAppealError(null)
    try {
      const res = await appealCascadeTransaction({
        accountAddress: walletAddress,
        txHash,
      })
      setAppealResult(res)
      onAppealSubmitted?.(res)
    } catch (err) {
      setAppealError(err instanceof Error ? err.message : 'Appeal transaction failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-white/[0.08] bg-[#0F0F12] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {isFinalized ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          ) : isAppealable ? (
            <Gavel className="h-3.5 w-3.5 text-amber-400" />
          ) : (
            <Clock className="h-3.5 w-3.5 text-[#71717A]" />
          )}
          <span className="font-medium text-[#A1A1AA]">Optimistic Appeal Window</span>
          <span className="rounded-md border border-white/[0.08] bg-[#16161B] px-2 py-0.5 font-mono text-[11px] text-[#FAFAFA]">
            {liveStatus ? `${liveStatus.statusName} (${stage})` : 'Unverified'}
          </span>
          {appealed && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/25 bg-violet-500/[0.08] px-2 py-0.5 font-mono text-[11px] text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Appealed
            </span>
          )}
          {remaining !== null && remaining !== undefined && remaining > 0 && (
            <span className="font-mono text-[11px] text-amber-300">
              {remaining}s remaining
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAppealable && !isFinalized && (
            <button
              type="button"
              onClick={handleAppeal}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-1 text-xs font-medium text-amber-300 transition hover:bg-amber-500/[0.14] disabled:opacity-50"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {submitting ? 'Submitting Appeal...' : 'Appeal Consensus'}
            </button>
          )}
          {isFinalized && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Finalized · Immutable
            </span>
          )}
        </div>
      </div>

      {appealError && (
        <div className="mt-2.5 flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{appealError}</span>
        </div>
      )}
      {appealResult && (
        <div className="mt-2.5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-2 font-mono text-[11px] text-emerald-300">
          Appeal submitted: {appealResult}
        </div>
      )}
    </div>
  )
}
