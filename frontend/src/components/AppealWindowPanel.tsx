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
    <div className="rounded border border-[#1F293B] bg-[#11161F] px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          {isFinalized ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-[#10B981]" />
          ) : isAppealable ? (
            <Gavel className="h-3.5 w-3.5 text-[#F59E0B]" />
          ) : (
            <Clock className="h-3.5 w-3.5 text-[#94A3B8]" />
          )}
          <span className="font-mono uppercase tracking-wider text-[#94A3B8]">
            Optimistic Appeal Window
          </span>
          <span className="rounded border border-[#1F293B] bg-[#0A0D12] px-2 py-0.5 font-mono text-[11px] text-[#F1F5F9]">
            {liveStatus ? `${liveStatus.statusName} (${stage})` : 'UNVERIFIED'}
          </span>
          {appealed && (
            <span className="rounded border border-[#9333EA]/50 bg-[#3B0764]/50 px-2 py-0.5 font-mono text-[10px] text-[#D8B4FE]">
              APPEALED
            </span>
          )}
          {remaining !== null && remaining !== undefined && remaining > 0 && (
            <span className="font-mono text-[11px] text-[#FCD34D]">
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
              className="inline-flex items-center gap-1.5 rounded border border-[#D97706]/50 bg-[#451A03]/60 px-2.5 py-1 font-mono text-[11px] font-medium text-[#FCD34D] transition hover:bg-[#451A03] disabled:opacity-50"
            >
              <ShieldAlert className="h-3 w-3" />
              {submitting ? 'Submitting Appeal...' : 'Appeal Consensus'}
            </button>
          )}
          {isFinalized && (
            <span className="font-mono text-[11px] text-[#6EE7B7]">
              FINALIZED · IMMUTABLE
            </span>
          )}
        </div>
      </div>

      {appealError && (
        <div className="mt-2 flex items-center gap-1.5 rounded border border-[#DC2626]/50 bg-[#450A0A]/40 px-2.5 py-1.5 text-xs text-[#FCA5A5]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{appealError}</span>
        </div>
      )}
      {appealResult && (
        <div className="mt-2 rounded border border-[#059669]/50 bg-[#064E3B]/40 px-2.5 py-1.5 font-mono text-[11px] text-[#6EE7B7]">
          Appeal submitted: {appealResult}
        </div>
      )}
    </div>
  )
}
