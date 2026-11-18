import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import rawProofJson from './data/proof.json'
import type { CascadeProtocolStats, LiveTxStatus } from './types/cascade'
import { normalizeProofJson } from './lib/proofAdapter'
import {
  fetchProtocolStats,
  fetchTransactionStatus,
  STUDIONET_EXPLORER_BASE,
} from './lib/genlayerClient'
import { upsertTrackedTx } from './lib/txTracker'
import { ProofInspector } from './components/ProofInspector'
import { LiveWalletConsole } from './components/LiveWalletConsole'
import { TxLifecycleMonitor } from './components/TxLifecycleMonitor'

type ActiveTab = 'dossiers' | 'desk' | 'telemetry'

export function App() {
  const proof = useMemo(() => normalizeProofJson(rawProofJson), [])
  const [activeTab, setActiveTab] = useState<ActiveTab>('dossiers')
  const [contractOverride, setContractOverride] = useState<string>('')
  const effectiveContract = contractOverride.trim() || proof.contractAddress

  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [rpcState, setRpcState] = useState<'idle' | 'verifying' | 'synced' | 'error'>(
    'idle'
  )
  const [rpcError, setRpcError] = useState<string | null>(null)
  const [liveStats, setLiveStats] = useState<CascadeProtocolStats | null>(null)
  const [liveTxMap, setLiveTxMap] = useState<Record<string, LiveTxStatus>>({})

  async function handleVerifyLive() {
    if (!effectiveContract) return
    setRpcState('verifying')
    setRpcError(null)
    try {
      const stats = await fetchProtocolStats(effectiveContract)
      setLiveStats(stats)

      const hashes = Array.from(
        new Set(proof.cases.map((c) => c.tx_hash).filter((h) => h.startsWith('0x')))
      )
      const entries = await Promise.all(
        hashes.map(async (hash) => {
          try {
            const st = await fetchTransactionStatus(hash)
            return [hash, st] as const
          } catch {
            return null
          }
        })
      )
      const nextMap: Record<string, LiveTxStatus> = {}
      for (const entry of entries) {
        if (entry) nextMap[entry[0]] = entry[1]
      }
      setLiveTxMap(nextMap)
      setRpcState('synced')
    } catch (err) {
      setRpcState('error')
      setRpcError(err instanceof Error ? err.message : 'StudioNet RPC sync failed.')
    }
  }

  async function handleVerifySingleTx(txHash: string) {
    try {
      const st = await fetchTransactionStatus(txHash)
      setLiveTxMap((prev) => ({ ...prev, [txHash]: st }))
    } catch {
      // ignore single tx refresh failure
    }
  }

  useEffect(() => {
    if (effectiveContract && !proof.isPlaceholder) {
      void handleVerifyLive()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleTxSubmitted(txHash: string, label: string, action: string) {
    upsertTrackedTx({
      hash: txHash,
      label,
      action,
      addedAt: Date.now(),
    })
  }

  const shortContract = effectiveContract
    ? `${effectiveContract.slice(0, 6)}…${effectiveContract.slice(-4)}`
    : 'Undeployed'

  const rpcDotColor =
    rpcState === 'synced'
      ? 'bg-emerald-400'
      : rpcState === 'verifying'
        ? 'bg-amber-400'
        : rpcState === 'error'
          ? 'bg-red-400'
          : 'bg-[#71717A]'

  const rpcLabel =
    rpcState === 'verifying'
      ? 'Syncing'
      : rpcState === 'synced'
        ? 'Live'
        : rpcState === 'error'
          ? 'RPC Error'
          : proof.isPlaceholder
            ? 'Placeholder'
            : 'Ready'

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA]">
      {/* Single-Row Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#09090B]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* Brand & Network */}
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Cascade"
              className="h-7 w-7 rounded-md border border-white/[0.08] bg-[#16161B] object-contain p-0.5"
            />
            <div className="flex items-center gap-2.5">
              <span className="font-display text-sm font-semibold tracking-tight text-[#FAFAFA]">
                Cascade
              </span>
              <span className="h-3.5 w-px bg-white/[0.12]" />
              <span className="inline-flex items-center gap-1.5 text-xs text-[#A1A1AA]">
                <span className={`h-1.5 w-1.5 rounded-full ${rpcDotColor}`} />
                <span>StudioNet · 61999</span>
                <span className="hidden text-[#71717A] sm:inline">({rpcLabel})</span>
              </span>
            </div>
          </div>

          {/* Segmented Tab Switcher */}
          <nav
            aria-label="Primary"
            className="order-3 flex w-full items-center gap-1 rounded-lg border border-white/[0.08] bg-[#0F0F12] p-0.5 lg:order-2 lg:w-auto"
          >
            {(
              [
                { id: 'dossiers', label: 'Incident Dossiers' },
                { id: 'desk', label: 'Indemnity Desk' },
                { id: 'telemetry', label: 'Consensus Telemetry' },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition lg:flex-initial ${
                    active
                      ? 'bg-[#16161B] text-[#FAFAFA] shadow-xs ring-1 ring-white/[0.08]'
                      : 'text-[#A1A1AA] hover:text-[#FAFAFA]'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>

          {/* Contract & RPC Action */}
          <div className="order-2 flex items-center gap-2 lg:order-3">
            {effectiveContract ? (
              <a
                href={`${STUDIONET_EXPLORER_BASE}/address/${effectiveContract}`}
                target="_blank"
                rel="noreferrer"
                title={effectiveContract}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#0F0F12] px-2.5 py-1.5 font-mono text-xs text-[#A1A1AA] transition hover:border-white/[0.14] hover:text-[#FAFAFA]"
              >
                <span>{shortContract}</span>
                <ExternalLink className="h-3 w-3 text-[#71717A]" />
              </a>
            ) : (
              <input
                type="text"
                value={contractOverride}
                onChange={(e) => setContractOverride(e.target.value)}
                placeholder="0x contract address..."
                className="w-44 rounded-md border border-white/[0.08] bg-[#0F0F12] px-2.5 py-1.5 font-mono text-xs text-[#FAFAFA] placeholder-[#71717A] focus:border-white/25 focus:outline-none"
              />
            )}

            <button
              type="button"
              onClick={() => void handleVerifyLive()}
              disabled={!effectiveContract || rpcState === 'verifying'}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#16161B] px-3 py-1.5 text-xs font-medium text-[#FAFAFA] transition hover:border-white/[0.2] hover:bg-[#1E1E24] disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-[#A1A1AA] ${rpcState === 'verifying' ? 'animate-spin' : ''}`}
              />
              <span>Verify Live StudioNet</span>
            </button>
          </div>
        </div>

        {/* Sub-header Protocol Summary Strip */}
        <div className="border-t border-white/[0.06] bg-[#0F0F12]/60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs sm:px-6">
            <span className="text-[#71717A]">
              Bilateral AI-Service Indemnity &amp; Fault-Attribution Protocol
            </span>

            <div className="flex flex-wrap items-center gap-4 text-[#A1A1AA]">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[#71717A]">Exhibits</span>
                <span className="font-mono font-medium text-[#FAFAFA]">
                  {proof.stats.totalCases}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[#71717A]">Pools</span>
                <span className="font-mono font-medium text-[#FAFAFA]">
                  {liveStats?.total_pools ?? proof.stats.totalCases}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-[#71717A]">Upstream Fault</span>
                <span className="font-mono font-medium text-[#FAFAFA]">
                  {liveStats?.upstream_at_fault ?? proof.stats.upstreamFaultCount}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                <span className="text-[#71717A]">Downstream Fault</span>
                <span className="font-mono font-medium text-[#FAFAFA]">
                  {liveStats?.downstream_at_fault ?? proof.stats.downstreamFaultCount}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                <span className="text-[#71717A]">Insufficient / Vague</span>
                <span className="font-mono font-medium text-[#FAFAFA]">
                  {(liveStats?.insufficient_trace ?? proof.stats.insufficientTraceCount) +
                    (liveStats?.too_vague ?? proof.stats.tooVagueCount)}
                </span>
              </span>
            </div>
          </div>
        </div>

        {rpcError && (
          <div className="border-t border-red-500/20 bg-red-500/[0.08] px-4 py-2 text-xs text-red-300 sm:px-6">
            <div className="mx-auto max-w-7xl font-mono">{rpcError}</div>
          </div>
        )}
      </header>

      {/* Main Workspace */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {activeTab === 'dossiers' && (
          <ProofInspector
            proof={proof}
            liveTxMap={liveTxMap}
            walletAddress={walletAddress}
            onVerifySingleTx={(h) => void handleVerifySingleTx(h)}
          />
        )}
        {activeTab === 'desk' && (
          <LiveWalletConsole
            contractAddress={effectiveContract}
            walletAddress={walletAddress}
            onWalletConnected={setWalletAddress}
            onTxSubmitted={handleTxSubmitted}
          />
        )}
        {activeTab === 'telemetry' && (
          <TxLifecycleMonitor proof={proof} walletAddress={walletAddress} />
        )}
      </main>
    </div>
  )
}

export default App
