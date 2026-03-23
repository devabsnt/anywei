import { decodeEventLog, parseAbi } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { lookupEventTopic } from '../shared/etherscan.js'
import { esc, ensure0x, saveState, loadState, etherscanLink } from '../shared/formatters.js'
import { explainEvent } from '../shared/explain.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Event Log Decoder</h2>
      <p class="tool-desc">Paste event log data (topics + data) to decode event parameters.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Paste full log JSON <span class="text-dim">(or fill fields below)</span></label>
        <textarea id="evt-json" class="mono-input" rows="3" placeholder='{"topics":["0xddf...","0x000..."],"data":"0x000..."}' spellcheck="false"></textarea>
      </div>
      <div class="input-row">
        <div class="input-group flex-1">
          <label>Topic 0 <span class="text-dim">(event signature)</span></label>
          <input type="text" id="evt-t0" class="mono-input" placeholder="0x..." spellcheck="false">
        </div>
      </div>
      <div class="input-row">
        <div class="input-group flex-1"><label>Topic 1</label><input type="text" id="evt-t1" class="mono-input" placeholder="0x..." spellcheck="false"></div>
        <div class="input-group flex-1"><label>Topic 2</label><input type="text" id="evt-t2" class="mono-input" placeholder="0x..." spellcheck="false"></div>
        <div class="input-group flex-1"><label>Topic 3</label><input type="text" id="evt-t3" class="mono-input" placeholder="0x..." spellcheck="false"></div>
      </div>
      <div class="input-group">
        <label>Data</label>
        <textarea id="evt-data" class="mono-input" rows="2" placeholder="0x..." spellcheck="false"></textarea>
      </div>
      <div class="input-group">
        <label>ABI source <span class="text-dim">(optional)</span></label>
        <input type="text" id="evt-abi" class="mono-input" placeholder="Contract address or ABI JSON" spellcheck="false">
      </div>
      <div id="evt-output" class="output-area"></div>
    </div>
  `

  const jsonInput = document.getElementById('evt-json')
  const t0 = document.getElementById('evt-t0')
  const t1 = document.getElementById('evt-t1')
  const t2 = document.getElementById('evt-t2')
  const t3 = document.getElementById('evt-t3')
  const dataInput = document.getElementById('evt-data')
  const abiInput = document.getElementById('evt-abi')
  const output = document.getElementById('evt-output')

  let currentAbi = null

  jsonInput.addEventListener('input', parseJsonLog)
  jsonInput.addEventListener('paste', () => setTimeout(parseJsonLog, 50))
  for (const el of [t0, t1, t2, t3, dataInput]) el.addEventListener('input', decode)
  abiInput.addEventListener('change', async () => {
    currentAbi = await resolveAbi(abiInput.value.trim())
    decode()
  })

  async function resolveAbi(raw) {
    if (!raw) return null
    if (raw.startsWith('0x') && raw.length === 42) {
      const r = await fetchAbi(raw)
      return r.abi
    }
    try {
      const p = JSON.parse(raw)
      return Array.isArray(p) ? p : p.abi
    } catch { return null }
  }

  function parseJsonLog() {
    try {
      const raw = jsonInput.value.trim()
      if (!raw) return
      const log = JSON.parse(raw)
      const topics = log.topics || []
      if (topics[0]) t0.value = topics[0]
      if (topics[1]) t1.value = topics[1]
      if (topics[2]) t2.value = topics[2]
      if (topics[3]) t3.value = topics[3]
      if (log.data) dataInput.value = log.data
      decode()
    } catch {}
  }

  async function decode() {
    const topics = [t0.value.trim(), t1.value.trim(), t2.value.trim(), t3.value.trim()].filter(Boolean)
    const data = dataInput.value.trim() || '0x'
    if (topics.length === 0) { output.innerHTML = ''; return }

    // Try ABI decode
    if (currentAbi) {
      try {
        const result = decodeEventLog({ abi: currentAbi, topics, data, strict: false })
        output.innerHTML = renderEvent(result.eventName, result.args, currentAbi)
        return
      } catch {}
    }

    // Lookup topic0
    output.innerHTML = '<div class="result-card"><div class="loading">Looking up event signature...</div></div>'
    const sigs = await lookupEventTopic(topics[0])

    for (const sig of sigs) {
      try {
        const abi = parseAbi([`event ${sig}`])
        const result = decodeEventLog({ abi, topics, data, strict: false })
        output.innerHTML = renderEvent(result.eventName, result.args, abi)
        return
      } catch { continue }
    }

    output.innerHTML = `<div class="result-card">
      <div class="selector-badge">${esc(topics[0]?.slice(0, 10) || '?')}...</div>
      ${sigs.length > 0 ? `<p>Possible events: ${sigs.map(s => `<span class="mono">${esc(s)}</span>`).join(', ')}</p><p class="text-dim">Could not decode with these signatures.</p>` : '<p class="text-dim">Unknown event. Paste the contract ABI to decode.</p>'}
    </div>`
  }

  function renderEvent(name, args, abi) {
    const evtAbi = (Array.isArray(abi) ? abi : []).find(e => e.type === 'event' && e.name === name)
    const inputs = evtAbi?.inputs || []
    let rows = ''
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i]
      const val = args ? (Array.isArray(args) ? args[i] : args[inp.name]) : null
      rows += `<tr>
        <td class="text-dim">${i}</td>
        <td class="text-purple">${esc(inp.name)}</td>
        <td class="text-dim">${esc(inp.type)}</td>
        <td>${inp.indexed ? '<span class="badge">indexed</span>' : ''}</td>
        <td class="mono">${formatVal(val, inp.type)}</td>
      </tr>`
    }
    const argValues = Array.isArray(args) ? args : inputs.map(i => args?.[i.name])
    const explanation = explainEvent(name, argValues, inputs)

    return `<div class="result-card">
      ${explanation ? `<details class="explain-toggle"><summary>Explain</summary><div class="explain-box">${esc(explanation)}</div></details>` : ''}
      <div class="fn-signature">event <span class="text-purple">${esc(name)}</span></div>
      ${rows ? `<table class="params-table"><thead><tr><th>#</th><th>Name</th><th>Type</th><th></th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    </div>`
  }

  function formatVal(val, type) {
    if (val == null) return '<span class="text-dim">null</span>'
    if (typeof val === 'bigint') return esc(val.toString())
    if (typeof val === 'string' && val.length === 42) return `<a href="${etherscanLink(val)}" target="_blank" class="text-blue">${esc(val)}</a>`
    return esc(String(val))
  }
}
