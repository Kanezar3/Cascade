import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import type { Address, CalldataEncodable, TransactionHash } from 'genlayer-js/types'
import type {
  CascadeAudit,
  CascadePool,
  CascadeProtocolStats,
  CascadeRejected,
  LiveTxStatus,
} from '../types/cascade'
import { mapGenLayerTxStage } from './txTracker'

export const STUDIONET_RPC_ENDPOINT = 'https://studio.genlayer.com/api'
export const STUDIONET_CHAIN_ID = 61999
export const STUDIONET_CHAIN_ID_HEX = '0xf22f'
export const STUDIONET_EXPLORER_BASE = 'https://explorer-studio.genlayer.com'

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

function getEthereumProvider(): EthereumProvider | null {
  if (typeof globalThis === 'undefined') return null
  const win = globalThis as unknown as { ethereum?: EthereumProvider }
  return win.ethereum ?? null
}

export function getReadClient(accountAddress?: string) {
  return createClient({
    chain: studionet,
    endpoint: STUDIONET_RPC_ENDPOINT,
    ...(accountAddress ? { account: accountAddress as Address } : {}),
  })
}

export function unwrapViewResult<T>(raw: unknown): T {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed) as T
      } catch {
        return raw as unknown as T
      }
    }
    return raw as unknown as T
  }
  if (raw instanceof Map) {
    const obj: Record<string, unknown> = {}
    for (const [k, v] of raw.entries()) {
      obj[String(k)] = unwrapViewResult(v)
    }
    return obj as T
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => unwrapViewResult(item)) as unknown as T
  }
  return raw as T
}

export async function fetchAllPools(contractAddress: string): Promise<CascadePool[]> {
  if (!contractAddress) return []
  const client = getReadClient()
  const raw = await client.readContract({
    address: contractAddress as Address,
    functionName: 'get_all_pools',
    args: [],
  })
  const parsed = unwrapViewResult<unknown>(raw)
  return Array.isArray(parsed) ? (parsed as CascadePool[]) : []
}

export async function fetchAllAudits(contractAddress: string): Promise<CascadeAudit[]> {
  if (!contractAddress) return []
  const client = getReadClient()
  const raw = await client.readContract({
    address: contractAddress as Address,
    functionName: 'get_all_audits',
    args: [],
  })
  const parsed = unwrapViewResult<unknown>(raw)
  return Array.isArray(parsed) ? (parsed as CascadeAudit[]) : []
}

export async function fetchRejectedSubmissions(
  contractAddress: string
): Promise<CascadeRejected[]> {
  if (!contractAddress) return []
  const client = getReadClient()
  const raw = await client.readContract({
    address: contractAddress as Address,
    functionName: 'get_rejected_submissions',
    args: [],
  })
  const parsed = unwrapViewResult<unknown>(raw)
  return Array.isArray(parsed) ? (parsed as CascadeRejected[]) : []
}

export async function fetchProtocolStats(
  contractAddress: string
): Promise<CascadeProtocolStats | null> {
  if (!contractAddress) return null
  const client = getReadClient()
  const raw = await client.readContract({
    address: contractAddress as Address,
    functionName: 'get_protocol_stats',
    args: [],
  })
  const parsed = unwrapViewResult<unknown>(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as CascadeProtocolStats
  }
  return null
}

export async function fetchRefundableBalance(
  contractAddress: string,
  accountAddress: string
): Promise<string> {
  if (!contractAddress || !accountAddress) return '0'
  const client = getReadClient()
  const raw = await client.readContract({
    address: contractAddress as Address,
    functionName: 'get_refundable_balance',
    args: [accountAddress],
  })
  const parsed = unwrapViewResult<unknown>(raw)
  if (typeof parsed === 'bigint' || typeof parsed === 'number') {
    return String(parsed)
  }
  if (typeof parsed === 'string') return parsed
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    return String(obj.balance_wei ?? obj.refundable_wei ?? obj.amount ?? '0')
  }
  return '0'
}

export async function fetchTransactionStatus(txHash: string): Promise<LiveTxStatus> {
  if (!txHash || !txHash.startsWith('0x')) {
    throw new Error('Transaction hash must be a 0x-prefixed hex string.')
  }
  const client = getReadClient()
  const raw = await client.getTransaction({
    hash: txHash as TransactionHash,
  })
  return mapGenLayerTxStage(txHash, raw as unknown as Record<string, unknown>)
}

export async function connectStudioNetWallet(): Promise<{
  address: string
  chainId: number
}> {
  const ethereum = getEthereumProvider()
  if (!ethereum) {
    throw new Error(
      'MetaMask (window.ethereum) is required for write transactions. Read-only StudioNet verification works without a wallet.'
    )
  }

  const accounts = (await ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!accounts || accounts.length === 0) {
    throw new Error('No wallet account authorized in MetaMask.')
  }

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    })
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: STUDIONET_CHAIN_ID_HEX,
            chainName: 'GenLayer StudioNet',
            rpcUrls: [STUDIONET_RPC_ENDPOINT],
            nativeCurrency: {
              name: 'GEN',
              symbol: 'GEN',
              decimals: 18,
            },
            blockExplorerUrls: [STUDIONET_EXPLORER_BASE],
          },
        ],
      })
    } else {
      throw err
    }
  }

  const chainHex = (await ethereum.request({
    method: 'eth_chainId',
  })) as string

  return {
    address: accounts[0],
    chainId: Number.parseInt(chainHex, 16),
  }
}

export async function writeCascadeContract(params: {
  contractAddress: string
  accountAddress: string
  functionName:
    | 'open_indemnity_pool'
    | 'submit_fault_audit'
    | 'settle_expired_pool'
    | 'withdraw_refundable'
  args: CalldataEncodable[]
  valueWei?: string
}): Promise<string> {
  const ethereum = getEthereumProvider()
  if (!ethereum) {
    throw new Error(
      'MetaMask (window.ethereum) is required for write transactions. Read-only StudioNet verification works without a wallet.'
    )
  }
  if (!params.contractAddress) {
    throw new Error('Contract address is not configured yet.')
  }

  const client = getReadClient(params.accountAddress)
  const txHash = await client.writeContract({
    address: params.contractAddress as Address,
    functionName: params.functionName,
    args: params.args,
    value: params.valueWei ? BigInt(params.valueWei) : 0n,
  })

  return String(txHash)
}

export async function appealCascadeTransaction(params: {
  accountAddress: string
  txHash: string
}): Promise<string> {
  const ethereum = getEthereumProvider()
  if (!ethereum) {
    throw new Error(
      'MetaMask (window.ethereum) is required to submit an appeal transaction.'
    )
  }
  const client = getReadClient(params.accountAddress)
  const txId = params.txHash as `0x${string}`
  const minBond = await client.getMinAppealBond({ txId })
  const result = await client.appealTransaction({
    txId,
    value: minBond,
  })
  return String(result)
}
