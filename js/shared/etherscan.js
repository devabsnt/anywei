const PROXY_BASE = '/api/etherscan'

export async function fetchRecentTxs(address, count = 50) {
  const url = `${PROXY_BASE}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${count}&sort=desc`
  const res = await fetch(url)
  const data = await res.json()
  if (data.status !== '1' || !Array.isArray(data.result)) return []
  return data.result
}

export async function fetchBytecode(address) {
  const res = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getCode', params: [address, 'latest'], id: 1 })
  })
  const data = await res.json()
  return data.result || '0x'
}

export async function readStorageSlot(address, slot) {
  const res = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getStorageAt', params: [address, slot, 'latest'], id: 1 })
  })
  const data = await res.json()
  return data.result || '0x' + '0'.repeat(64)
}

// 4byte.directory + OpenChain lookup for function selectors
export async function lookupSelector(selector) {
  const results = []
  const hex = selector.startsWith('0x') ? selector : '0x' + selector

  // OpenChain
  try {
    const res = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${hex}`)
    const data = await res.json()
    if (data.ok && data.result?.function?.[hex]) {
      for (const sig of data.result.function[hex]) {
        results.push(sig.name)
      }
    }
  } catch {}

  // 4byte.directory fallback
  if (results.length === 0) {
    try {
      const res = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${hex}`)
      const data = await res.json()
      if (data.results) {
        for (const r of data.results) results.push(r.text_signature)
      }
    } catch {}
  }

  return results
}

// Lookup event topic
export async function lookupEventTopic(topic) {
  const results = []
  const hex = topic.startsWith('0x') ? topic : '0x' + topic

  try {
    const res = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?event=${hex}`)
    const data = await res.json()
    if (data.ok && data.result?.event?.[hex]) {
      for (const sig of data.result.event[hex]) {
        results.push(sig.name)
      }
    }
  } catch {}

  return results
}

// Current gas price + ETH price
let priceCache = null
let priceTs = 0

export async function getPriceData() {
  if (priceCache && Date.now() - priceTs < 30000) return priceCache
  try {
    const [gasRes, ethRes] = await Promise.all([
      fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 })
      }).then(r => r.json()),
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd').then(r => r.json())
    ])
    priceCache = {
      gasPrice: BigInt(gasRes.result || '0x2540be400'),
      ethPrice: ethRes.ethereum?.usd || 0
    }
    priceTs = Date.now()
  } catch {
    if (!priceCache) priceCache = { gasPrice: 10000000000n, ethPrice: 0 }
  }
  return priceCache
}
