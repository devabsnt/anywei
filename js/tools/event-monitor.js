import { decodeEventLog } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { esc, etherscanLink, truncAddr } from '../shared/formatters.js'
import { showToast, removeToast } from '../shared/toasts.js'

// Persistent state survives tab switches
const EM_STATE_KEY = 'anywei_event_monitor'
let globalPolling = false
let globalPollTimer = null
let globalLastBlock = null
let globalAddr = ''
let globalAbi = null
let globalSelectedEvents = new Set()
let globalEntries = [] // cached event entries

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
      <h2>Event Monitor</h2>
      <p class="tool-desc">Watch contract events in real-time. Paste an address, pick events, and see them stream in.</p>
    </div>
    <div class="tool-body">
      <div class="input-row" style="gap:8px;align-items:flex-end">
        <div class="input-group" style="flex:1">
          <label>Contract address</label>
          <input type="text" id="em-addr" class="mono-input" placeholder="0x..." spellcheck="false">
        </div>
        <button id="em-load" class="btn btn-primary">Load Events</button>
      </div>
      <div id="em-status" class="status-line"></div>
      <div id="em-filters" class="hidden"></div>
      <div id="em-controls" class="hidden" style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <button id="em-start" class="btn btn-primary">Start Monitoring</button>
        <button id="em-stop" class="btn hidden">Stop</button>
        <span id="em-poll-status" class="text-dim" style="font-size:11px"></span>
      </div>
      <div id="em-feed" class="output-area"></div>
    </div>
  `

  const addrInput = document.getElementById('em-addr')
  const status = document.getElementById('em-status')
  const filtersDiv = document.getElementById('em-filters')
  const controlsDiv = document.getElementById('em-controls')
  const startBtn = document.getElementById('em-start')
  const stopBtn = document.getElementById('em-stop')
  const pollStatus = document.getElementById('em-poll-status')
  const feed = document.getElementById('em-feed')

  // Restore state if monitoring was running
  if (globalAddr) addrInput.value = globalAddr
  if (globalPolling) {
    startBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    pollStatus.textContent = `Monitoring ${globalAddr.slice(0, 10)}... (block ${globalLastBlock?.toLocaleString() || '?'})`
    // Restore cached entries
    for (const html of globalEntries) {
      const div = document.createElement('div')
      div.className = 'em-entry'
      div.innerHTML = html
      feed.appendChild(div)
    }
  }

  document.getElementById('em-load').addEventListener('click', loadContract)
  addrInput.addEventListener('paste', () => setTimeout(loadContract, 50))
  startBtn.addEventListener('click', startMonitoring)
  stopBtn.addEventListener('click', stopMonitoring)

  async function loadContract() {
    const addr = addrInput.value.trim()
    if (!addr || addr.length !== 42) return
    status.innerHTML = '<span class="loading">Fetching ABI...</span>'

    try {
      const result = await fetchAbi(addr)
      if (!result.abi) { status.innerHTML = '<span class="error">Contract not verified</span>'; return }
      globalAbi = result.abi
      const events = globalAbi.filter(e => e.type === 'event')
      if (events.length === 0) { status.innerHTML = '<span class="error">No events in ABI</span>'; return }

      status.innerHTML = `<span class="success">${esc(result.contractName || 'Loaded')} - ${events.length} events</span>`

      // Show event checkboxes
      filtersDiv.classList.remove('hidden')
      filtersDiv.innerHTML = '<label class="text-dim" style="font-size:11px;display:block;margin-bottom:4px">Select events to watch:</label>' +
        events.map(evt => {
          const sig = `${evt.name}(${(evt.inputs || []).map(i => i.type).join(',')})`
          return `<label class="em-event-check"><input type="checkbox" value="${esc(evt.name)}" checked> <span class="text-purple">${esc(evt.name)}</span> <span class="text-dim">(${(evt.inputs || []).map(i => i.type).join(', ')})</span></label>`
        }).join('')

      globalSelectedEvents = new Set(events.map(e => e.name))
      filtersDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) globalSelectedEvents.add(cb.value)
          else globalSelectedEvents.delete(cb.value)
        })
      })

      controlsDiv.classList.remove('hidden')
      controlsDiv.style.display = 'flex'
    } catch (e) {
      status.innerHTML = `<span class="error">${esc(e.message)}</span>`
    }
  }

  async function startMonitoring() {
    if (globalPolling) return
    globalPolling = true
    globalAddr = addrInput.value.trim()
    globalAbi = globalAbi // already set by loadContract
    startBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    feed.innerHTML = ''

    // Get current block as starting point
    try {
      const bn = await rpcCall('eth_blockNumber', [])
      globalLastBlock = parseInt(bn, 16)
      pollStatus.textContent = `Watching from block ${globalLastBlock.toLocaleString()}...`
    } catch (e) {
      pollStatus.textContent = 'Error getting block number'
      stopMonitoring()
      return
    }

    globalEntries = []
    showToast('event-monitor', `Monitoring ${globalAddr.slice(0, 10)}...`)
    poll()
    globalPollTimer = setInterval(poll, 12000)
  }

  function stopMonitoring() {
    globalPolling = false
    if (globalPollTimer) { clearInterval(globalPollTimer); globalPollTimer = null }
    removeToast('event-monitor')
    startBtn.classList.remove('hidden')
    stopBtn.classList.add('hidden')
    pollStatus.textContent = 'Stopped'
  }

  async function poll() {
    if (!globalPolling) return
    const addr = globalAddr

    try {
      const currentBlock = await rpcCall('eth_blockNumber', [])
      const current = parseInt(currentBlock, 16)
      if (current <= globalLastBlock) return

      const ps = document.getElementById('em-poll-status')
      if (ps) ps.textContent = `Polling block ${(globalLastBlock + 1).toLocaleString()} to ${current.toLocaleString()}...`
      showToast('event-monitor', `Events: block ${current.toLocaleString()}`)

      const logs = await rpcCall('eth_getLogs', [{
        address: addr,
        fromBlock: '0x' + (globalLastBlock + 1).toString(16),
        toBlock: '0x' + current.toString(16)
      }])

      globalLastBlock = current

      if (!logs || logs.length === 0) {
        if (ps) ps.textContent = `Watching... block ${current.toLocaleString()} (no events)`
        return
      }

      if (ps) ps.textContent = `Block ${current.toLocaleString()} - ${logs.length} log(s)`

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi: globalAbi, topics: log.topics, data: log.data, strict: false })
          if (!globalSelectedEvents.has(decoded.eventName)) continue

          const evtAbi = globalAbi.find(e => e.type === 'event' && e.name === decoded.eventName)
          const inputs = evtAbi?.inputs || []
          const blockNum = parseInt(log.blockNumber, 16)
          const txHash = log.transactionHash

          let params = inputs.map((inp, i) => {
            const val = decoded.args ? (Array.isArray(decoded.args) ? decoded.args[i] : decoded.args[inp.name]) : null
            let display = val === null ? '?' : typeof val === 'bigint' ? val.toString() : typeof val === 'string' && val.length === 42 ? truncAddr(val) : String(val)
            return `<span class="text-dim">${esc(inp.name)}</span>=<span class="mono">${esc(display)}</span>`
          }).join(', ')

          const entryHtml = `<div class="em-entry-header"><span class="text-purple">${esc(decoded.eventName)}</span><span class="text-dim">block ${blockNum.toLocaleString()}</span><a href="${etherscanLink(txHash)}" target="_blank" class="text-blue" style="font-size:10px">${txHash.slice(0, 10)}...</a></div><div class="em-entry-params">${params}</div>`

          // Cache entry
          globalEntries.unshift(entryHtml)
          if (globalEntries.length > 100) globalEntries.pop()

          // Append to feed if it exists (user might be on another tab)
          const feedEl = document.getElementById('em-feed')
          if (feedEl) {
            const entry = document.createElement('div')
            entry.className = 'em-entry'
            entry.innerHTML = entryHtml
            feedEl.prepend(entry)
            while (feedEl.children.length > 100) feedEl.lastChild.remove()
          }
        } catch {}
      }
    } catch (e) {
      pollStatus.textContent = `Error: ${e.message?.slice(0, 50)}`
    }
  }
}
