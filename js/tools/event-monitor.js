import { decodeEventLog } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { esc, etherscanLink, truncAddr } from '../shared/formatters.js'

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

  let abi = null
  let selectedEvents = new Set()
  let polling = false
  let pollTimer = null
  let lastBlock = null

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
      abi = result.abi
      const events = abi.filter(e => e.type === 'event')
      if (events.length === 0) { status.innerHTML = '<span class="error">No events in ABI</span>'; return }

      status.innerHTML = `<span class="success">${esc(result.contractName || 'Loaded')} - ${events.length} events</span>`

      // Show event checkboxes
      filtersDiv.classList.remove('hidden')
      filtersDiv.innerHTML = '<label class="text-dim" style="font-size:11px;display:block;margin-bottom:4px">Select events to watch:</label>' +
        events.map(evt => {
          const sig = `${evt.name}(${(evt.inputs || []).map(i => i.type).join(',')})`
          return `<label class="em-event-check"><input type="checkbox" value="${esc(evt.name)}" checked> <span class="text-purple">${esc(evt.name)}</span> <span class="text-dim">(${(evt.inputs || []).map(i => i.type).join(', ')})</span></label>`
        }).join('')

      selectedEvents = new Set(events.map(e => e.name))
      filtersDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) selectedEvents.add(cb.value)
          else selectedEvents.delete(cb.value)
        })
      })

      controlsDiv.classList.remove('hidden')
      controlsDiv.style.display = 'flex'
    } catch (e) {
      status.innerHTML = `<span class="error">${esc(e.message)}</span>`
    }
  }

  async function startMonitoring() {
    if (polling) return
    polling = true
    startBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    feed.innerHTML = ''

    // Get current block as starting point
    try {
      const bn = await rpcCall('eth_blockNumber', [])
      lastBlock = parseInt(bn, 16)
      pollStatus.textContent = `Watching from block ${lastBlock.toLocaleString()}...`
    } catch (e) {
      pollStatus.textContent = 'Error getting block number'
      stopMonitoring()
      return
    }

    poll()
    pollTimer = setInterval(poll, 12000) // ~1 block
  }

  function stopMonitoring() {
    polling = false
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    startBtn.classList.remove('hidden')
    stopBtn.classList.add('hidden')
    pollStatus.textContent = 'Stopped'
  }

  async function poll() {
    if (!polling) return
    const addr = addrInput.value.trim()

    try {
      const currentBlock = await rpcCall('eth_blockNumber', [])
      const current = parseInt(currentBlock, 16)
      if (current <= lastBlock) return

      pollStatus.textContent = `Polling block ${(lastBlock + 1).toLocaleString()} to ${current.toLocaleString()}...`

      // Build topic filters for selected events
      const logs = await rpcCall('eth_getLogs', [{
        address: addr,
        fromBlock: '0x' + (lastBlock + 1).toString(16),
        toBlock: '0x' + current.toString(16)
      }])

      lastBlock = current

      if (!logs || logs.length === 0) {
        pollStatus.textContent = `Watching... block ${current.toLocaleString()} (no events)`
        return
      }

      pollStatus.textContent = `Block ${current.toLocaleString()} - ${logs.length} log(s)`

      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: false })
          if (!selectedEvents.has(decoded.eventName)) continue

          const evtAbi = abi.find(e => e.type === 'event' && e.name === decoded.eventName)
          const inputs = evtAbi?.inputs || []
          const blockNum = parseInt(log.blockNumber, 16)
          const txHash = log.transactionHash

          let params = inputs.map((inp, i) => {
            const val = decoded.args ? (Array.isArray(decoded.args) ? decoded.args[i] : decoded.args[inp.name]) : null
            let display = val === null ? '?' : typeof val === 'bigint' ? val.toString() : typeof val === 'string' && val.length === 42 ? truncAddr(val) : String(val)
            return `<span class="text-dim">${esc(inp.name)}</span>=<span class="mono">${esc(display)}</span>`
          }).join(', ')

          const entry = document.createElement('div')
          entry.className = 'em-entry'
          entry.innerHTML = `
            <div class="em-entry-header">
              <span class="text-purple">${esc(decoded.eventName)}</span>
              <span class="text-dim">block ${blockNum.toLocaleString()}</span>
              <a href="${etherscanLink(txHash)}" target="_blank" class="text-blue" style="font-size:10px">${txHash.slice(0, 10)}...</a>
            </div>
            <div class="em-entry-params">${params}</div>
          `
          feed.prepend(entry)

          // Cap the feed at 100 entries
          while (feed.children.length > 100) feed.lastChild.remove()
        } catch {}
      }
    } catch (e) {
      pollStatus.textContent = `Error: ${e.message?.slice(0, 50)}`
    }
  }
}
