import { esc, truncAddr, etherscanLink } from '../shared/formatters.js'
import { showToast, removeToast } from '../shared/toasts.js'

// Persistent state survives tab switches (like event-monitor.js)
let globalRunning = false
let globalTimer = null
let globalFilterId = null
let globalAddr = ''
let globalUrl = ''
let globalEntries = []  // cached tx entries as HTML strings
let globalSeen = new Set()
let globalStats = { txs: 0, matched: 0 }

async function rpcCall(method, params, customUrl) {
  if (customUrl) {
    // Direct fetch — CORS has to be allowed by the RPC provider
    const res = await fetch(customUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error))
    return json.result
  }
  const res = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error))
  return json.result
}

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Mempool Watcher</h2>
      <p class="tool-desc">Stream pending transactions from the mempool. Public RPCs usually don't expose pending txs — supply a custom RPC URL (Alchemy, Infura, your own node) for full visibility.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Custom RPC URL <span class="text-dim">(optional — defaults to public)</span></label>
        <input type="text" id="mp-url" class="mono-input" placeholder="https://eth-mainnet.g.alchemy.com/v2/... or leave blank" spellcheck="false">
      </div>
      <div class="input-group">
        <label>Filter by address <span class="text-dim">(optional — matches tx.to OR tx.from)</span></label>
        <input type="text" id="mp-addr" class="mono-input" placeholder="0x... or leave blank to watch all pending" spellcheck="false">
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <button id="mp-start" class="btn btn-primary">Start</button>
        <button id="mp-stop" class="btn hidden">Stop</button>
        <span id="mp-status" class="text-dim" style="font-size:11px"></span>
      </div>
      <div id="mp-feed" class="output-area" style="margin-top:12px"></div>
    </div>
  `

  const urlInput = document.getElementById('mp-url')
  const addrInput = document.getElementById('mp-addr')
  const startBtn = document.getElementById('mp-start')
  const stopBtn = document.getElementById('mp-stop')
  const statusEl = document.getElementById('mp-status')
  const feed = document.getElementById('mp-feed')

  // Restore state
  if (globalUrl) urlInput.value = globalUrl
  if (globalAddr) addrInput.value = globalAddr
  if (globalRunning) {
    startBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    statusEl.textContent = `Watching... ${globalStats.txs} txs seen, ${globalStats.matched} matched`
    // Restore cached entries
    for (const html of globalEntries) {
      const d = document.createElement('div')
      d.className = 'mp-entry'
      d.innerHTML = html
      feed.appendChild(d)
    }
  }

  startBtn.addEventListener('click', start)
  stopBtn.addEventListener('click', stop)

  async function start() {
    if (globalRunning) return
    globalUrl = urlInput.value.trim()
    globalAddr = addrInput.value.trim().toLowerCase()
    feed.innerHTML = ''
    globalEntries = []
    globalSeen = new Set()
    globalStats = { txs: 0, matched: 0 }

    statusEl.innerHTML = '<span class="loading">Creating pending-tx filter...</span>'
    try {
      globalFilterId = await rpcCall('eth_newPendingTransactionFilter', [], globalUrl)
    } catch (e) {
      statusEl.innerHTML = `<span class="error">Failed: ${esc(e.message)} — this RPC may not support mempool</span>`
      return
    }

    globalRunning = true
    startBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    showToast('mempool-watcher', `Mempool: 0 matched`)
    poll()
    globalTimer = setInterval(poll, 3000)
  }

  function stop() {
    globalRunning = false
    if (globalTimer) { clearInterval(globalTimer); globalTimer = null }
    globalFilterId = null
    removeToast('mempool-watcher')
    startBtn.classList.remove('hidden')
    stopBtn.classList.add('hidden')
    statusEl.textContent = `Stopped (${globalStats.txs} seen, ${globalStats.matched} matched)`
  }

  async function poll() {
    if (!globalRunning || !globalFilterId) return
    let hashes
    try {
      hashes = await rpcCall('eth_getFilterChanges', [globalFilterId], globalUrl)
    } catch (e) {
      const st = document.getElementById('mp-status')
      if (st) st.innerHTML = `<span class="error">Poll error: ${esc(e.message?.slice(0, 60) || 'unknown')}</span>`
      return
    }
    if (!Array.isArray(hashes)) return
    globalStats.txs += hashes.length

    // Cap how many details we fetch per poll (avoid overwhelming the RPC)
    const toFetch = hashes.filter(h => !globalSeen.has(h)).slice(0, 50)
    for (const h of toFetch) globalSeen.add(h)

    // Fetch tx details concurrently
    const txs = await Promise.all(toFetch.map(h =>
      rpcCall('eth_getTransactionByHash', [h], globalUrl).catch(() => null)
    ))

    for (const tx of txs) {
      if (!tx) continue
      if (globalAddr) {
        const to = (tx.to || '').toLowerCase()
        const from = (tx.from || '').toLowerCase()
        if (to !== globalAddr && from !== globalAddr) continue
      }
      globalStats.matched++
      const val = tx.value ? BigInt(tx.value) : 0n
      const ethVal = Number(val) / 1e18
      const selector = (tx.input && tx.input.length >= 10) ? tx.input.slice(0, 10) : ''
      const gasPrice = tx.gasPrice ? (Number(BigInt(tx.gasPrice)) / 1e9).toFixed(2) : '?'

      const html = `<div class="mp-entry-header">
        <a href="${etherscanLink(tx.hash)}" target="_blank" class="text-blue" style="font-size:11px">${tx.hash.slice(0, 12)}...</a>
        <span class="text-dim">${gasPrice} gwei</span>
        ${ethVal > 0 ? `<span>${ethVal.toFixed(4)} ETH</span>` : ''}
      </div>
      <div class="mp-entry-params">
        <span class="text-dim">from</span> <span class="mono">${esc(truncAddr(tx.from))}</span>
        <span class="text-dim">→</span>
        <span class="text-dim">to</span> <span class="mono">${tx.to ? esc(truncAddr(tx.to)) : '<span class="text-warning">CREATE</span>'}</span>
        ${selector ? `<span class="text-dim">selector</span> <span class="mono">${esc(selector)}</span>` : ''}
      </div>`

      globalEntries.unshift(html)
      if (globalEntries.length > 100) globalEntries.pop()

      const feedEl = document.getElementById('mp-feed')
      if (feedEl) {
        const entry = document.createElement('div')
        entry.className = 'mp-entry'
        entry.innerHTML = html
        feedEl.prepend(entry)
        while (feedEl.children.length > 100) feedEl.lastChild.remove()
      }
    }

    const st = document.getElementById('mp-status')
    if (st) st.textContent = `${globalStats.txs} pending seen, ${globalStats.matched} matched`
    showToast('mempool-watcher', `Mempool: ${globalStats.matched} matched`)
  }
}
