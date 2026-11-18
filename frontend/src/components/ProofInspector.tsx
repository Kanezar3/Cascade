import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Columns2,
  ExternalLink,
  FileCode2,
  Fingerprint,
  LayoutList,
} from 'lucide-react'
import type { CascadeCase, LiveTxStatus, NormalizedProof } from '../types/cascade'
import { computeSha256Hex } from '../lib/validation'
import { getVerdictDotClass, VerdictBadge } from './VerdictBadge'
import { AppealWindowPanel } from './AppealWindowPanel'

interface ProofInspectorProps {
  proof: NormalizedProof
  liveTxMap: Record<string, LiveTxStatus>
  walletAddress: string | null
  onVerifySingleTx?: (txHash: string) => void
}

const FILTER_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'UPSTREAM_AT_FAULT', label: 'Upstream Fault' },
  { value: 'DOWNSTREAM_AT_FAULT', label: 'Downstream Fault' },
  { value: 'INSUFFICIENT_TRACE', label: 'Insufficient Trace' },
  { value: 'TOO_VAGUE', label: 'Too Vague' },
  { value: 'EXPIRED_REFUNDED', label: 'Expired Refunded' },
] as const

type FilterValue = (typeof FILTER_OPTIONS)[number]['value']

function formatWeiShort(weiInput: string | number | bigint | undefined): string {
  try {
    const wei = BigInt(weiInput || 0)
    const base = 10n ** 18n
    const whole = wei / base
    const frac = (wei % base).toString().padStart(18, '0').slice(0, 4)
    return `${whole}.${frac}`
  } catch {
    return '0.0000'
  }
}

function renderLineWithQuote(line: string, quote: string) {
  if (!quote || !line.includes(quote)) {
    return <span>{line || ' '}</span>
  }
  const idx = line.indexOf(quote)
  const before = line.slice(0, idx)
  const after = line.slice(idx + quote.length)
  return (
    <>
      <span>{before}</span>
      <mark className="rounded-xs bg-amber-500/20 px-0.5 text-amber-200 ring-1 ring-amber-500/35">
        {quote}
      </mark>
      <span>{after}</span>
    </>
  )
}

function EvidenceCodeViewer({
  excerpt,
  quote,
  startLine,
}: {
  excerpt: string
  quote: string
  startLine: number
}) {
  if (!excerpt) {
    return (
      <div className="rounded-md border border-white/[0.08] bg-[#09090B] px-4 py-6 text-center text-xs text-[#71717A]">
        No snippet excerpt recorded.
      </div>
    )
  }

  const lines = excerpt.split('\n')
  const baseLine = startLine > 0 ? startLine : 1
  const singleLineQuoteMatch = Boolean(quote && excerpt.includes(quote) && !quote.includes('\n'))

  return (
    <div className="overflow-x-auto rounded-md border border-white/[0.08] bg-[#09090B]">
      {singleLineQuoteMatch ? (
        <div className="max-h-64 overflow-y-auto py-2 font-mono text-xs leading-6">
          {lines.map((line, idx) => {
            const hasMatch = line.includes(quote)
            return (
              <div
                key={idx}
                className={`flex px-3 ${
                  hasMatch ? 'bg-amber-500/[0.06]' : 'hover:bg-white/[0.02]'
                }`}
              >
                <span className="w-10 shrink-0 select-none pr-3 text-right text-[#52525B]">
                  {baseLine + idx}
                </span>
                <span className="whitespace-pre-wrap break-all text-[#E4E4E7]">
                  {renderLineWithQuote(line, quote)}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto py-2 font-mono text-xs leading-6">
          {lines.map((line, idx) => (
            <div key={idx} className="flex px-3 hover:bg-white/[0.02]">
              <span className="w-10 shrink-0 select-none pr-3 text-right text-[#52525B]">
                {baseLine + idx}
              </span>
              <span className="whitespace-pre-wrap break-all text-[#E4E4E7]">
                {line || ' '}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProofInspector({
  proof,
  liveTxMap,
  walletAddress,
  onVerifySingleTx,
}: ProofInspectorProps) {
  const [filter, setFilter] = useState<FilterValue>('ALL')
  const [viewMode, setViewMode] = useState<'split' | 'matrix'>('split')
  const [selectedCaseId, setSelectedCaseId] = useState<string>('')
  const [shaResults, setShaResults] = useState<
    Record<string, { computed: string; matches: boolean; checkedAt: string }>
  >({})

  const filteredCases = useMemo(() => {
    if (filter === 'ALL') return proof.cases
    return proof.cases.filter((c) => c.verdict === filter || c.reason_code === filter)
  }, [proof.cases, filter])

  useEffect(() => {
    if (filteredCases.length === 0) {
      setSelectedCaseId('')
      return
    }
    const stillVisible = filteredCases.some((c) => c.case_id === selectedCaseId)
    if (!stillVisible) {
      setSelectedCaseId(filteredCases[0].case_id)
    }
  }, [filteredCases, selectedCaseId])

  const activeCase: CascadeCase | undefined =
    filteredCases.find((c) => c.case_id === selectedCaseId) ?? filteredCases[0]

  async function handleVerifySha256(c: CascadeCase) {
    if (!c.snippet_excerpt) return
    const computed = await computeSha256Hex(c.snippet_excerpt)
    const matches =
      Boolean(c.snippet_sha256) &&
      computed.toLowerCase() === c.snippet_sha256.toLowerCase()
    setShaResults((prev) => ({
      ...prev,
      [c.case_id]: {
        computed,
        matches,
        checkedAt: new Date().toLocaleTimeString(),
      },
    }))
  }

  if (proof.isPlaceholder || proof.cases.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.08] bg-[#0F0F12] p-10 text-center">
        <FileCode2 className="mx-auto mb-3 h-6 w-6 text-[#71717A]" />
        <h3 className="font-display text-base font-semibold text-[#FAFAFA]">
          Awaiting Finalized StudioNet Proof Bundle
        </h3>
        <p className="mx-auto mt-1.5 max-w-xl text-xs leading-relaxed text-[#A1A1AA]">
          <code className="font-mono text-[#FAFAFA]">frontend/src/data/proof.json</code> is
          currently in placeholder mode while the contract is deployed and seeded on
          StudioNet. Use <span className="text-[#FAFAFA]">Indemnity Desk</span> or{' '}
          <span className="text-[#FAFAFA]">Consensus Telemetry</span> to inspect live
          StudioNet state directly.
        </p>
      </div>
    )
  }

  const upstreamSlashed = activeCase?.slashed_party === activeCase?.upstream_id
  const upstreamExonerated = activeCase?.exonerated_party === activeCase?.upstream_id
  const downstreamSlashed = activeCase?.slashed_party === activeCase?.downstream_id
  const downstreamExonerated = activeCase?.exonerated_party === activeCase?.downstream_id

  return (
    <div className="space-y-4">
      {/* Filter & View Mode Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_OPTIONS.map((opt) => {
            const active = filter === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilter(opt.value)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                  active
                    ? 'border-white/[0.16] bg-[#16161B] text-[#FAFAFA]'
                    : 'border-white/[0.06] bg-transparent text-[#A1A1AA] hover:border-white/[0.12] hover:text-[#FAFAFA]'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <div className="inline-flex rounded-md border border-white/[0.08] bg-[#0F0F12] p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
              viewMode === 'split'
                ? 'bg-[#16161B] text-[#FAFAFA]'
                : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
            }`}
          >
            <Columns2 className="h-3.5 w-3.5" />
            Split Dossier
          </button>
          <button
            type="button"
            onClick={() => setViewMode('matrix')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
              viewMode === 'matrix'
                ? 'bg-[#16161B] text-[#FAFAFA]'
                : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
            }`}
          >
            <LayoutList className="h-3.5 w-3.5" />
            Matrix Compare
          </button>
        </div>
      </div>

      {viewMode === 'matrix' ? (
        <div className="overflow-x-auto rounded-lg border border-white/[0.08] bg-[#0F0F12]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-[11px] font-medium text-[#71717A]">
                <th className="px-4 py-3">Exhibit</th>
                <th className="px-4 py-3">Parties (Upstream → Downstream)</th>
                <th className="px-4 py-3">Verdict</th>
                <th className="px-4 py-3">Slashed Party</th>
                <th className="px-4 py-3">Lines</th>
                <th className="px-4 py-3">RPC Parity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filteredCases.map((c) => {
                const live = c.tx_hash ? liveTxMap[c.tx_hash] : undefined
                return (
                  <tr
                    key={c.case_id}
                    onClick={() => {
                      setSelectedCaseId(c.case_id)
                      setViewMode('split')
                    }}
                    className="cursor-pointer transition hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-medium text-[#FAFAFA]">
                        {c.exhibit_code}
                      </div>
                      <div className="mt-0.5 text-xs text-[#A1A1AA]">{c.label}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#A1A1AA]">
                      {c.upstream_id} → {c.downstream_id}
                    </td>
                    <td className="px-4 py-3">
                      <VerdictBadge verdict={c.verdict} reasonCode={c.reason_code} compact />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#FAFAFA]">
                      {c.slashed_party || <span className="text-[#71717A]">None</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#A1A1AA]">
                      L{c.start_line}–L{c.end_line}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {live ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          {live.statusName} ({live.executionResultName})
                        </span>
                      ) : (
                        <span className="text-[#71717A]">Unchecked</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0F0F12] lg:grid-cols-12">
          {/* Left Rail: Incident List */}
          <div className="divide-y divide-white/[0.06] border-b border-white/[0.08] lg:col-span-4 lg:border-b-0 lg:border-r">
            {filteredCases.map((c) => {
              const selected = activeCase?.case_id === c.case_id
              const live = c.tx_hash ? liveTxMap[c.tx_hash] : undefined
              const dotColor = getVerdictDotClass(c.verdict)
              return (
                <button
                  key={c.case_id}
                  type="button"
                  onClick={() => setSelectedCaseId(c.case_id)}
                  className={`w-full border-l-2 px-4 py-3.5 text-left transition ${
                    selected
                      ? 'border-l-[#FAFAFA] bg-[#16161B]'
                      : 'border-l-transparent bg-transparent hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 font-mono text-xs font-medium text-[#FAFAFA]">
                      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                      {c.exhibit_code}
                    </span>
                    <span className="font-mono text-[11px] text-[#71717A]">
                      {live ? live.statusName : c.finality_status}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-[#FAFAFA]">{c.label}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-[#71717A]">
                    {c.upstream_id} → {c.downstream_id}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right Detail Pane */}
          {activeCase && (
            <div className="divide-y divide-white/[0.08] lg:col-span-8">
              {/* Verdict Summary Header */}
              <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs text-[#71717A]">
                    <span className="text-[#FAFAFA]">{activeCase.exhibit_code}</span>
                    <span>·</span>
                    <span>Pool {activeCase.pool_id || 'N/A'}</span>
                    {activeCase.audit_id && (
                      <>
                        <span>·</span>
                        <span>Audit {activeCase.audit_id}</span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-[#FAFAFA]">
                    {activeCase.label}
                  </h2>
                </div>
                <VerdictBadge
                  verdict={activeCase.verdict}
                  reasonCode={activeCase.reason_code}
                />
              </div>

              {/* Bilateral 80/20 Attribution & Escrow Breakdown */}
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-[#A1A1AA]">
                    Bilateral Attribution &amp; Escrow Breakdown
                  </h3>
                  <span className="font-mono text-[11px] text-[#71717A]">
                    Indemnity {formatWeiShort(activeCase.indemnity_wei)} GEN · Bond{' '}
                    {formatWeiShort(activeCase.bond_wei)} GEN
                  </span>
                </div>

                <div className="overflow-hidden rounded-md border border-white/[0.08]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.08] bg-[#16161B]/60 text-[11px] font-medium text-[#71717A]">
                        <th className="px-3.5 py-2">Role</th>
                        <th className="px-3.5 py-2">Service Identifier</th>
                        <th className="px-3.5 py-2">Attribution</th>
                        <th className="px-3.5 py-2 text-right">80/20 Escrow Split</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06] bg-[#09090B]">
                      <tr>
                        <td className="px-3.5 py-2.5 text-[#A1A1AA]">Upstream</td>
                        <td className="px-3.5 py-2.5 font-mono text-[#FAFAFA]">
                          {activeCase.upstream_id}
                        </td>
                        <td className="px-3.5 py-2.5">
                          {upstreamSlashed ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-red-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                              Slashed
                            </span>
                          ) : upstreamExonerated ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Exonerated
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-[#71717A]">
                              Unattributed
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono text-[#A1A1AA]">
                          {upstreamSlashed
                            ? '0% (Forfeited)'
                            : upstreamExonerated
                              ? '80% Indemnity / Bond Return'
                              : 'Refundable'}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3.5 py-2.5 text-[#A1A1AA]">Downstream</td>
                        <td className="px-3.5 py-2.5 font-mono text-[#FAFAFA]">
                          {activeCase.downstream_id}
                        </td>
                        <td className="px-3.5 py-2.5">
                          {downstreamSlashed ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-red-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                              Slashed
                            </span>
                          ) : downstreamExonerated ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Exonerated
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-[#71717A]">
                              Unattributed
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono text-[#A1A1AA]">
                          {downstreamSlashed
                            ? '20% Bond Slashed'
                            : downstreamExonerated
                              ? '80% Indemnity Payout'
                              : 'Refundable'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Fault Charter */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-[#A1A1AA]">Fault Charter</span>
                    {activeCase.charter_sha256 && (
                      <span className="font-mono text-[11px] text-[#71717A]">
                        SHA-256 {activeCase.charter_sha256.slice(0, 16)}…
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-[#E4E4E7]">
                    {activeCase.charter || 'No charter text recorded.'}
                  </p>
                </div>
              </div>

              {/* Commit-Pinned Evidence Viewer */}
              <div className="p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-xs font-medium text-[#FAFAFA]">
                      Commit-Pinned Evidence
                    </h3>
                    <span className="rounded border border-white/[0.08] bg-[#16161B] px-2 py-0.5 font-mono text-[11px] text-[#A1A1AA]">
                      L{activeCase.start_line}–L{activeCase.end_line}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleVerifySha256(activeCase)}
                    disabled={!activeCase.snippet_excerpt}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#16161B] px-2.5 py-1 text-xs font-medium text-[#FAFAFA] transition hover:border-white/[0.2] disabled:opacity-40"
                  >
                    <Fingerprint className="h-3.5 w-3.5 text-[#A1A1AA]" />
                    Verify SHA-256 in Browser
                  </button>
                </div>

                {activeCase.evidence_url && (
                  <div className="truncate font-mono text-[11px] text-[#71717A]">
                    Source:{' '}
                    <a
                      href={activeCase.evidence_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#A1A1AA] underline decoration-white/20 underline-offset-2 hover:text-[#FAFAFA]"
                    >
                      {activeCase.evidence_url}
                    </a>
                  </div>
                )}

                <EvidenceCodeViewer
                  excerpt={activeCase.snippet_excerpt}
                  quote={activeCase.evidence_quote}
                  startLine={activeCase.start_line}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="truncate text-[#71717A]">
                    On-chain SHA-256:{' '}
                    <span className="text-[#A1A1AA]">
                      {activeCase.snippet_sha256 || 'N/A'}
                    </span>
                  </span>
                  {shaResults[activeCase.case_id] && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${
                        shaResults[activeCase.case_id].matches
                          ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300'
                          : 'border-amber-500/25 bg-amber-500/[0.08] text-amber-300'
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {shaResults[activeCase.case_id].matches
                        ? 'SHA-256 Verified'
                        : `Computed ${shaResults[activeCase.case_id].computed.slice(0, 12)}…`}
                    </span>
                  )}
                </div>
              </div>

              {/* Recorded Proof vs Live StudioNet RPC Parity */}
              <div className="grid grid-cols-1 divide-y divide-white/[0.08] md:grid-cols-2 md:divide-x md:divide-y-0">
                <div className="p-5 space-y-1.5">
                  <div className="text-xs font-medium text-[#71717A]">
                    Recorded Proof
                  </div>
                  <div className="font-mono text-xs text-[#FAFAFA]">
                    {activeCase.finality_status} · {activeCase.execution_result}
                  </div>
                  {activeCase.tx_hash && (
                    <div className="flex items-center gap-2 font-mono text-[11px] text-[#71717A]">
                      <span className="truncate">{activeCase.tx_hash}</span>
                      <a
                        href={activeCase.explorer_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[#A1A1AA] hover:text-[#FAFAFA]"
                      >
                        Tx <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>

                <div className="p-5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#71717A]">
                      Live StudioNet RPC Parity
                    </span>
                    {activeCase.tx_hash && onVerifySingleTx && (
                      <button
                        type="button"
                        onClick={() => onVerifySingleTx(activeCase.tx_hash)}
                        className="text-[11px] font-medium text-[#A1A1AA] hover:text-[#FAFAFA]"
                      >
                        Refresh Tx
                      </button>
                    )}
                  </div>
                  {activeCase.tx_hash && liveTxMap[activeCase.tx_hash] ? (
                    <div className="inline-flex items-center gap-1.5 font-mono text-xs text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {liveTxMap[activeCase.tx_hash].statusName} ·{' '}
                      {liveTxMap[activeCase.tx_hash].executionResultName}
                    </div>
                  ) : (
                    <div className="text-xs text-[#71717A]">
                      Click &ldquo;Verify Live StudioNet&rdquo; in the header to confirm
                      RPC parity.
                    </div>
                  )}
                </div>
              </div>

              {activeCase.tx_hash && (
                <div className="p-5">
                  <AppealWindowPanel
                    txHash={activeCase.tx_hash}
                    liveStatus={liveTxMap[activeCase.tx_hash]}
                    walletAddress={walletAddress}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
