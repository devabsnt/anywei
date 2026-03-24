import { encodeFunctionData, parseAbi, getAddress } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { esc, copyBtn, ensure0x } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Safe Transaction Builder</h2>
      <p class="tool-desc">Build transaction batches for Gnosis Safe. Generate the JSON payload for the Safe web app's Transaction Builder.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Safe address <span class="text-dim">(the multisig that will execute)</span></label>
        <input type="text" id="safe-addr" class="mono-input" placeholder="0x Safe address" spellcheck="false">
      </div>
      <div class="input-group">
        <label>Chain ID</label>
        <select id="safe-chain" class="mono-input" style="width:200px">
          <option value="1">Ethereum (1)</option>
          <option value="11155111">Sepolia (11155111)</option>
          <option value="137">Polygon (137)</option>
          <option value="42161">Arbitrum (42161)</option>
          <option value="10">Optimism (10)</option>
          <option value="8453">Base (8453)</option>
          <option value="56">BSC (56)</option>
          <option value="43114">Avalanche (43114)</option>
          <option value="100">Gnosis (100)</option>
        </select>
      </div>

      <div id="safe-txs"></div>

      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="safe-add" class="btn">+ Add Transaction</button>
        <button id="safe-export" class="btn btn-primary">Export Safe JSON</button>
      </div>
      <div id="safe-output" class="output-area"></div>
    </div>
  `

  let txs = [createEmptyTx()]

  renderTxs()

  document.getElementById('safe-add').addEventListener('click', () => {
    txs.push(createEmptyTx())
    renderTxs()
  })

  document.getElementById('safe-export').addEventListener('click', exportJson)

  function createEmptyTx() {
    return { to: '', value: '0', abiSource: '', abi: null, fnName: '', params: [] }
  }

  function renderTxs() {
    const div = document.getElementById('safe-txs')
    div.innerHTML = ''

    txs.forEach((tx, i) => {
      const card = document.createElement('div')
      card.className = 'result-card'
      card.style.marginBottom = '8px'
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span class="text-bright" style="font-weight:600">Transaction ${i + 1}</span>
          ${txs.length > 1 ? `<button class="ide-find-btn safe-remove" data-idx="${i}">&times;</button>` : ''}
        </div>
        <div class="input-group">
          <label>Target contract address</label>
          <input type="text" class="mono-input safe-to" data-idx="${i}" value="${esc(tx.to)}" placeholder="0x..." spellcheck="false">
        </div>
        <div class="input-group">
          <label>ETH value (wei)</label>
          <input type="text" class="mono-input safe-value" data-idx="${i}" value="${esc(tx.value)}" placeholder="0" spellcheck="false">
        </div>
        <div class="input-group">
          <label>Function <span class="text-dim">(signature like transfer(address,uint256) or paste ABI)</span></label>
          <input type="text" class="mono-input safe-fn" data-idx="${i}" value="${esc(tx.fnName)}" placeholder="transfer(address,uint256) or paste ABI" spellcheck="false">
          <div class="safe-fn-status" data-idx="${i}" style="font-size:10px"></div>
        </div>
        <div class="safe-fn-select hidden" data-idx="${i}"></div>
        <div class="safe-params" data-idx="${i}"></div>
      `
      div.appendChild(card)
    })

    // Bind events
    div.querySelectorAll('.safe-remove').forEach(btn => {
      btn.addEventListener('click', () => { txs.splice(parseInt(btn.dataset.idx), 1); renderTxs() })
    })

    div.querySelectorAll('.safe-to').forEach(el => {
      el.addEventListener('input', () => { txs[parseInt(el.dataset.idx)].to = el.value.trim() })
      el.addEventListener('change', async () => {
        const idx = parseInt(el.dataset.idx)
        const addr = el.value.trim()
        if (addr.length === 42) {
          const statusEl = div.querySelector(`.safe-fn-status[data-idx="${idx}"]`)
          statusEl.innerHTML = '<span class="loading">Fetching ABI...</span>'
          try {
            const r = await fetchAbi(addr)
            if (r.abi) {
              txs[idx].abi = r.abi
              statusEl.innerHTML = `<span class="success">${esc(r.contractName || 'ABI loaded')}</span>`
              showFnDropdown(idx)
            } else {
              statusEl.innerHTML = '<span class="text-dim">Not verified, enter function signature manually</span>'
            }
          } catch { statusEl.innerHTML = '' }
        }
      })
    })

    div.querySelectorAll('.safe-value').forEach(el => {
      el.addEventListener('input', () => { txs[parseInt(el.dataset.idx)].value = el.value.trim() || '0' })
    })

    div.querySelectorAll('.safe-fn').forEach(el => {
      el.addEventListener('change', () => {
        const idx = parseInt(el.dataset.idx)
        const raw = el.value.trim()
        txs[idx].fnName = raw

        // Try as ABI JSON
        if (raw.startsWith('[') || raw.startsWith('{')) {
          try {
            const parsed = JSON.parse(raw)
            txs[idx].abi = Array.isArray(parsed) ? parsed : parsed.abi
            showFnDropdown(idx)
            return
          } catch {}
        }

        // Treat as function signature
        if (raw.includes('(')) {
          try {
            txs[idx].abi = null
            txs[idx].fnName = raw
            buildParams(idx, raw)
          } catch {}
        }
      })
    })
  }

  function showFnDropdown(idx) {
    const selectDiv = document.querySelector(`.safe-fn-select[data-idx="${idx}"]`)
    if (!txs[idx].abi) return
    const fns = txs[idx].abi.filter(e => e.type === 'function')
    selectDiv.classList.remove('hidden')
    selectDiv.innerHTML = `<select class="mono-input safe-fn-dropdown" data-idx="${idx}" style="margin-top:4px">
      <option value="">Select function...</option>
      ${fns.map(f => `<option value="${esc(f.name)}">${esc(f.name)}(${(f.inputs || []).map(i => i.type).join(', ')})</option>`).join('')}
    </select>`

    selectDiv.querySelector('.safe-fn-dropdown').addEventListener('change', (e) => {
      const fnName = e.target.value
      txs[idx].fnName = fnName
      if (fnName) {
        const fn = fns.find(f => f.name === fnName)
        if (fn) buildParamsFromAbi(idx, fn)
      }
    })
  }

  function buildParams(idx, sig) {
    try {
      const abi = parseAbi([`function ${sig}`])
      const fn = abi[0]
      buildParamsFromAbi(idx, fn)
    } catch {}
  }

  function buildParamsFromAbi(idx, fn) {
    const paramsDiv = document.querySelector(`.safe-params[data-idx="${idx}"]`)
    const inputs = fn.inputs || []
    txs[idx].params = new Array(inputs.length).fill('')

    paramsDiv.innerHTML = inputs.map((inp, i) => `
      <div class="input-group" style="margin-top:4px">
        <label><span class="text-purple">${esc(inp.name || 'arg' + i)}</span> <span class="text-dim">${esc(inp.type)}</span></label>
        <input type="text" class="mono-input safe-param" data-tx="${idx}" data-param="${i}" placeholder="${esc(inp.type)}" spellcheck="false">
      </div>
    `).join('')

    paramsDiv.querySelectorAll('.safe-param').forEach(el => {
      el.addEventListener('input', () => {
        txs[parseInt(el.dataset.tx)].params[parseInt(el.dataset.param)] = el.value.trim()
      })
    })
  }

  function exportJson() {
    const output = document.getElementById('safe-output')
    const safeAddr = document.getElementById('safe-addr').value.trim()
    const chainId = document.getElementById('safe-chain').value

    try {
      const transactions = []

      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i]
        if (!tx.to) throw new Error(`Transaction ${i + 1}: target address required`)

        let data = '0x'

        if (tx.fnName && tx.fnName.includes('(')) {
          // Function signature mode
          const abi = tx.abi || parseAbi([`function ${tx.fnName}`])
          const fnName = tx.abi ? tx.fnName : abi[0].name
          const fn = (Array.isArray(abi) ? abi : [abi[0]]).find(e => e.type === 'function' && e.name === fnName)
          const inputs = fn?.inputs || []
          const args = inputs.map((inp, j) => coerceParam(tx.params[j] || '', inp.type))
          data = encodeFunctionData({ abi: Array.isArray(abi) ? abi : [fn], functionName: fnName, args })
        } else if (tx.fnName && tx.abi) {
          const fn = tx.abi.find(e => e.type === 'function' && e.name === tx.fnName)
          if (fn) {
            const inputs = fn.inputs || []
            const args = inputs.map((inp, j) => coerceParam(tx.params[j] || '', inp.type))
            data = encodeFunctionData({ abi: tx.abi, functionName: tx.fnName, args })
          }
        }

        transactions.push({
          to: getAddress(tx.to),
          value: tx.value || '0',
          data,
          operation: 0
        })
      }

      // Safe Transaction Builder JSON format
      const safeJson = {
        version: '1.0',
        chainId,
        createdAt: Date.now(),
        meta: {
          name: 'anywei batch',
          description: `${transactions.length} transaction(s) built with anywei.dev`,
          createdFromSafeAddress: safeAddr || undefined
        },
        transactions
      }

      const jsonStr = JSON.stringify(safeJson, null, 2)

      output.innerHTML = `<div class="result-card">
        <div style="margin-bottom:8px"><span class="success" style="font-weight:600">${transactions.length} transaction(s) ready</span></div>
        <pre class="inline-pre" style="max-height:300px;overflow:auto" id="safe-json">${esc(jsonStr)}</pre>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="btn" id="safe-copy">Copy JSON</button>
          <button class="btn" id="safe-download">Download .json</button>
        </div>
      </div>`

      document.getElementById('safe-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(jsonStr)
        document.getElementById('safe-copy').textContent = 'Copied!'
        setTimeout(() => document.getElementById('safe-copy').textContent = 'Copy JSON', 1200)
      })

      document.getElementById('safe-download').addEventListener('click', () => {
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'safe-tx-batch.json'
        a.click()
      })
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }

  function coerceParam(raw, type) {
    if (!raw && type !== 'string' && type !== 'bytes') {
      if (type === 'bool') return false
      if (type === 'address') return '0x0000000000000000000000000000000000000000'
      if (type.startsWith('uint') || type.startsWith('int')) return 0n
      if (type.startsWith('bytes')) return '0x'
      if (type.endsWith('[]')) return []
      return ''
    }
    if (type === 'bool') return raw === 'true' || raw === '1'
    if (type === 'address') return raw
    if (type.startsWith('uint') || type.startsWith('int')) return BigInt(raw.replace(/,/g, ''))
    if (type.startsWith('bytes')) return ensure0x(raw)
    if (type.endsWith('[]')) { try { return JSON.parse(raw) } catch { return raw.split(',').map(s => s.trim()) } }
    return raw
  }
}
