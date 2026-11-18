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
    : 'UNDEPLOYED'

  return (
    <div className="min-h-screen bg-[#0A0D12] text-[#F1F5F9]">
      {/* Industrial Flight-Recorder Header & Telemetry Bar */}
      <header className="border-b border-[#1F293B] bg-[#11161F]">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="Cascade Emblem"
                className="h-9 w-9 rounded border border-[#1F293B] bg-[#0A0D12] object-contain p-0.5"
              />
              <div>
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#FCD34D]">
                  <span>CASCADE // STUDIONET 61999</span>
                  <span className="text-[#475569]">|</span>
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      rpcState === 'synced'
                        ? 'text-[#6EE7B7]'
                        : rpcState === 'verifying'
                          ? 'text-[#FCD34D]'
                          : rpcState === 'error'
                            ? 'text-[#FCA5A5]'
                            : 'text-[#94A3B8]'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {rpcState === 'verifying'
                      ? 'VERIFYING RPC'
                      : rpcState === 'synced'
                        ? 'LIVE SYNCED'
                        : rpcState === 'error'
                          ? 'RPC ERROR'
                          : proof.isPlaceholder
                            ? 'PLACEHOLDER MODE'
                            : 'READY'}
                  </span>
                </div>
                <h1 className="font-display text-base font-bold tracking-tight text-[#F1F5F9] sm:text-lg">
                  Bilateral AI-Service Indemnity &amp; Fault-Attribution Console
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {effectiveContract ? (
                <a
                  href={`${STUDIONET_EXPLORER_BASE}/address/${effectiveContract}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#94A3B8] hover:border-[#334155] hover:text-[#F1F5F9]"
                >
                  Contract {shortContract}
                  <ExternalLink className="h-3 w-3 text-[#FCD34D]" />
                </a>
              ) : (
                <input
                  type="text"
                  value={contractOverride}
                  onChange={(e) => setContractOverride(e.target.value)}
                  placeholder="Optional 0x contract address..."
                  className="w-56 rounded border border-[#1F293B] bg-[#0A0D12] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9] placeholder-[#475569]"
                />
              )}

              <button
                type="button"
                onClick={() => void handleVerifyLive()}
                disabled={!effectiveContract || rpcState === 'verifying'}
                className="inline-flex items-center gap-1.5 rounded border border-[#D97706]/50 bg-[#451A03]/60 px-3 py-1.5 font-mono text-xs font-medium text-[#FCD34D] transition hover:bg-[#451A03] disabled:opacity-40"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${rpcState === 'verifying' ? 'animate-spin' : ''}`}
                />
                Verify Live StudioNet
              </button>
            </div>
          </div>

          {/* Telemetry Counters + 3 Crisp Tabs */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#1F293B] pt-3">
            <nav className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'dossiers', label: '01 // INCIDENT DOSSIERS' },
                  { id: 'desk', label: '02 // INDEMNITY DESK' },
                  { id: 'telemetry', label: '03 // CONSENSUS TELEMETRY' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded border px-3 py-1.5 font-mono text-xs font-medium transition ${
                    activeTab === tab.id
                      ? 'border-[#D97706]/60 bg-[#151C28] text-[#FCD34D]'
                      : 'border-transparent bg-transparent text-[#94A3B8] hover:border-[#1F293B] hover:text-[#F1F5F9]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#94A3B8]">
              <span>
                Exhibits:{' '}
                <strong className="text-[#F1F5F9]">{proof.stats.totalCases}</strong>
              </span>
              <span>
                Pools:{' '}
                <strong className="text-[#F1F5F9]">
                  {liveStats?.total_pools ?? proof.stats.totalCases}
                </strong>
              </span>
              <span className="text-[#FCD34D]">
                Upstream Fault:{' '}
                {liveStats?.upstream_at_fault ?? proof.stats.upstreamFaultCount}
              </span>
              <span className="text-[#FCA5A5]">
                Downstream Fault:{' '}
                {liveStats?.downstream_at_fault ?? proof.stats.downstreamFaultCount}
              </span>
              <span className="text-[#D8B4FE]">
                Insufficient/Vague:{' '}
                {(liveStats?.insufficient_trace ?? proof.stats.insufficientTraceCount) +
                  (liveStats?.too_vague ?? proof.stats.tooVagueCount)}
              </span>
            </div>
          </div>

          {rpcError && (
            <div className="mt-2 rounded border border-[#DC2626]/50 bg-[#450A0A]/40 px-3 py-1.5 font-mono text-xs text-[#FCA5A5]">
              {rpcError}
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
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
