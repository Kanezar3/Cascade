import type { CascadeCase, NormalizedProof, VerdictCode } from '../types/cascade'

const DEFAULT_RPC_ENDPOINT = 'https://studio.genlayer.com/api'
const DEFAULT_CHAIN_ID = 61999
const EXPLORER_TX_BASE = 'https://explorer-studio.genlayer.com/tx/'

function asString(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'bigint') return String(val)
  return fallback
}

function asNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeVerdict(rawCase: Record<string, unknown>): VerdictCode {
  const raw = asString(
    rawCase.verdict ?? rawCase.outcome ?? rawCase.status ?? 'INSUFFICIENT_TRACE'
  ).toUpperCase()
  return raw || 'INSUFFICIENT_TRACE'
}

export function normalizeProofCase(
  raw: Record<string, unknown>,
  index: number
): CascadeCase {
  const verdict = normalizeVerdict(raw)
  const outcome = asString(raw.outcome ?? verdict).toUpperCase() || verdict
  const reasonCode = asString(raw.reason_code ?? raw.reason ?? verdict).toUpperCase()
  const txHash = asString(
    raw.tx_hash ?? raw.audit_tx_hash ?? raw.expiry_tx_hash ?? raw.pool_tx_hash ?? ''
  )
  const upstreamId = asString(raw.upstream_id ?? raw.upstream ?? 'upstream-node')
  const downstreamId = asString(raw.downstream_id ?? raw.downstream ?? 'downstream-node')

  let slashedParty = asString(raw.slashed_party)
  let exoneratedParty = asString(raw.exonerated_party)
  if (!slashedParty && verdict === 'UPSTREAM_AT_FAULT') {
    slashedParty = upstreamId
    exoneratedParty = downstreamId
  } else if (!slashedParty && verdict === 'DOWNSTREAM_AT_FAULT') {
    slashedParty = downstreamId
    exoneratedParty = upstreamId
  }

  return {
    case_id: asString(raw.case_id ?? raw.id ?? `CASE-${index + 1}`),
    exhibit_code: asString(raw.exhibit_code ?? `EX-${String(index + 1).padStart(2, '0')}`),
    label: asString(raw.label ?? raw.title ?? `Incident #${index + 1}`),
    action: asString(raw.action ?? 'submit_fault_audit'),
    pool_id: asString(raw.pool_id ?? ''),
    audit_id: asString(raw.audit_id ?? ''),
    verdict,
    outcome,
    reason_code: reasonCode,
    upstream_id: upstreamId,
    downstream_id: downstreamId,
    allowed_source_prefix: asString(raw.allowed_source_prefix ?? ''),
    charter: asString(raw.charter ?? raw.fault_charter ?? raw.clause ?? ''),
    charter_sha256: asString(raw.charter_sha256 ?? ''),
    evidence_url: asString(raw.evidence_url ?? raw.source_url ?? ''),
    start_line: asNumber(raw.start_line, 1),
    end_line: asNumber(raw.end_line, 1),
    snippet_sha256: asString(raw.snippet_sha256 ?? ''),
    snippet_excerpt: asString(raw.snippet_excerpt ?? raw.snippet ?? ''),
    evidence_quote: asString(raw.evidence_quote ?? raw.quote ?? ''),
    tx_hash: txHash,
    pool_tx_hash: asString(raw.pool_tx_hash ?? ''),
    expiry_tx_hash: asString(raw.expiry_tx_hash ?? ''),
    withdraw_tx_hash: asString(raw.withdraw_tx_hash ?? ''),
    block_number: raw.block_number !== undefined && raw.block_number !== null ? asNumber(raw.block_number) : null,
    finality_status: asString(raw.finality_status ?? 'FINALIZED'),
    execution_result: asString(raw.execution_result ?? 'SUCCESS'),
    indemnity_wei: asString(raw.indemnity_wei ?? '0'),
    bond_wei: asString(raw.bond_wei ?? '0'),
    slashed_party: slashedParty,
    exonerated_party: exoneratedParty,
    explorer_url:
      asString(raw.explorer_url) || (txHash ? `${EXPLORER_TX_BASE}${txHash}` : ''),
    notes: asString(raw.notes ?? ''),
  }
}

export function normalizeProofJson(rawInput: unknown): NormalizedProof {
  const raw = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<
    string,
    unknown
  >

  const contractAddress = asString(raw.contract_address ?? '')
  const rawCases = Array.isArray(raw.cases) ? raw.cases : []
  const isPlaceholder = Boolean(raw._placeholder) || (!contractAddress && rawCases.length === 0)

  const cases = rawCases
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => normalizeProofCase(item, idx))

  return {
    isPlaceholder,
    contractAddress,
    network: asString(raw.network ?? 'GenLayer StudioNet'),
    chainId: asNumber(raw.chain_id, DEFAULT_CHAIN_ID),
    rpcEndpoint: asString(raw.rpc_endpoint ?? DEFAULT_RPC_ENDPOINT),
    generatedAt: asString(raw.generated_at ?? ''),
    cases,
    stats: {
      totalCases: cases.length,
      upstreamFaultCount: cases.filter((c) => c.verdict === 'UPSTREAM_AT_FAULT').length,
      downstreamFaultCount: cases.filter((c) => c.verdict === 'DOWNSTREAM_AT_FAULT').length,
      insufficientTraceCount: cases.filter((c) => c.verdict === 'INSUFFICIENT_TRACE').length,
      tooVagueCount: cases.filter((c) => c.verdict === 'TOO_VAGUE').length,
      expiredRefundedCount: cases.filter((c) => c.verdict === 'EXPIRED_REFUNDED').length,
    },
  }
}
