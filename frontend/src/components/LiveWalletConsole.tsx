import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Coins,
  RefreshCw,
  Send,
  ShieldPlus,
  Wallet,
} from 'lucide-react'
import type {
  CascadeAudit,
  CascadePool,
  CascadeRejected,
} from '../types/cascade'
import {
  connectStudioNetWallet,
  fetchAllAudits,
  fetchAllPools,
  fetchRefundableBalance,
  fetchRejectedSubmissions,
  writeCascadeContract,
} from '../lib/genlayerClient'
import { validateImmutableEvidenceUrl } from '../lib/validation'
import { VerdictBadge } from './VerdictBadge'

export function formatWeiToGen(weiInput: string | number | bigint): string {
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

export function parseGenToWei(genInput: string): string {
  const cleaned = genInput.trim()
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('Enter a valid non-negative GEN amount.')
  }
  const [wholePart, fracPart = ''] = cleaned.split('.')
  const paddedFrac = fracPart.slice(0, 18).padEnd(18, '0')
  return (BigInt(wholePart) * 10n ** 18n + BigInt(paddedFrac)).toString()
}

interface IncidentPreset {
  id: string
  label: string
  title: string
  upstreamId: string
  downstreamId: string
  allowedPrefix: string
  charter: string
  evidenceUrl: string
  startLine: number
  endLine: number
}

const INCIDENT_PRESETS: IncidentPreset[] = [
  {
    id: 'cloudflare-bgp-leak',
    label: 'Preset A · Cloudflare Miami BGP Route Leak (L54–L60)',
    title: 'Cloudflare Miami BGP Route Leak',
    upstreamId: 'upstream-transit-bgp',
    downstreamId: 'downstream-edge-waf',
    allowedPrefix:
      'https://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/',
    charter:
      'Upstream transit provider is at fault if the post-mortem documents a BGP route leak or misrouted prefix causing downstream service outage.',
    evidenceUrl:
      'https://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/README.md',
    startLine: 54,
    endLine: 60,
  },
  {
    id: 'workers-kv-outage',
    label: 'Preset B · Workers KV Cloud Store Outage (L303–L308)',
    title: 'Workers KV Cloud Store Outage',
    upstreamId: 'upstream-kv-store',
    downstreamId: 'downstream-worker-api',
    allowedPrefix:
      'https://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/',
    charter:
      'Upstream storage provider is at fault if the post-mortem documents a cloud store outage or unavailability impacting downstream workers.',
    evidenceUrl:
      'https://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/README.md',
    startLine: 303,
    endLine: 308,
  },
  {
    id: 'rebuff-prompt-injection',
    label: 'Preset C · Prompt-Injection Defense Test (L1–L30)',
    title: 'Prompt-Injection Defense Test',
    upstreamId: 'upstream-guardrail',
    downstreamId: 'downstream-agent',
    allowedPrefix:
      'https://raw.githubusercontent.com/protectai/rebuff/4d2fe064abf164e7381556d23e48e210080f8afa/',
    charter:
      'Upstream guardrail is at fault if an explicit prompt-injection test fixture bypasses detection without downstream misconfiguration.',
    evidenceUrl:
      'https://raw.githubusercontent.com/protectai/rebuff/4d2fe064abf164e7381556d23e48e210080f8afa/python-sdk/tests/test_sdk.py',
    startLine: 1,
    endLine: 30,
  },
]

interface LiveWalletConsoleProps {
  contractAddress: string
  walletAddress: string | null
  onWalletConnected: (address: string) => void
  onTxSubmitted?: (txHash: string, label: string, action: string) => void
}

export function LiveWalletConsole({
  contractAddress,
  walletAddress,
  onWalletConnected,
  onTxSubmitted,
}: LiveWalletConsoleProps) {
  const [connecting, setConnecting] = useState(false)
  const [loadingState, setLoadingState] = useState(false)
  const [pools, setPools] = useState<CascadePool[]>([])
  const [audits, setAudits] = useState<CascadeAudit[]>([])
  const [rejected, setRejected] = useState<CascadeRejected[]>([])
  const [refundableWei, setRefundableWei] = useState('0')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Pool form state
  const [title, setTitle] = useState(INCIDENT_PRESETS[0].title)
  const [upstreamId, setUpstreamId] = useState(INCIDENT_PRESETS[0].upstreamId)
  const [downstreamId, setDownstreamId] = useState(INCIDENT_PRESETS[0].downstreamId)
  const [upstreamBeneficiary, setUpstreamBeneficiary] = useState(
    walletAddress || '0x00000000000000000000000000000000000000a1'
  )
  const [downstreamBeneficiary, setDownstreamBeneficiary] = useState(
    '0x00000000000000000000000000000000000000b2'
  )
  const [charter, setCharter] = useState(INCIDENT_PRESETS[0].charter)
  const [allowedPrefix, setAllowedPrefix] = useState(INCIDENT_PRESETS[0].allowedPrefix)
  const [indemnityGen, setIndemnityGen] = useState('0.001')
  const [ttlSeconds, setTtlSeconds] = useState('86400')

  // Audit form state
  const [auditPoolId, setAuditPoolId] = useState('1')
  const [evidenceUrl, setEvidenceUrl] = useState(INCIDENT_PRESETS[0].evidenceUrl)
  const [startLine, setStartLine] = useState(String(INCIDENT_PRESETS[0].startLine))
  const [endLine, setEndLine] = useState(String(INCIDENT_PRESETS[0].endLine))
  const [auditBondGen, setAuditBondGen] = useState('0.0002')

  // Settle expired pool state
  const [expirePoolId, setExpirePoolId] = useState('1')

  async function refreshOnChainTables(addr?: string | null) {
    if (!contractAddress) return
    setLoadingState(true)
    try {
      const [p, a, r] = await Promise.all([
        fetchAllPools(contractAddress),
        fetchAllAudits(contractAddress),
        fetchRejectedSubmissions(contractAddress),
      ])
      setPools(p)
      setAudits(a)
      setRejected(r)
      const activeWallet = addr ?? walletAddress
      if (activeWallet) {
        const bal = await fetchRefundableBalance(contractAddress, activeWallet)
        setRefundableWei(bal)
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to read live contract state.'
      )
    } finally {
      setLoadingState(false)
    }
  }

  useEffect(() => {
    void refreshOnChainTables()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractAddress, walletAddress])

  async function handleConnectWallet() {
    setConnecting(true)
    setErrorMessage(null)
    try {
      const { address } = await connectStudioNetWallet()
      onWalletConnected(address)
      setStatusMessage(`Connected MetaMask on StudioNet (61999): ${address}`)
      await refreshOnChainTables(address)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Wallet connection failed.')
    } finally {
      setConnecting(false)
    }
  }

  function applyPreset(preset: IncidentPreset) {
    setTitle(preset.title)
    setUpstreamId(preset.upstreamId)
    setDownstreamId(preset.downstreamId)
    setCharter(preset.charter)
    setAllowedPrefix(preset.allowedPrefix)
    setEvidenceUrl(preset.evidenceUrl)
    setStartLine(String(preset.startLine))
    setEndLine(String(preset.endLine))
    setErrorMessage(null)
    setStatusMessage(`Loaded ${preset.label}`)
  }

  async function handleOpenPool(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    setStatusMessage(null)
    if (!walletAddress) {
      setErrorMessage(
        'MetaMask is required for write transactions. Connect your wallet first.'
      )
      return
    }
    try {
      const valueWei = parseGenToWei(indemnityGen)
      const deadlineTs = Math.floor(Date.now() / 1000) + Number(ttlSeconds)
      const txHash = await writeCascadeContract({
        contractAddress,
        accountAddress: walletAddress,
        functionName: 'open_indemnity_pool',
        args: [
          title.trim(),
          upstreamId.trim(),
          downstreamId.trim(),
          upstreamBeneficiary.trim(),
          downstreamBeneficiary.trim(),
          charter.trim(),
          allowedPrefix.trim(),
          deadlineTs,
        ],
        valueWei,
      })
      setStatusMessage(`Pool creation submitted: ${txHash}`)
      onTxSubmitted?.(txHash, `Open Pool (${title})`, 'open_indemnity_pool')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'open_indemnity_pool failed.')
    }
  }

  async function handleSubmitAudit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage(null)
    setStatusMessage(null)
    if (!walletAddress) {
      setErrorMessage(
        'MetaMask is required for write transactions. Connect your wallet first.'
      )
      return
    }
    const pool = pools.find((p) => String(p.pool_id) === auditPoolId.trim())
    const validation = validateImmutableEvidenceUrl(
      evidenceUrl,
      pool?.allowed_source_prefix || undefined
    )
    if (!validation.valid) {
      setErrorMessage(validation.reason ?? 'Invalid immutable evidence URL.')
      return
    }
    try {
      const valueWei = parseGenToWei(auditBondGen)
      const txHash = await writeCascadeContract({
        contractAddress,
        accountAddress: walletAddress,
        functionName: 'submit_fault_audit',
        args: [
          Number(auditPoolId),
          evidenceUrl.trim(),
          Number(startLine),
          Number(endLine),
        ],
        valueWei,
      })
      setStatusMessage(`Fault audit submitted: ${txHash}`)
      onTxSubmitted?.(txHash, `Audit Pool #${auditPoolId}`, 'submit_fault_audit')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'submit_fault_audit failed.')
    }
  }

  async function handleSettleExpired() {
    setErrorMessage(null)
    setStatusMessage(null)
    if (!walletAddress) {
      setErrorMessage('Connect MetaMask on StudioNet to settle an expired pool.')
      return
    }
    try {
      const txHash = await writeCascadeContract({
        contractAddress,
        accountAddress: walletAddress,
        functionName: 'settle_expired_pool',
        args: [Number(expirePoolId)],
      })
      setStatusMessage(`settle_expired_pool submitted: ${txHash}`)
      onTxSubmitted?.(txHash, `Expire Pool #${expirePoolId}`, 'settle_expired_pool')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'settle_expired_pool failed.')
    }
  }

  async function handleWithdrawEscrow() {
    setErrorMessage(null)
    setStatusMessage(null)
    if (!walletAddress) {
      setErrorMessage('Connect MetaMask on StudioNet to withdraw escrow.')
      return
    }
    try {
      const txHash = await writeCascadeContract({
        contractAddress,
        accountAddress: walletAddress,
        functionName: 'withdraw_refundable',
        args: [],
      })
      setStatusMessage(`Withdrawal submitted: ${txHash}`)
      onTxSubmitted?.(txHash, 'Withdraw Escrow', 'withdraw_refundable')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'withdraw_refundable failed.')
    }
  }

  return (
    <div className="space-y-4">
      {/* Wallet & Escrow Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#1F293B] bg-[#11161F] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleConnectWallet()}
            disabled={connecting}
            className="inline-flex items-center gap-2 rounded border border-[#D97706]/50 bg-[#451A03]/60 px-3.5 py-1.5 font-mono text-xs font-medium text-[#FCD34D] transition hover:bg-[#451A03] disabled:opacity-50"
          >
            <Wallet className="h-3.5 w-3.5" />
            {walletAddress
              ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)} (StudioNet)`
              : connecting
                ? 'Connecting MetaMask...'
                : 'Connect MetaMask (61999)'}
          </button>

          <button
            type="button"
            onClick={() => void refreshOnChainTables()}
            disabled={loadingState || !contractAddress}
            className="inline-flex items-center gap-1.5 rounded border border-[#1F293B] bg-[#151C28] px-3 py-1.5 font-mono text-xs text-[#F1F5F9] hover:border-[#334155] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingState ? 'animate-spin' : ''}`} />
            Sync On-Chain Tables
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded border border-[#1F293B] bg-[#0A0D12] px-3 py-1.5 font-mono text-xs">
            <span className="text-[#94A3B8]">Refundable Escrow: </span>
            <span className="font-semibold text-[#6EE7B7]">
              {formatWeiToGen(refundableWei)} GEN
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleWithdrawEscrow()}
            disabled={!walletAddress || refundableWei === '0'}
            className="inline-flex items-center gap-1.5 rounded border border-[#059669]/50 bg-[#064E3B]/50 px-3 py-1.5 font-mono text-xs font-medium text-[#6EE7B7] transition hover:bg-[#064E3B] disabled:opacity-40"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Withdraw Escrow
          </button>
        </div>
      </div>

      {/* Presets Strip */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-[#1F293B] bg-[#11161F] px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
          1-Click Incident Presets:
        </span>
        {INCIDENT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded border border-[#1F293B] bg-[#151C28] px-2.5 py-1 font-mono text-[11px] text-[#FCD34D] transition hover:border-[#D97706]/50"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 rounded border border-[#DC2626]/50 bg-[#450A0A]/50 px-3.5 py-2 text-xs text-[#FCA5A5]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {statusMessage && (
        <div className="flex items-center gap-2 rounded border border-[#059669]/50 bg-[#064E3B]/40 px-3.5 py-2 font-mono text-xs text-[#6EE7B7]">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Action Forms */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Open Indemnity Pool */}
        <form
          onSubmit={(e) => void handleOpenPool(e)}
          className="rounded border border-[#1F293B] bg-[#11161F] p-4 space-y-3"
        >
          <div className="flex items-center gap-2 font-display text-sm font-semibold text-[#F1F5F9]">
            <ShieldPlus className="h-4 w-4 text-[#F59E0B]" />
            open_indemnity_pool
          </div>

          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
              Incident Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                Upstream ID
              </label>
              <input
                type="text"
                value={upstreamId}
                onChange={(e) => setUpstreamId(e.target.value)}
                className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                Downstream ID
              </label>
              <input
                type="text"
                value={downstreamId}
                onChange={(e) => setDownstreamId(e.target.value)}
                className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                Upstream Beneficiary (0x...)
              </label>
              <input
                type="text"
                value={upstreamBeneficiary}
                onChange={(e) => setUpstreamBeneficiary(e.target.value)}
                className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                Downstream Beneficiary (0x...)
              </label>
              <input
                type="text"
                value={downstreamBeneficiary}
                onChange={(e) => setDownstreamBeneficiary(e.target.value)}
                className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
              Fault Charter
            </label>
            <textarea
              rows={2}
              value={charter}
              onChange={(e) => setCharter(e.target.value)}
              className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 text-xs text-[#F1F5F9]"
            />
          </div>

          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
              Allowed Source Prefix (40-hex SHA pinned)
            </label>
            <input
              type="text"
              value={allowedPrefix}
              onChange={(e) => setAllowedPrefix(e.target.value)}
              className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                Indemnity Escrow (GEN)
              </label>
              <input
                type="text"
                value={indemnityGen}
                onChange={(e) => setIndemnityGen(e.target.value)}
                className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                TTL (Seconds)
              </label>
              <input
                type="number"
                value={ttlSeconds}
                onChange={(e) => setTtlSeconds(e.target.value)}
                className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
              />
            </div>
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded border border-[#D97706]/50 bg-[#451A03]/60 px-3.5 py-1.5 font-mono text-xs font-medium text-[#FCD34D] hover:bg-[#451A03]"
          >
            <Coins className="h-3.5 w-3.5" />
            Fund & Open Pool
          </button>
        </form>

        {/* Submit Fault Audit + Expire Pool */}
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleSubmitAudit(e)}
            className="rounded border border-[#1F293B] bg-[#11161F] p-4 space-y-3"
          >
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-[#F1F5F9]">
              <Send className="h-4 w-4 text-[#10B981]" />
              submit_fault_audit
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                  Pool ID
                </label>
                <input
                  type="text"
                  value={auditPoolId}
                  onChange={(e) => setAuditPoolId(e.target.value)}
                  className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                  Start Line
                </label>
                <input
                  type="number"
                  value={startLine}
                  onChange={(e) => setStartLine(e.target.value)}
                  className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                  End Line
                </label>
                <input
                  type="number"
                  value={endLine}
                  onChange={(e) => setEndLine(e.target.value)}
                  className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                Immutable Evidence URL
              </label>
              <input
                type="text"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
              />
            </div>

            <div className="flex items-end gap-3">
              <div className="w-40">
                <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                  Audit Bond (GEN)
                </label>
                <input
                  type="text"
                  value={auditBondGen}
                  onChange={(e) => setAuditBondGen(e.target.value)}
                  className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded border border-[#059669]/50 bg-[#064E3B]/50 px-3.5 py-1.5 font-mono text-xs font-medium text-[#6EE7B7] hover:bg-[#064E3B]"
              >
                <Send className="h-3.5 w-3.5" />
                Submit Fault Audit
              </button>
            </div>
          </form>

          {/* Settle Expired Pool */}
          <div className="flex flex-wrap items-end justify-between gap-3 rounded border border-[#1F293B] bg-[#11161F] p-4">
            <div className="w-36">
              <label className="mb-1 block font-mono text-[10px] uppercase text-[#94A3B8]">
                Pool ID to Expire
              </label>
              <input
                type="text"
                value={expirePoolId}
                onChange={(e) => setExpirePoolId(e.target.value)}
                className="w-full rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9]"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSettleExpired()}
              className="rounded border border-[#1F293B] bg-[#151C28] px-3.5 py-1.5 font-mono text-xs text-[#F1F5F9] hover:border-[#334155]"
            >
              settle_expired_pool
            </button>
          </div>
        </div>
      </div>

      {/* Live On-Chain Tables */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded border border-[#1F293B] bg-[#11161F] p-3.5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
            Live Pools ({pools.length})
          </div>
          {pools.length === 0 ? (
            <p className="font-mono text-xs text-[#475569]">No pools loaded.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {pools.map((p, idx) => (
                <div
                  key={`${p.pool_id}-${idx}`}
                  className="rounded border border-[#1F293B] bg-[#0A0D12] p-2 font-mono text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[#FCD34D]">Pool #{p.pool_id}</span>
                    <VerdictBadge verdict={p.verdict || p.status} compact />
                  </div>
                  <div className="mt-1 text-[#94A3B8]">
                    {p.upstream_id} → {p.downstream_id}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-[#1F293B] bg-[#11161F] p-3.5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
            Live Audits ({audits.length})
          </div>
          {audits.length === 0 ? (
            <p className="font-mono text-xs text-[#475569]">No audits loaded.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {audits.map((a, idx) => (
                <div
                  key={`${a.audit_id}-${idx}`}
                  className="rounded border border-[#1F293B] bg-[#0A0D12] p-2 font-mono text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[#F1F5F9]">Audit #{a.audit_id}</span>
                    <VerdictBadge verdict={a.verdict} reasonCode={a.reason_code} compact />
                  </div>
                  <div className="mt-1 text-[#94A3B8]">
                    Pool #{a.pool_id} · L{a.start_line}–L{a.end_line}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-[#1F293B] bg-[#11161F] p-3.5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[#94A3B8]">
            Rejected Submissions ({rejected.length})
          </div>
          {rejected.length === 0 ? (
            <p className="font-mono text-xs text-[#475569]">No rejections recorded.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {rejected.map((r, idx) => (
                <div
                  key={`${r.id ?? idx}`}
                  className="rounded border border-[#1F293B] bg-[#0A0D12] p-2 font-mono text-[11px]"
                >
                  <VerdictBadge verdict={r.reason || r.reason_code || 'REJECTED'} compact />
                  {r.detail && <div className="mt-1 text-[#94A3B8]">{r.detail}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
