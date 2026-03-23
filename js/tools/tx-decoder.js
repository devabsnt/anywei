import { decodeFunctionData, decodeEventLog, parseAbi, formatEther, formatGwei } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { lookupSelector, lookupEventTopic } from '../shared/etherscan.js'
import { esc, copyBtn, etherscanLink, ensure0x } from '../shared/formatters.js'

async function rpcCall(method, params) {
  const res = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() })
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.result
}

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Transaction Decoder</h2>
      <p class="tool-desc">Paste a transaction hash to see decoded calldata, events, gas breakdown, and more.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Transaction hash</label>
        <input type="text" id="tx-hash" class="mono-input" placeholder="0x..." spellcheck="false">
      </div>
      <div id="tx-output" class="output-area"></div>
    </div>
  `

  const hashInput = document.getElementById('tx-hash')
  const output = document.getElementById('tx-output')

  hashInput.addEventListener('change', decode)
  hashInput.addEventListener('paste', () => setTimeout(decode, 50))

  async function decode() {
    const hash = hashInput.value.trim()
    if (!hash || hash.length !== 66) return
    output.innerHTML = '<div class="loading">Fetching transaction...</div>'

    try {
      const [tx, receipt] = await Promise.all([
        rpcCall('eth_getTransactionByHash', [hash]),
        rpcCall('eth_getTransactionReceipt', [hash])
      ])

      if (!tx) { output.innerHTML = '<div class="result-card error">Transaction not found</div>'; return }

      const gasUsed = receipt ? parseInt(receipt.gasUsed, 16) : 0
      const gasPrice = parseInt(tx.gasPrice || '0x0', 16)
      const value = BigInt(tx.value || '0x0')
      const status = receipt?.status === '0x1' ? 'Success' : receipt?.status === '0x0' ? 'Reverted' : 'Pending'
      const statusClass = status === 'Success' ? 'success' : status === 'Reverted' ? 'error' : 'warning'
      const costWei = BigInt(gasUsed) * BigInt(gasPrice)

      let html = `<div class="result-card">
        <div class="tx-status ${statusClass}">${status}</div>
        <table class="params-table">
          <tbody>
            <tr><td class="text-dim">Hash</td><td class="mono" style="word-break:break-all">${esc(hash)}</td></tr>
            <tr><td class="text-dim">From</td><td><a href="${etherscanLink(tx.from)}" target="_blank" class="text-blue mono">${esc(tx.from)}</a></td></tr>
            <tr><td class="text-dim">To</td><td>${tx.to ? `<a href="${etherscanLink(tx.to)}" target="_blank" class="text-blue mono">${esc(tx.to)}</a>` : '<span class="text-purple">Contract Creation</span>'}</td></tr>
            <tr><td class="text-dim">Value</td><td class="mono">${formatEther(value)} ETH${value > 0n ? ` <span class="text-dim">(${value.toString()} wei)</span>` : ''}</td></tr>
            <tr><td class="text-dim">Gas Used</td><td class="mono">${gasUsed.toLocaleString()}${receipt ? ` / ${parseInt(tx.gas, 16).toLocaleString()}` : ''}</td></tr>
            <tr><td class="text-dim">Gas Price</td><td class="mono">${formatGwei(BigInt(gasPrice))} gwei</td></tr>
            <tr><td class="text-dim">Tx Cost</td><td class="mono">${formatEther(costWei)} ETH</td></tr>
            <tr><td class="text-dim">Block</td><td class="mono">${tx.blockNumber ? parseInt(tx.blockNumber, 16).toLocaleString() : 'Pending'}</td></tr>
            <tr><td class="text-dim">Nonce</td><td class="mono">${parseInt(tx.nonce, 16)}</td></tr>
          </tbody>
        </table>
      </div>`

      // Decode calldata
      if (tx.input && tx.input.length > 2 && tx.to) {
        html += await decodeCalldata(tx.to, tx.input)
      } else if (!tx.to) {
        html += `<div class="result-card"><div class="text-dim">Contract creation (${((tx.input?.length || 2) - 2) / 2} bytes of init code)</div></div>`
      }

      // Decode events
      if (receipt?.logs?.length > 0) {
        html += `<div class="result-card"><div class="fn-signature">Events (${receipt.logs.length})</div>`
        for (const log of receipt.logs) {
          html += await decodeLog(log, tx.to)
        }
        html += '</div>'
      }

      // Contract created
      if (receipt?.contractAddress) {
        html += `<div class="result-card"><div class="text-dim">Contract deployed at:</div><a href="${etherscanLink(receipt.contractAddress)}" target="_blank" class="text-blue mono">${esc(receipt.contractAddress)}</a></div>`
      }

      output.innerHTML = html
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }

  async function decodeCalldata(to, data) {
    const selector = data.slice(0, 10)
    let abi = null
    try { const r = await fetchAbi(to); abi = r.abi } catch {}

    if (abi) {
      try {
        const result = decodeFunctionData({ abi, data })
        const fnAbi = abi.find(e => e.type === 'function' && e.name === result.functionName)
        const inputs = fnAbi?.inputs || []
        let rows = ''
        for (let i = 0; i < (result.args?.length || 0); i++) {
          const inp = inputs[i] || {}
          const val = result.args[i]
          rows += `<tr><td class="text-dim">${esc(inp.name || `arg${i}`)}</td><td class="text-dim">${esc(inp.type)}</td><td class="mono" style="word-break:break-all">${formatVal(val)}</td></tr>`
        }
        return `<div class="result-card"><div class="fn-signature"><span class="selector-badge">${esc(selector)}</span> <span class="text-purple">${esc(result.functionName)}</span></div><table class="params-table"><tbody>${rows}</tbody></table></div>`
      } catch {}
    }

    // Fallback: selector lookup
    const sigs = await lookupSelector(selector)
    return `<div class="result-card"><div class="selector-badge">${esc(selector)}</div>${sigs.length ? `<div class="text-dim">Possible: ${sigs.map(s => `<span class="mono">${esc(s)}</span>`).join(', ')}</div>` : '<div class="text-dim">Unknown function</div>'}</div>`
  }

  async function decodeLog(log, contractAddr) {
    if (!log.topics?.length) return ''
    const topic0 = log.topics[0]

    // Try contract ABI first
    let abi = null
    try { const r = await fetchAbi(log.address); abi = r.abi } catch {}
    if (!abi && log.address !== contractAddr) {
      try { const r = await fetchAbi(contractAddr); abi = r.abi } catch {}
    }

    if (abi) {
      try {
        const result = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: false })
        const evtAbi = abi.find(e => e.type === 'event' && e.name === result.eventName)
        const inputs = evtAbi?.inputs || []
        let params = inputs.map((inp, i) => {
          const val = result.args ? (Array.isArray(result.args) ? result.args[i] : result.args[inp.name]) : null
          return `<span class="text-dim">${esc(inp.name)}</span>=<span class="mono">${formatVal(val)}</span>`
        }).join(', ')
        return `<div class="tx-log"><span class="text-purple">${esc(result.eventName)}</span>(${params}) <span class="text-dim" style="font-size:10px">${log.address.slice(0, 10)}...</span></div>`
      } catch {}
    }

    // Fallback
    const sigs = await lookupEventTopic(topic0)
    return `<div class="tx-log"><span class="text-dim">${sigs[0] || topic0.slice(0, 10) + '...'}</span> <span class="text-dim" style="font-size:10px">${log.address.slice(0, 10)}...</span></div>`
  }

  function formatVal(val) {
    if (val === null || val === undefined) return '<span class="text-dim">null</span>'
    if (typeof val === 'bigint') return esc(val.toString())
    if (typeof val === 'string' && val.startsWith('0x') && val.length === 42) return `<a href="${etherscanLink(val)}" target="_blank" class="text-blue">${esc(val)}</a>`
    if (typeof val === 'boolean') return val ? 'true' : 'false'
    if (Array.isArray(val)) return `[${val.map(v => formatVal(v)).join(', ')}]`
    return esc(String(val))
  }
}
