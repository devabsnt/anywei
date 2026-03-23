/**
 * Wallet connection via RainbowKit (React island mounted into a target element).
 * Exposes a simple API for the rest of the vanilla JS app.
 */
import React, { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider, useAccount, usePublicClient, useWalletClient, createConfig, http } from 'wagmi'
import { mainnet, sepolia, holesky, polygon, arbitrum, optimism, base, avalanche, bsc } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, ConnectButton, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'

const anyWeiTheme = darkTheme({
  accentColor: '#f59e0b',
  accentColorForeground: '#000',
  borderRadius: 'none',
  fontStack: 'system',
})

// ── Config ──────────────────────────────────────────────────

const config = getDefaultConfig({
  appName: 'anywei.dev',
  projectId: 'anywei_dev_local', // WalletConnect project ID (needed for WC but works without for injected)
  chains: [mainnet, sepolia, holesky, polygon, arbitrum, optimism, base, avalanche, bsc],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [holesky.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [base.id]: http(),
    [avalanche.id]: http(),
    [bsc.id]: http(),
  }
})

const queryClient = new QueryClient()

// ── Shared state ────────────────────────────────────────────

let currentAccount = null
let currentChainId = null
let currentChainName = null
let wagmiPublicClient = null
let wagmiWalletClient = null
let listeners = []

export function onWalletChange(fn) { listeners.push(fn) }
function notify() { listeners.forEach(fn => fn(getState())) }

export function getState() {
  return {
    account: currentAccount,
    chainId: currentChainId,
    chainName: currentChainName,
    connected: !!currentAccount,
    publicClient: wagmiPublicClient,
    walletClient: wagmiWalletClient,
  }
}

// ── React bridge component ──────────────────────────────────

function WalletBridge() {
  const { address, chain, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  useEffect(() => {
    currentAccount = isConnected ? address : null
    currentChainId = chain?.id || null
    currentChainName = chain?.name || (currentChainId ? `Chain ${currentChainId}` : null)
    wagmiPublicClient = publicClient || null
    wagmiWalletClient = walletClient || null
    notify()
  }, [address, chain, isConnected, publicClient, walletClient])

  return null // invisible — just syncs state
}

// ── Mount function ──────────────────────────────────────────

let currentRoot = null

/**
 * Mount the RainbowKit connect button into a target DOM element,
 * and an invisible bridge component that syncs wallet state to our vanilla JS.
 */
export function mountWallet(buttonContainer) {
  // Unmount previous root if container was destroyed (tab switch)
  if (currentRoot) {
    try { currentRoot.unmount() } catch {}
  }

  const btnRoot = createRoot(buttonContainer)
  currentRoot = btnRoot
  btnRoot.render(
    createElement(WagmiProvider, { config },
      createElement(QueryClientProvider, { client: queryClient },
        createElement(RainbowKitProvider, { modalSize: 'compact', theme: anyWeiTheme },
          createElement(ConnectButton, { chainStatus: 'full', showBalance: true, accountStatus: 'address' }),
          createElement(WalletBridge)
        )
      )
    )
  )
}

// ── Contract interaction (uses synced clients) ──────────────

export async function deployContract({ bytecode, abi, constructorArgs = [], value = 0n }) {
  if (!wagmiWalletClient || !wagmiPublicClient) throw new Error('Wallet not connected')

  const hash = await wagmiWalletClient.deployContract({
    abi,
    bytecode,
    args: constructorArgs,
    value,
  })

  const receipt = await wagmiPublicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') throw new Error('Deploy transaction reverted')

  return { address: receipt.contractAddress, hash, gasUsed: receipt.gasUsed }
}

export async function callContract({ address, abi, functionName, args = [], value = 0n }) {
  if (!wagmiPublicClient) throw new Error('Wallet not connected')

  const fnAbi = abi.find(e => e.type === 'function' && e.name === functionName)

  if (fnAbi && (fnAbi.stateMutability === 'view' || fnAbi.stateMutability === 'pure')) {
    const result = await wagmiPublicClient.readContract({ address, abi, functionName, args })
    return { result, hash: null, receipt: null }
  }

  if (!wagmiWalletClient) throw new Error('Wallet not connected')
  const hash = await wagmiWalletClient.writeContract({ address, abi, functionName, args, value })
  const receipt = await wagmiPublicClient.waitForTransactionReceipt({ hash })
  return { result: null, hash, receipt }
}
