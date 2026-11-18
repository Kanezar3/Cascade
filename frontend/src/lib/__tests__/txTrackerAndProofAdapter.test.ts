import { describe, expect, it } from 'vitest'
import { mapGenLayerTxStage } from '../txTracker'
import { normalizeProofJson } from '../proofAdapter'
import { formatWeiToGen, parseGenToWei } from '../../components/LiveWalletConsole'

describe('mapGenLayerTxStage', () => {
  const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

  it('maps pending, proposing, and accepted states including appealable flag', () => {
    expect(mapGenLayerTxStage(txHash, { status: 1 }).stage).toBe('pending')
    expect(mapGenLayerTxStage(txHash, { status: 'PROPOSING' }).stage).toBe('proposing')

    const accepted = mapGenLayerTxStage(txHash, {
      status: 6,
      appealed: false,
      appeal_window_end: Math.floor(Date.now() / 1000) + 120,
    })
    expect(accepted.stage).toBe('accepted')
    expect(accepted.isAppealable).toBe(true)
    expect(accepted.isFinalized).toBe(false)
  })

  it('maps finalized-success and finalized-error from leader_receipt execution_result', () => {
    const success = mapGenLayerTxStage(txHash, {
      status: 7,
      consensus_data: {
        leader_receipt: [{ execution_result: 'SUCCESS' }],
      },
    })
    expect(success.stage).toBe('finalized-success')
    expect(success.isFinalized).toBe(true)
    expect(success.isAppealable).toBe(false)

    const error = mapGenLayerTxStage(txHash, {
      status: 'FINALIZED',
      consensus_data: {
        leader_receipt: [{ execution_result: 'ERROR' }],
      },
    })
    expect(error.stage).toBe('finalized-error')
    expect(error.isFinalized).toBe(true)
  })
})

describe('normalizeProofJson', () => {
  it('handles placeholder proof.json cleanly', () => {
    const normalized = normalizeProofJson({
      _placeholder: true,
      contract_address: '',
      cases: [],
    })
    expect(normalized.isPlaceholder).toBe(true)
    expect(normalized.cases).toHaveLength(0)
    expect(normalized.chainId).toBe(61999)
  })

  it('normalizes real finalized cases with bilateral fault attribution and stats', () => {
    const normalized = normalizeProofJson({
      contract_address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
      cases: [
        {
          case_id: 'C1',
          pool_id: '1',
          audit_id: '1',
          verdict: 'UPSTREAM_AT_FAULT',
          reason_code: 'SLAR_BREACH',
          upstream_id: 'upstream-router',
          downstream_id: 'downstream-rag',
          allowed_source_prefix:
            'https://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/',
          charter_sha256: 'aa'.repeat(32),
          snippet_sha256: 'bb'.repeat(32),
          snippet_excerpt: 'Upstream DNS failed',
          evidence_quote: 'Upstream DNS failed',
          tx_hash: '0xabc123',
        },
        {
          case_id: 'C2',
          pool_id: '2',
          verdict: 'EXPIRED_REFUNDED',
          reason_code: 'EXPIRED_REFUNDED',
          upstream_id: 'upstream-llm',
          downstream_id: 'downstream-app',
          expiry_tx_hash: '0xexp456',
          withdraw_tx_hash: '0xwd789',
        },
      ],
    })

    expect(normalized.isPlaceholder).toBe(false)
    expect(normalized.cases).toHaveLength(2)
    expect(normalized.cases[0].slashed_party).toBe('upstream-router')
    expect(normalized.cases[0].exonerated_party).toBe('downstream-rag')
    expect(normalized.cases[1].tx_hash).toBe('0xexp456')
    expect(normalized.cases[1].withdraw_tx_hash).toBe('0xwd789')
    expect(normalized.stats.upstreamFaultCount).toBe(1)
    expect(normalized.stats.expiredRefundedCount).toBe(1)
  })
})

describe('WEI <-> GEN formatting helpers', () => {
  it('converts between GEN strings and wei strings accurately', () => {
    const wei = parseGenToWei('0.015')
    expect(wei).toBe('15000000000000000')
    expect(formatWeiToGen(wei)).toBe('0.0150')
    expect(formatWeiToGen('1000000000000000000')).toBe('1.0000')
  })
})
