const RPC_URLS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.llamarpc.com',
  'https://rpc.mevblocker.io'
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' })
  }

  const body = req.body
  if (!body || !body.method) {
    return res.status(400).json({ error: 'Invalid JSON-RPC request' })
  }

  // Cacheable methods — contract code and storage don't change often
  const cacheableMethods = ['eth_getCode', 'eth_getStorageAt', 'eth_getBalance', 'eth_getProof']
  const isCacheable = cacheableMethods.includes(body.method)

  let lastError = null
  for (const rpcUrl of RPC_URLS) {
    try {
      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!resp.ok) {
        lastError = `${rpcUrl}: HTTP ${resp.status}`
        continue
      }

      const data = await resp.json()

      // If the RPC returned an error, try next
      if (data.error) {
        lastError = `${rpcUrl}: ${data.error.message || JSON.stringify(data.error)}`
        continue
      }

      // Cache immutable data at the edge
      if (isCacheable && data.result) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
      } else {
        res.setHeader('Cache-Control', 'no-cache')
      }

      return res.json(data)
    } catch (err) {
      lastError = `${rpcUrl}: ${err.message}`
      continue
    }
  }

  // All RPCs failed
  res.status(502).json({
    jsonrpc: '2.0',
    id: body.id || null,
    error: { code: -32000, message: `All RPCs failed. Last error: ${lastError}` }
  })
}
