export type VerdictCode =
  | 'UPSTREAM_AT_FAULT'
  | 'DOWNSTREAM_AT_FAULT'
  | 'INSUFFICIENT_TRACE'
  | 'TOO_VAGUE'
  | 'EXPIRED_REFUNDED'
  | 'OBSERVABLE_CHARTER'
  | 'REJECTED'
  | string

export type TxStage =
  | 'submitted'
  | 'pending'
  | 'proposing'
  | 'accepted'
  | 'finalized-success'
  | 'finalized-error'

export interface CascadeCase {
  case_id: string
  exhibit_code: string
  label: string
  action: string
  pool_id: string
  audit_id: string
  verdict: VerdictCode
  outcome: VerdictCode
  reason_code: string
  upstream_id: string
  downstream_id: string
  allowed_source_prefix: string
  charter: string
  charter_sha256: string
  evidence_url: string
  start_line: number
  end_line: number
  snippet_sha256: string
  snippet_excerpt: string
  evidence_quote: string
  tx_hash: string
  pool_tx_hash: string
  expiry_tx_hash: string
  withdraw_tx_hash: string
  block_number: number | null
  finality_status: string
  execution_result: string
  indemnity_wei: string
  bond_wei: string
  slashed_party: string
  exonerated_party: string
  explorer_url: string
  notes: string
}

export interface NormalizedProof {
  isPlaceholder: boolean
  contractAddress: string
  network: string
  chainId: number
  rpcEndpoint: string
  generatedAt: string
  cases: CascadeCase[]
  stats: {
    totalCases: number
    upstreamFaultCount: number
    downstreamFaultCount: number
    insufficientTraceCount: number
    tooVagueCount: number
    expiredRefundedCount: number
  }
}

export interface CascadePool {
  pool_id: string
  upstream_id: string
  downstream_id: string
  upstream_address: string
  charter: string
  charter_sha256: string
  allowed_source_prefix: string
  indemnity_wei: string
  bond_wei: string
  expiry_timestamp: number
  status: string
  verdict?: string
  reason_code?: string
  created_at?: number
  tx_hash?: string
}

export interface CascadeAudit {
  audit_id: string
  pool_id: string
  challenger: string
  evidence_url: string
  start_line: number
  end_line: number
  snippet_sha256: string
  snippet_excerpt: string
  evidence_quote: string
  verdict: string
  reason_code: string
  bond_wei: string
  created_at?: number
  tx_hash?: string
}

export interface CascadeRejected {
  id?: string
  pool_id?: string
  action?: string
  reason?: string
  reason_code: string
  detail?: string
  submitter?: string
  timestamp?: number
}

export interface CascadeProtocolStats {
  total_pools: number
  total_audits: number
  total_rejected: number
  upstream_at_fault: number
  downstream_at_fault: number
  insufficient_trace: number
  expired_refunded: number
  too_vague: number
  total_escrow_wei: string
}

export interface LiveTxStatus {
  hash: string
  stage: TxStage
  statusName: string
  executionResultName: string
  isFinalized: boolean
  isAppealable: boolean
  appealWindowSecondsRemaining: number | null
  appealed: boolean
  timestamp?: number
  blockNumber?: number | null
  raw?: Record<string, unknown>
  error?: string
}

export interface TrackedTxRecord {
  hash: string
  label: string
  action: string
  caseId?: string
  addedAt: number
  lastCheckedAt?: number
  status?: LiveTxStatus
}
