import type { VerdictCode } from '../types/cascade'

interface VerdictBadgeProps {
  verdict: VerdictCode
  reasonCode?: string
  compact?: boolean
}

export function getVerdictTokenClasses(code: string): string {
  const upper = code.toUpperCase()
  if (upper.includes('UPSTREAM_AT_FAULT')) {
    return 'bg-amber-500/[0.08] border-amber-500/25 text-amber-300'
  }
  if (upper.includes('DOWNSTREAM_AT_FAULT') || upper.includes('ERROR')) {
    return 'bg-red-500/[0.08] border-red-500/25 text-red-300'
  }
  if (
    upper.includes('OBSERVABLE_CHARTER') ||
    upper.includes('EXPIRED_REFUNDED') ||
    upper.includes('VERIFIED') ||
    upper.includes('FINALIZED') ||
    upper.includes('SUCCESS')
  ) {
    return 'bg-emerald-500/[0.08] border-emerald-500/25 text-emerald-300'
  }
  if (
    upper.includes('INSUFFICIENT_TRACE') ||
    upper.includes('TOO_VAGUE') ||
    upper.includes('PROMPT_INJECTION') ||
    upper.includes('REJECTED')
  ) {
    return 'bg-violet-500/[0.08] border-violet-500/25 text-violet-300'
  }
  return 'bg-white/[0.04] border-white/[0.08] text-[#A1A1AA]'
}

export function getVerdictDotClass(code: string): string {
  const upper = code.toUpperCase()
  if (upper.includes('UPSTREAM_AT_FAULT')) return 'bg-amber-400'
  if (upper.includes('DOWNSTREAM_AT_FAULT') || upper.includes('ERROR')) return 'bg-red-400'
  if (
    upper.includes('OBSERVABLE_CHARTER') ||
    upper.includes('EXPIRED_REFUNDED') ||
    upper.includes('VERIFIED') ||
    upper.includes('FINALIZED') ||
    upper.includes('SUCCESS')
  ) {
    return 'bg-emerald-400'
  }
  if (
    upper.includes('INSUFFICIENT_TRACE') ||
    upper.includes('TOO_VAGUE') ||
    upper.includes('PROMPT_INJECTION') ||
    upper.includes('REJECTED')
  ) {
    return 'bg-violet-400'
  }
  return 'bg-[#71717A]'
}

export function VerdictBadge({ verdict, reasonCode, compact }: VerdictBadgeProps) {
  const classes = getVerdictTokenClasses(verdict)
  const dotClass = getVerdictDotClass(verdict)
  const showReason = Boolean(reasonCode && reasonCode !== verdict)

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-mono leading-none ${
        compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      } ${classes}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="font-medium">{verdict}</span>
      {showReason && (
        <span className="text-[#A1A1AA] font-normal">· {reasonCode}</span>
      )}
    </span>
  )
}
