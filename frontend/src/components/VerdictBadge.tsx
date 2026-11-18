import type { VerdictCode } from '../types/cascade'

interface VerdictBadgeProps {
  verdict: VerdictCode
  reasonCode?: string
  compact?: boolean
}

export function getVerdictTokenClasses(code: string): string {
  const upper = code.toUpperCase()
  if (upper.includes('UPSTREAM_AT_FAULT')) {
    return 'bg-[#451A03]/60 border-[#D97706]/50 text-[#FCD34D]'
  }
  if (upper.includes('DOWNSTREAM_AT_FAULT') || upper.includes('ERROR')) {
    return 'bg-[#450A0A]/60 border-[#DC2626]/50 text-[#FCA5A5]'
  }
  if (
    upper.includes('OBSERVABLE_CHARTER') ||
    upper.includes('EXPIRED_REFUNDED') ||
    upper.includes('VERIFIED') ||
    upper.includes('FINALIZED') ||
    upper.includes('SUCCESS')
  ) {
    return 'bg-[#064E3B]/50 border-[#059669]/50 text-[#6EE7B7]'
  }
  if (
    upper.includes('INSUFFICIENT_TRACE') ||
    upper.includes('TOO_VAGUE') ||
    upper.includes('PROMPT_INJECTION') ||
    upper.includes('REJECTED')
  ) {
    return 'bg-[#3B0764]/50 border-[#9333EA]/50 text-[#D8B4FE]'
  }
  return 'bg-[#151C28] border-[#1F293B] text-[#94A3B8]'
}

export function VerdictBadge({ verdict, reasonCode, compact }: VerdictBadgeProps) {
  const classes = getVerdictTokenClasses(verdict)
  const showReason = Boolean(reasonCode && reasonCode !== verdict)

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border font-mono uppercase tracking-wider ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      } ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      <span className="font-semibold">{verdict}</span>
      {showReason && (
        <span className="opacity-80 font-normal">: {reasonCode}</span>
      )}
    </span>
  )
}
