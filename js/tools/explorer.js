import { decodeFunctionData, decodeEventLog, parseAbi, formatEther, formatGwei } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { fetchRecentTxs, lookupSelector, lookupEventTopic, fetchBytecode } from '../shared/etherscan.js'
import { esc, copyBtn, etherscanLink, ensure0x, truncAddr } from '../shared/formatters.js'

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

export function render(container, queryParams = {}) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Explorer</h2>
      <p class="tool-desc">Paste an address or transaction hash. Auto-detects which one and shows the right view.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <input type="text" id="exp-input" class="mono-input" placeholder="0x address or transaction hash" spellcheck="false" style="font-size:14px;padding:12px">
      </div>
      <div id="exp-output" class="output-area"></div>
      <div id="exp-modal" class="exp-modal hidden">
        <div class="exp-modal-overlay" id="exp-modal-overlay"></div>
        <div class="exp-modal-content" id="exp-modal-content"></div>
      </div>
    </div>
  `

  const input = document.getElementById('exp-input')
  const output = document.getElementById('exp-output')
  const modal = document.getElementById('exp-modal')
  const modalOverlay = document.getElementById('exp-modal-overlay')
  const modalContent = document.getElementById('exp-modal-content')

  if (queryParams.q) {
    input.value = queryParams.q
    setTimeout(() => lookup(queryParams.q), 50)
  }

  input.addEventListener('change', () => lookup(input.value.trim()))
  input.addEventListener('paste', () => setTimeout(() => lookup(input.value.trim()), 50))

  // Close modal on overlay click or Escape
  modalOverlay.addEventListener('click', closeModal)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal() })

  function closeModal() { modal.classList.add('hidden'); modalContent.innerHTML = '' }

  function openTxModal(hash) {
    modal.classList.remove('hidden')
    modalContent.innerHTML = '<div class="loading">Loading transaction...</div>'
    renderTx(hash, modalContent)
  }

  // Clicking addresses navigates main view, tx hashes open modal
  output.addEventListener('click', (e) => {
    const link = e.target.closest('.exp-link')
    if (!link) return
    e.preventDefault()
    const val = link.dataset.value
    if (val.length === 66) { openTxModal(val); return }
    input.value = val
    lookup(val)
  })

  // Clicking inside modal: addresses close modal and navigate, tx hashes open new modal
  modalContent.addEventListener('click', (e) => {
    const link = e.target.closest('.exp-link')
    if (!link) return
    e.preventDefault()
    const val = link.dataset.value
    if (val.length === 66) { openTxModal(val); return }
    closeModal()
    input.value = val
    lookup(val)
  })

  function lookup(val) {
    if (!val || !val.startsWith('0x')) return
    window.history.replaceState(null, '', `/explorer?q=${val}`)

    if (val.length === 42) renderAddress(val)
    else if (val.length === 66) openTxModal(val)
    else output.innerHTML = '<div class="result-card text-dim">Paste a 42-character address or 66-character tx hash</div>'
  }

  // ── Address View ────────────────────────────────────────

  async function renderAddress(addr) {
    output.innerHTML = '<div class="loading">Loading address...</div>'

    try {
      const [balanceHex, nonceHex, code, abiResult, txs] = await Promise.all([
        rpcCall('eth_getBalance', [addr, 'latest']),
        rpcCall('eth_getTransactionCount', [addr, 'latest']),
        fetchBytecode(addr).catch(() => '0x'),
        fetchAbi(addr).catch(() => ({ abi: null, contractName: '', isProxy: false })),
        fetchRecentTxs(addr, 50).catch(() => [])
      ])

      const balance = BigInt(balanceHex || '0x0')
      const nonce = parseInt(nonceHex || '0x0', 16)
      const isContract = code && code !== '0x' && code.length > 2
      const codeSize = isContract ? (code.length - 2) / 2 : 0
      const fnCount = abiResult.abi?.filter(e => e.type === 'function').length || 0
      const evtCount = abiResult.abi?.filter(e => e.type === 'event').length || 0

      let html = `<div class="result-card">
        <div class="exp-addr-header">
          <span class="mono" style="font-size:14px;word-break:break-all">${esc(addr)}</span>
          <a href="${etherscanLink(addr)}" target="_blank" class="text-blue" style="font-size:11px;margin-left:8px">Etherscan</a>
        </div>
        <table class="params-table" style="margin-top:8px">
          <tbody>
            <tr><td class="text-dim">Balance</td><td class="mono">${formatEther(balance)} ETH</td></tr>
            <tr><td class="text-dim">Nonce</td><td class="mono">${nonce}</td></tr>
            <tr><td class="text-dim">Type</td><td>${isContract ? `<span class="badge payable-badge">Contract</span> ${codeSize.toLocaleString()} bytes` : 'EOA (wallet)'}</td></tr>
            ${abiResult.contractName ? `<tr><td class="text-dim">Name</td><td>${esc(abiResult.contractName)}${abiResult.isProxy ? ' <span class="badge view-badge">Proxy</span>' : ''}</td></tr>` : ''}
            ${isContract && abiResult.abi ? `<tr><td class="text-dim">Interface</td><td>${fnCount} functions, ${evtCount} events</td></tr>` : ''}
          </tbody>
        </table>
      </div>`

      // Recent transactions
      if (txs.length > 0) {
        html += `<div class="result-card"><div class="fn-signature">Recent Transactions (${txs.length})</div>`
        html += '<div class="exp-tx-list">'
        for (const tx of txs) {
          const isIncoming = tx.to?.toLowerCase() === addr.toLowerCase()
          const isOutgoing = tx.from?.toLowerCase() === addr.toLowerCase()
          const dirIcon = isIncoming ? '<span class="exp-dir exp-in">IN</span>' : isOutgoing ? '<span class="exp-dir exp-out">OUT</span>' : ''
          const value = BigInt(tx.value || '0')
          const gasUsed = parseInt(tx.gasUsed || '0')
          const status = tx.isError === '1' ? '<span class="error">FAIL</span>' : tx.isError === '0' ? '<span class="success">OK</span>' : ''

          // Try to decode function name
          let fnLabel = ''
          if (tx.input && tx.input.length >= 10 && abiResult.abi) {
            try {
              const decoded = decodeFunctionData({ abi: abiResult.abi, data: tx.input })
              fnLabel = `<span class="text-purple">${esc(decoded.functionName)}</span>`
            } catch {}
          }
          if (!fnLabel && tx.input && tx.input.length >= 10) {
            fnLabel = `<span class="text-dim">${tx.input.slice(0, 10)}</span>`
          }
          if (!fnLabel && tx.input === '0x') fnLabel = '<span class="text-dim">ETH transfer</span>'

          const time = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toLocaleDateString() : ''

          html += `<div class="exp-tx-row">
            <span class="exp-tx-hash"><a href="#" class="exp-link text-blue mono" data-value="${esc(tx.hash)}">${tx.hash.slice(0, 10)}...</a></span>
            ${dirIcon}
            <span class="exp-tx-fn">${fnLabel}</span>
            <span class="exp-tx-peer">
              ${isIncoming ? 'from ' : 'to '}
              <a href="#" class="exp-link mono text-blue" data-value="${esc(isIncoming ? tx.from : tx.to || '')}">${truncAddr(isIncoming ? tx.from : tx.to || '')}</a>
            </span>
            <span class="exp-tx-value mono">${value > 0n ? formatEther(value) + ' ETH' : ''}</span>
            <span class="exp-tx-gas text-dim">${gasUsed ? gasUsed.toLocaleString() + ' gas' : ''}</span>
            ${status}
            <span class="exp-tx-time text-dim">${time}</span>
          </div>`
        }
        html += '</div></div>'
      } else if (isContract) {
        html += '<div class="result-card text-dim">No recent transactions found via Etherscan/Blockscout</div>'
      }

      output.innerHTML = html
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }

  // ── Transaction View ────────────────────────────────────

  async function renderTx(hash, target) {
    const el = target || output
    el.innerHTML = '<div class="loading">Fetching transaction...</div>'

    try {
      const [tx, receipt] = await Promise.all([
        rpcCall('eth_getTransactionByHash', [hash]),
        rpcCall('eth_getTransactionReceipt', [hash])
      ])

      if (!tx) { el.innerHTML = '<div class="result-card error">Transaction not found</div>'; return }

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
            <tr><td class="text-dim">From</td><td><a href="#" class="exp-link mono text-blue" data-value="${esc(tx.from)}">${esc(tx.from)}</a></td></tr>
            <tr><td class="text-dim">To</td><td>${tx.to ? `<a href="#" class="exp-link mono text-blue" data-value="${esc(tx.to)}">${esc(tx.to)}</a>` : '<span class="text-purple">Contract Creation</span>'}</td></tr>
            <tr><td class="text-dim">Value</td><td class="mono">${formatEther(value)} ETH</td></tr>
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

      if (receipt?.contractAddress) {
        html += `<div class="result-card"><div class="text-dim">Contract deployed at:</div><a href="#" class="exp-link mono text-blue" data-value="${esc(receipt.contractAddress)}">${esc(receipt.contractAddress)}</a></div>`
      }

      el.innerHTML = html
    } catch (e) {
      el.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
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

    const sigs = await lookupSelector(selector)
    return `<div class="result-card"><div class="selector-badge">${esc(selector)}</div>${sigs.length ? `<div class="text-dim">Possible: ${sigs.map(s => `<span class="mono">${esc(s)}</span>`).join(', ')}</div>` : '<div class="text-dim">Unknown function</div>'}</div>`
  }

  async function decodeLog(log, contractAddr) {
    if (!log.topics?.length) return ''
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
        return `<div class="tx-log"><span class="text-purple">${esc(result.eventName)}</span>(${params}) <span class="text-dim" style="font-size:10px"><a href="#" class="exp-link text-blue" data-value="${esc(log.address)}">${log.address.slice(0, 10)}...</a></span></div>`
      } catch {}
    }
    const sigs = await lookupEventTopic(log.topics[0])
    return `<div class="tx-log"><span class="text-dim">${sigs[0] || log.topics[0].slice(0, 10) + '...'}</span> <span class="text-dim" style="font-size:10px">${log.address.slice(0, 10)}...</span></div>`
  }

  function formatVal(val) {
    if (val === null || val === undefined) return '<span class="text-dim">null</span>'
    if (typeof val === 'bigint') return esc(val.toString())
    if (typeof val === 'string' && val.startsWith('0x') && val.length === 42) return `<a href="#" class="exp-link text-blue" data-value="${esc(val)}">${esc(val)}</a>`
    if (typeof val === 'boolean') return val ? 'true' : 'false'
    if (Array.isArray(val)) return `[${val.map(v => formatVal(v)).join(', ')}]`
    return esc(String(val))
  }
}
