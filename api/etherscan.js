const BLOCKSCOUT_BASE = 'https://eth.blockscout.com/api'

export default async function handler(req, res) {
  const { module, action, address, startblock, endblock, page, offset, sort } = req.query

  if (!address || !module || !action) {
    return res.status(400).json({ status: '0', message: 'NOTOK', result: 'Missing required params' })
  }

  // ABI: Sourcify first, Blockscout fallback
  if (action === 'getabi') {
    const abi = await fetchAbiFromSourcify(address)
    if (abi) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400')
      return res.json({ status: '1', message: 'OK', result: abi })
    }
    // Try Blockscout
    const blockscoutAbi = await fetchFromBlockscout({ module, action, address })
    res.setHeader('Cache-Control', blockscoutAbi?.status === '1' ? 's-maxage=86400, stale-while-revalidate=86400' : 's-maxage=60')
    return res.json(blockscoutAbi || { status: '0', message: 'NOTOK', result: 'Contract not verified' })
  }

  // Source code: Sourcify first, Blockscout fallback
  if (action === 'getsourcecode') {
    const sourceData = await fetchSourceFromSourcify(address)
    if (sourceData) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400')
      return res.json({ status: '1', message: 'OK', result: [sourceData] })
    }
    const blockscoutSource = await fetchFromBlockscout({ module, action, address })
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400')
    return res.json(blockscoutSource || { status: '1', message: 'OK', result: [{ ContractName: '', Proxy: '0', Implementation: '' }] })
  }

  // Transaction lists: Blockscout
  const params = new URLSearchParams({ module, action, address })
  if (startblock) params.set('startblock', startblock)
  if (endblock) params.set('endblock', endblock)
  if (page) params.set('page', page)
  if (offset) params.set('offset', offset)
  if (sort) params.set('sort', sort)

  try {
    const resp = await fetch(`${BLOCKSCOUT_BASE}?${params}`)
    const data = await resp.json()
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    res.json(data)
  } catch (err) {
    res.status(502).json({ status: '0', message: 'NOTOK', result: `Blockscout error: ${err.message}` })
  }
}

async function fetchFromBlockscout(params) {
  try {
    const qs = new URLSearchParams(params)
    const resp = await fetch(`${BLOCKSCOUT_BASE}?${qs}`)
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

async function fetchAbiFromSourcify(address) {
  for (const match of ['full_match', 'partial_match']) {
    try {
      const url = `https://repo.sourcify.dev/contracts/${match}/1/${address}/metadata.json`
      const resp = await fetch(url)
      if (!resp.ok) continue
      const metadata = JSON.parse(await resp.text())
      if (metadata?.output?.abi) {
        return JSON.stringify(metadata.output.abi)
      }
    } catch {}
  }

  try {
    const url = `https://sourcify.dev/server/files/any/1/${address}`
    const resp = await fetch(url)
    if (!resp.ok) return null
    const data = await resp.json()
    const metadataFile = data.files?.find(f => f.name === 'metadata.json')
    if (metadataFile) {
      const metadata = JSON.parse(metadataFile.content)
      if (metadata?.output?.abi) {
        return JSON.stringify(metadata.output.abi)
      }
    }
  } catch {}

  return null
}

async function fetchSourceFromSourcify(address) {
  for (const match of ['full_match', 'partial_match']) {
    try {
      const url = `https://repo.sourcify.dev/contracts/${match}/1/${address}/metadata.json`
      const resp = await fetch(url)
      if (!resp.ok) continue
      const metadata = JSON.parse(await resp.text())
      const target = metadata?.settings?.compilationTarget
      const contractName = target ? Object.values(target)[0] : ''
      return {
        ContractName: contractName || '',
        ABI: JSON.stringify(metadata?.output?.abi || []),
        Proxy: '0',
        Implementation: ''
      }
    } catch {}
  }
  return null
}
