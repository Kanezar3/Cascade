import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  Columns2,
  ExternalLink,
  FileCode2,
  Fingerprint,
  LayoutList,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import type { CascadeCase, LiveTxStatus, NormalizedProof } from '../types/cascade'
import { computeSha256Hex } from '../lib/validation'
import { VerdictBadge } from './VerdictBadge'
import { AppealWindowPanel } from './AppealWindowPanel'

interface ProofInspectorProps {
  proof: NormalizedProof
  liveTxMap: Record<string, LiveTxStatus>
  walletAddress: string | null
  onVerifySingleTx?: (txHash: string) => void
}

const FILTER_OPTIONS = [
  'ALL',
  'UPSTREAM_AT_FAULT',
  'DOWNSTREAM_AT_FAULT',
  'INSUFFICIENT_TRACE',
  'TOO_VAGUE',
  'EXPIRED_REFUNDED',
] as const

function renderHighlightedExcerpt(excerpt: string, quote: string) {
  if (!excerpt) {
    return <span className="text-[#475569] italic">No snippet excerpt recorded.</span>
  }
  if (!quote || !excerpt.includes(quote)) {
    return <span>{excerpt}</span>
  }
  const idx = excerpt.indexOf(quote)
  const before = excerpt.slice(0, idx)
  const after = excerpt.slice(idx + quote.length)
  return (
    <>
      <span>{before}</span>
      <mark className="rounded bg-[#451A03] px-1 py-0.5 text-[#FCD34D] ring-1 ring-[#D97706]/50">
        {quote}
      </mark>
      <span>{after}</span>
    </>
  )
}

export function ProofInspector({
  proof,
  liveTxMap,
  walletAddress,
  onVerifySingleTx,
}: ProofInspectorProps) {
  const [filter, setFilter] = useState<(typeof FILTER_OPTIONS)[number]>('ALL')
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
      <div className="rounded border border-[#1F293B] bg-[#11161F] p-8 text-center">
        <FileCode2 className="mx-auto mb-3 h-7 w-7 text-[#F59E0B]" />
        <h3 className="font-display text-base font-semibold text-[#F1F5F9]">
          Awaiting Finalized StudioNet Proof Bundle
        </h3>
        <p className="mx-auto mt-1.5 max-w-xl text-xs text-[#94A3B8]">
          <code className="font-mono text-[#FCD34D]">frontend/src/data/proof.json</code> is
          currently in placeholder mode while the contract is deployed and seeded on
          StudioNet. Use <span className="text-[#F1F5F9]">02 // INDEMNITY DESK</span> or{' '}
          <span className="text-[#F1F5F9]">03 // CONSENSUS TELEMETRY</span> to inspect
          live StudioNet state directly.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter & View Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#1F293B] bg-[#11161F] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_OPTIONS.map((opt) => {
            const active = filter === opt
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setFilter(opt)}
                className={`rounded border px-2.5 py-1 font-mono text-[11px] transition ${
                  active
                    ? 'border-[#D97706]/60 bg-[#451A03]/70 text-[#FCD34D]'
                    : 'border-[#1F293B] bg-[#151C28] text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                {opt}
              </button>
            )
          })}
        </div>

        <div className="inline-flex rounded border border-[#1F293B] bg-[#0A0D12] p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] transition ${
              viewMode === 'split'
                ? 'bg-[#151C28] text-[#F1F5F9]'
                : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <Columns2 className="h-3.5 w-3.5" />
            Split Dossier
          </button>
          <button
            type="button"
            onClick={() => setViewMode('matrix')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] transition ${
              viewMode === 'matrix'
                ? 'bg-[#151C28] text-[#F1F5F9]'
                : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            }`}
          >
            <LayoutList className="h-3.5 w-3.5" />
            Matrix Compare
          </button>
        </div>
      </div>

      {viewMode === 'matrix' ? (
        <div className="overflow-x-auto rounded border border-[#1F293B] bg-[#11161F]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#1F293B] bg-[#151C28] font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
                <th className="px-3.5 py-2.5">Exhibit</th>
                <th className="px-3.5 py-2.5">Upstream → Downstream</th>
                <th className="px-3.5 py-2.5">Verdict : Reason</th>
                <th className="px-3.5 py-2.5">Slashed</th>
                <th className="px-3.5 py-2.5">Lines</th>
                <th className="px-3.5 py-2.5">RPC Parity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F293B]">
              {filteredCases.map((c) => {
                const live = c.tx_hash ? liveTxMap[c.tx_hash] : undefined
                return (
                  <tr
                    key={c.case_id}
                    onClick={() => {
                      setSelectedCaseId(c.case_id)
                      setViewMode('split')
                    }}
                    className="cursor-pointer transition hover:bg-[#151C28]/80"
                  >
                    <td className="px-3.5 py-2.5 font-mono text-[#FCD34D]">
                      {c.exhibit_code}
                      <div className="font-sans text-[11px] text-[#94A3B8]">{c.label}</div>
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-[#F1F5F9]">
                      {c.upstream_id} → {c.downstream_id}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <VerdictBadge verdict={c.verdict} reasonCode={c.reason_code} compact />
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-[#FCA5A5]">
                      {c.slashed_party || 'NONE'}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-[#94A3B8]">
                      L{c.start_line}–L{c.end_line}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px]">
                      {live ? (
                        <span className="text-[#6EE7B7]">
                          {live.statusName} ({live.executionResultName})
                        </span>
                      ) : (
                        <span className="text-[#94A3B8]">UNCHECKED</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left Docket Rail */}
          <div className="space-y-2 lg:col-span-4">
            {filteredCases.map((c) => {
              const selected = activeCase?.case_id === c.case_id
              const live = c.tx_hash ? liveTxMap[c.tx_hash] : undefined
              return (
                <button
                  key={c.case_id}
                  type="button"
                  onClick={() => setSelectedCaseId(c.case_id)}
                  className={`w-full rounded border p-3 text-left transition ${
                    selected
                      ? 'border-[#D97706]/70 bg-[#151C28]'
                      : 'border-[#1F293B] bg-[#11161F] hover:border-[#334155]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-[#FCD34D]">
                      {c.exhibit_code}
                    </span>
                    <VerdictBadge verdict={c.verdict} compact />
                  </div>
                  <div className="mt-1.5 font-display text-sm font-medium text-[#F1F5F9]">
                    {c.label}
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[#94A3B8]">
                    <span>
                      {c.upstream_id} → {c.downstream_id}
                    </span>
                    <span>{live ? live.statusName : c.finality_status}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right Active Dossier */}
          {activeCase && (
            <div className="space-y-4 lg:col-span-8">
              {/* Header + Bilateral Fault Topology Strip */}
              <div className="rounded border border-[#1F293B] bg-[#11161F] p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-mono text-[11px] text-[#94A3B8]">
                      <span className="text-[#FCD34D]">{activeCase.exhibit_code}</span>
                      <span>·</span>
                      <span>POOL {activeCase.pool_id || 'N/A'}</span>
                      {activeCase.audit_id && (
                        <>
                          <span>·</span>
                          <span>AUDIT {activeCase.audit_id}</span>
                        </>
                      )}
                    </div>
                    <h2 className="mt-1 font-display text-lg font-semibold text-[#F1F5F9]">
                      {activeCase.label}
                    </h2>
                  </div>
                  <VerdictBadge
                    verdict={activeCase.verdict}
                    reasonCode={activeCase.reason_code}
                  />
                </div>

                {/* Bilateral Fault Topology Strip */}
                <div className="grid grid-cols-1 items-center gap-2 rounded border border-[#1F293B] bg-[#0A0D12] p-3 md:grid-cols-5">
                  <div
                    className={`rounded border p-2.5 md:col-span-2 ${
                      activeCase.slashed_party === activeCase.upstream_id
                        ? 'border-[#DC2626]/60 bg-[#450A0A]/40'
                        : activeCase.exonerated_party === activeCase.upstream_id
                          ? 'border-[#059669]/50 bg-[#064E3B]/30'
                          : 'border-[#1F293B] bg-[#11161F]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[#94A3B8]">
                      <span>Upstream Node</span>
                      {activeCase.slashed_party === activeCase.upstream_id ? (
                        <span className="inline-flex items-center gap-1 text-[#FCA5A5]">
                          <ShieldX className="h-3 w-3" /> SLASHED
                        </span>
                      ) : activeCase.exonerated_party === activeCase.upstream_id ? (
                        <span className="inline-flex items-center gap-1 text-[#6EE7B7]">
                          <ShieldCheck className="h-3 w-3" /> EXONERATED
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 font-mono text-xs font-semibold text-[#F1F5F9]">
                      {activeCase.upstream_id}
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center text-center">
                    <ArrowRight className="h-4 w-4 text-[#F59E0B]" />
                    <span className="mt-0.5 font-mono text-[10px] text-[#94A3B8]">
                      CHARTER
                    </span>
                  </div>

                  <div
                    className={`rounded border p-2.5 md:col-span-2 ${
                      activeCase.slashed_party === activeCase.downstream_id
                        ? 'border-[#DC2626]/60 bg-[#450A0A]/40'
                        : activeCase.exonerated_party === activeCase.downstream_id
                          ? 'border-[#059669]/50 bg-[#064E3B]/30'
                          : 'border-[#1F293B] bg-[#11161F]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[#94A3B8]">
                      <span>Downstream Node</span>
                      {activeCase.slashed_party === activeCase.downstream_id ? (
                        <span className="inline-flex items-center gap-1 text-[#FCA5A5]">
                          <ShieldX className="h-3 w-3" /> SLASHED
                        </span>
                      ) : activeCase.exonerated_party === activeCase.downstream_id ? (
                        <span className="inline-flex items-center gap-1 text-[#6EE7B7]">
                          <ShieldCheck className="h-3 w-3" /> EXONERATED
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 font-mono text-xs font-semibold text-[#F1F5F9]">
                      {activeCase.downstream_id}
                    </div>
                  </div>
                </div>

                {/* Fault Charter */}
                <div className="rounded border border-[#1F293B] bg-[#151C28] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-[#94A3B8]">
                    <span>Fault Charter</span>
                    {activeCase.charter_sha256 && (
                      <span>SHA-256: {activeCase.charter_sha256.slice(0, 16)}…</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#F1F5F9]">
                    {activeCase.charter || 'No charter text recorded.'}
                  </p>
                </div>
              </div>

              {/* Telemetry Log Plate + Live Browser SHA-256 Verification */}
              <div className="rounded border border-[#1F293B] bg-[#11161F] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#F1F5F9]">
                      Telemetry Log Plate
                    </span>
                    <span className="rounded border border-[#1F293B] bg-[#151C28] px-2 py-0.5 font-mono text-[11px] text-[#FCD34D]">
                      L{activeCase.start_line}–L{activeCase.end_line}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleVerifySha256(activeCase)}
                    disabled={!activeCase.snippet_excerpt}
                    className="inline-flex items-center gap-1.5 rounded border border-[#059669]/50 bg-[#064E3B]/50 px-2.5 py-1 font-mono text-[11px] font-medium text-[#6EE7B7] transition hover:bg-[#064E3B] disabled:opacity-40"
                  >
                    <Fingerprint className="h-3.5 w-3.5" />
                    Verify SHA-256 in Browser
                  </button>
                </div>

                {activeCase.evidence_url && (
                  <div className="truncate font-mono text-[11px] text-[#94A3B8]">
                    Source:{' '}
                    <a
                      href={activeCase.evidence_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#FCD34D] hover:underline"
                    >
                      {activeCase.evidence_url}
                    </a>
                  </div>
                )}

                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-[#1F293B] bg-[#0A0D12] p-3 font-mono text-xs leading-relaxed text-[#E2E8F0]">
                  {renderHighlightedExcerpt(
                    activeCase.snippet_excerpt,
                    activeCase.evidence_quote
                  )}
                </pre>

                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="text-[#94A3B8]">
                    On-Chain Snippet SHA-256:{' '}
                    <span className="text-[#F1F5F9]">
                      {activeCase.snippet_sha256 || 'N/A'}
                    </span>
                  </span>
                  {shaResults[activeCase.case_id] && (
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${
                        shaResults[activeCase.case_id].matches
                          ? 'border-[#059669]/50 bg-[#064E3B]/50 text-[#6EE7B7]'
                          : 'border-[#D97706]/50 bg-[#451A03]/60 text-[#FCD34D]'
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {shaResults[activeCase.case_id].matches
                        ? 'BROWSER SHA-256 MATCH'
                        : `COMPUTED ${shaResults[activeCase.case_id].computed.slice(0, 12)}…`}
                    </span>
                  )}
                </div>
              </div>

              {/* Recorded Proof vs Live StudioNet RPC Parity */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded border border-[#1F293B] bg-[#11161F] p-3.5 space-y-1.5">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#94A3B8]">
                    Recorded Proof (deploy/proof.json)
                  </div>
                  <div className="font-mono text-xs text-[#F1F5F9]">
                    Status: {activeCase.finality_status} · {activeCase.execution_result}
                  </div>
                  {activeCase.tx_hash && (
                    <div className="flex items-center gap-2 font-mono text-[11px] text-[#94A3B8]">
                      <span className="truncate">{activeCase.tx_hash}</span>
                      <a
                        href={activeCase.explorer_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-[#FCD34D] hover:underline"
                      >
                        Tx <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>

                <div className="rounded border border-[#1F293B] bg-[#11161F] p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#94A3B8]">
                      Live StudioNet RPC Parity
                    </span>
                    {activeCase.tx_hash && onVerifySingleTx && (
                      <button
                        type="button"
                        onClick={() => onVerifySingleTx(activeCase.tx_hash)}
                        className="font-mono text-[10px] text-[#FCD34D] hover:underline"
                      >
                        Refresh Tx
                      </button>
                    )}
                  </div>
                  {activeCase.tx_hash && liveTxMap[activeCase.tx_hash] ? (
                    <div className="font-mono text-xs text-[#6EE7B7]">
                      {liveTxMap[activeCase.tx_hash].statusName} ·{' '}
                      {liveTxMap[activeCase.tx_hash].executionResultName}
                    </div>
                  ) : (
                    <div className="font-mono text-xs text-[#94A3B8]">
                      Click &ldquo;Verify Live StudioNet&rdquo; in header to confirm RPC
                      parity.
                    </div>
                  )}
                </div>
              </div>

              {activeCase.tx_hash && (
                <AppealWindowPanel
                  txHash={activeCase.tx_hash}
                  liveStatus={liveTxMap[activeCase.tx_hash]}
                  walletAddress={walletAddress}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
