const PROXY_BASE = '/api/etherscan'
const EIP1967_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

const cache = new Map()

export async function fetchAbi(address) {
  const key = address.toLowerCase()
  if (cache.has(key)) return cache.get(key)

  const [abiRes, srcRes] = await Promise.all([
    fetch(`${PROXY_BASE}?module=contract&action=getabi&address=${address}`).then(r => r.json()),
    fetch(`${PROXY_BASE}?module=contract&action=getsourcecode&address=${address}`).then(r => r.json())
  ])

  let abi = null
  let contractName = ''
  let isProxy = false
  let implementation = null

  if (abiRes.status === '1' && abiRes.result) {
    try { abi = JSON.parse(abiRes.result) } catch {}
  }

  if (srcRes.status === '1' && srcRes.result?.[0]) {
    contractName = srcRes.result[0].ContractName || ''
    isProxy = srcRes.result[0].Proxy === '1'
    implementation = srcRes.result[0].Implementation || null
  }

  // Detect proxy ABI
  if (abi && !isProxy && isProxyAbi(abi)) {
    isProxy = true
    if (!implementation) {
      implementation = await detectEIP1967(address)
    }
  }

  // Fetch implementation ABI for proxies
  if (isProxy && implementation) {
    const implRes = await fetch(`${PROXY_BASE}?module=contract&action=getabi&address=${implementation}`).then(r => r.json())
    if (implRes.status === '1' && implRes.result) {
      try { abi = JSON.parse(implRes.result) } catch {}
    }
  }

  const result = { abi, contractName, isProxy, implementation }
  cache.set(key, result)
  return result
}

function isProxyAbi(abi) {
  const funcs = abi.filter(e => e.type === 'function')
  if (funcs.length <= 3) return true
  const proxyNames = ['implementation', 'upgradeTo', 'upgradeToAndCall', 'admin', 'changeAdmin']
  return funcs.filter(f => proxyNames.includes(f.name)).length >= 2 && funcs.length <= 6
}

async function detectEIP1967(address) {
  try {
    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getStorageAt', params: [address, EIP1967_SLOT, 'latest'], id: 1 })
    })
    const data = await res.json()
    if (data.result && data.result !== '0x' + '0'.repeat(64)) {
      const impl = '0x' + data.result.slice(26)
      if (impl !== '0x' + '0'.repeat(40)) return impl
    }
  } catch {}
  return null
}

export function clearCache() { cache.clear() }
