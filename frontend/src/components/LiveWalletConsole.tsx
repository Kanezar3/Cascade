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

const inputClass =
  'w-full rounded-md border border-white/[0.08] bg-[#09090B] px-3 py-2 font-mono text-xs text-[#FAFAFA] placeholder-[#52525B] transition focus:border-white/25 focus:outline-none'

const labelClass = 'mb-1.5 block text-xs font-medium text-[#A1A1AA]'

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
  const [selectedPresetId, setSelectedPresetId] = useState(INCIDENT_PRESETS[0].id)
  const [stateTab, setStateTab] = useState<'pools' | 'audits' | 'rejected'>('pools')

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
    setSelectedPresetId(preset.id)
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
    <div className="space-y-5">
      {/* Wallet & Escrow Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#0F0F12] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleConnectWallet()}
            disabled={connecting}
            className="inline-flex items-center gap-2 rounded-md bg-[#FAFAFA] px-3.5 py-1.5 text-xs font-medium text-[#09090B] transition hover:bg-white/90 disabled:opacity-50"
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
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#16161B] px-3 py-1.5 text-xs font-medium text-[#FAFAFA] transition hover:border-white/[0.2] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#A1A1AA] ${loadingState ? 'animate-spin' : ''}`} />
            Sync On-Chain Tables
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-[#09090B] px-3 py-1.5 text-xs">
            <span className="text-[#71717A]">Refundable Escrow</span>
            <span className="font-mono font-medium text-emerald-300">
              {formatWeiToGen(refundableWei)} GEN
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleWithdrawEscrow()}
            disabled={!walletAddress || refundableWei === '0'}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/[0.14] disabled:opacity-40"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Withdraw Escrow
          </button>
        </div>
      </div>

      {/* Incident Presets Selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[#71717A]">Incident Presets</span>
        {INCIDENT_PRESETS.map((preset) => {
          const active = selectedPresetId === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? 'border-white/[0.16] bg-[#16161B] text-[#FAFAFA]'
                  : 'border-white/[0.06] bg-[#0F0F12] text-[#A1A1AA] hover:border-white/[0.12] hover:text-[#FAFAFA]'
              }`}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/[0.08] px-3.5 py-2.5 text-xs text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {statusMessage && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] px-3.5 py-2.5 font-mono text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* 2-Column Stripe-like Workbench */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Column: Open Pool + Expire Pool */}
        <div className="space-y-5 lg:col-span-6">
          <form
            onSubmit={(e) => void handleOpenPool(e)}
            className="rounded-lg border border-white/[0.08] bg-[#0F0F12] p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                <ShieldPlus className="h-4 w-4 text-[#A1A1AA]" />
                <span className="font-mono text-xs font-medium text-[#FAFAFA]">
                  open_indemnity_pool
                </span>
              </div>
              <span className="text-[11px] text-[#71717A]">Bilateral Escrow</span>
            </div>

            <div>
              <label className={labelClass}>Incident Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Upstream ID</label>
                <input
                  type="text"
                  value={upstreamId}
                  onChange={(e) => setUpstreamId(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Downstream ID</label>
                <input
                  type="text"
                  value={downstreamId}
                  onChange={(e) => setDownstreamId(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Upstream Beneficiary (0x...)</label>
                <input
                  type="text"
                  value={upstreamBeneficiary}
                  onChange={(e) => setUpstreamBeneficiary(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Downstream Beneficiary (0x...)</label>
                <input
                  type="text"
                  value={downstreamBeneficiary}
                  onChange={(e) => setDownstreamBeneficiary(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Fault Charter</label>
              <textarea
                rows={2}
                value={charter}
                onChange={(e) => setCharter(e.target.value)}
                className="w-full rounded-md border border-white/[0.08] bg-[#09090B] px-3 py-2 text-xs leading-relaxed text-[#FAFAFA] placeholder-[#52525B] focus:border-white/25 focus:outline-none"
              />
            </div>

            <div>
              <label className={labelClass}>Allowed Source Prefix (40-hex SHA pinned)</label>
              <input
                type="text"
                value={allowedPrefix}
                onChange={(e) => setAllowedPrefix(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Indemnity Escrow (GEN)</label>
                <input
                  type="text"
                  value={indemnityGen}
                  onChange={(e) => setIndemnityGen(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>TTL (Seconds)</label>
                <input
                  type="number"
                  value={ttlSeconds}
                  onChange={(e) => setTtlSeconds(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md bg-[#FAFAFA] px-3.5 py-2 text-xs font-medium text-[#09090B] transition hover:bg-white/90"
              >
                <Coins className="h-3.5 w-3.5" />
                Fund &amp; Open Pool
              </button>
            </div>
          </form>

          {/* Settle Expired Pool */}
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#0F0F12] p-5">
            <div className="w-40">
              <label className={labelClass}>Pool ID to Expire</label>
              <input
                type="text"
                value={expirePoolId}
                onChange={(e) => setExpirePoolId(e.target.value)}
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSettleExpired()}
              className="rounded-md border border-white/[0.12] bg-[#16161B] px-3.5 py-2 font-mono text-xs font-medium text-[#FAFAFA] transition hover:border-white/[0.2]"
            >
              settle_expired_pool
            </button>
          </div>
        </div>

        {/* Right Column: Submit Audit + Live On-Chain State */}
        <div className="space-y-5 lg:col-span-6">
          <form
            onSubmit={(e) => void handleSubmitAudit(e)}
            className="rounded-lg border border-white/[0.08] bg-[#0F0F12] p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-[#A1A1AA]" />
                <span className="font-mono text-xs font-medium text-[#FAFAFA]">
                  submit_fault_audit
                </span>
              </div>
              <span className="text-[11px] text-[#71717A]">Commit-Pinned Evidence</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Pool ID</label>
                <input
                  type="text"
                  value={auditPoolId}
                  onChange={(e) => setAuditPoolId(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Start Line</label>
                <input
                  type="number"
                  value={startLine}
                  onChange={(e) => setStartLine(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>End Line</label>
                <input
                  type="number"
                  value={endLine}
                  onChange={(e) => setEndLine(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Immutable Evidence URL</label>
              <input
                type="text"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
              <div className="w-40">
                <label className={labelClass}>Audit Bond (GEN)</label>
                <input
                  type="text"
                  value={auditBondGen}
                  onChange={(e) => setAuditBondGen(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.1] px-3.5 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/[0.18]"
              >
                <Send className="h-3.5 w-3.5" />
                Submit Fault Audit
              </button>
            </div>
          </form>

          {/* Live On-Chain State Panel */}
          <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-[#0F0F12]">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5">
              <span className="text-xs font-medium text-[#FAFAFA]">
                Live On-Chain State
              </span>
              <div className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-[#09090B] p-0.5">
                {(
                  [
                    { id: 'pools', label: `Pools (${pools.length})` },
                    { id: 'audits', label: `Audits (${audits.length})` },
                    { id: 'rejected', label: `Rejected (${rejected.length})` },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStateTab(t.id)}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
                      stateTab === t.id
                        ? 'bg-[#16161B] text-[#FAFAFA]'
                        : 'text-[#71717A] hover:text-[#FAFAFA]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {stateTab === 'pools' &&
                (pools.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-[#71717A]">
                    No pools loaded. Click &ldquo;Sync On-Chain Tables&rdquo; above.
                  </p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {pools.map((p, idx) => (
                      <div
                        key={`${p.pool_id}-${idx}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 text-xs hover:bg-white/[0.02]"
                      >
                        <div>
                          <div className="font-mono font-medium text-[#FAFAFA]">
                            Pool #{p.pool_id}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-[#71717A]">
                            {p.upstream_id} → {p.downstream_id}
                          </div>
                        </div>
                        <VerdictBadge verdict={p.verdict || p.status} compact />
                      </div>
                    ))}
                  </div>
                ))}

              {stateTab === 'audits' &&
                (audits.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-[#71717A]">
                    No audits loaded.
                  </p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {audits.map((a, idx) => (
                      <div
                        key={`${a.audit_id}-${idx}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 text-xs hover:bg-white/[0.02]"
                      >
                        <div>
                          <div className="font-mono font-medium text-[#FAFAFA]">
                            Audit #{a.audit_id}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-[#71717A]">
                            Pool #{a.pool_id} · L{a.start_line}–L{a.end_line}
                          </div>
                        </div>
                        <VerdictBadge
                          verdict={a.verdict}
                          reasonCode={a.reason_code}
                          compact
                        />
                      </div>
                    ))}
                  </div>
                ))}

              {stateTab === 'rejected' &&
                (rejected.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-[#71717A]">
                    No rejections recorded.
                  </p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {rejected.map((r, idx) => (
                      <div
                        key={`${r.id ?? idx}`}
                        className="space-y-1 px-4 py-3 text-xs hover:bg-white/[0.02]"
                      >
                        <VerdictBadge
                          verdict={r.reason || r.reason_code || 'REJECTED'}
                          compact
                        />
                        {r.detail && (
                          <div className="font-mono text-[11px] text-[#A1A1AA]">
                            {r.detail}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
