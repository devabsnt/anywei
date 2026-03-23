import { keccak256, toHex, toBytes } from 'viem'
import { lookupSelector, lookupEventTopic } from '../shared/etherscan.js'
import { esc, copyBtn, ensure0x } from '../shared/formatters.js'

export function render(container, queryParams = {}) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Selector / Signature Lookup</h2>
      <p class="tool-desc">Look up function/event signatures from selectors, or compute selectors from signatures.</p>
    </div>
    <div class="tool-body">
      <div class="mode-tabs">
        <button class="mode-btn active" data-mode="lookup">Lookup (selector &rarr; signature)</button>
        <button class="mode-btn" data-mode="compute">Compute (signature &rarr; selector)</button>
      </div>
      <div id="sel-inputs"></div>
      <div id="sel-output" class="output-area"></div>
    </div>
  `

  let mode = 'lookup'

  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      mode = btn.dataset.mode
      renderInputs()
    })
  })

  renderInputs()

  // Handle query params
  if (queryParams.sig) {
    mode = 'compute'
    container.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'compute'))
    renderInputs()
    document.getElementById('sel-input').value = queryParams.sig
    doCompute()
  } else if (queryParams.hex) {
    document.getElementById('sel-input').value = queryParams.hex
    setTimeout(doLookup, 50)
  }

  function renderInputs() {
    const div = document.getElementById('sel-inputs')
    document.getElementById('sel-output').innerHTML = ''

    if (mode === 'lookup') {
      div.innerHTML = `<div class="input-group"><label>Function selector (4 bytes) or event topic (32 bytes)</label><input type="text" id="sel-input" class="mono-input" placeholder="0xa9059cbb" spellcheck="false"></div>`
      document.getElementById('sel-input').addEventListener('input', doLookup)
      document.getElementById('sel-input').addEventListener('paste', () => setTimeout(doLookup, 50))
    } else {
      div.innerHTML = `<div class="input-group"><label>Function or event signature</label><input type="text" id="sel-input" class="mono-input" placeholder="transfer(address,uint256)" spellcheck="false"></div>`
      document.getElementById('sel-input').addEventListener('input', doCompute)
    }
  }

  async function doLookup() {
    const raw = document.getElementById('sel-input').value.trim()
    const out = document.getElementById('sel-output')
    if (!raw || raw.length < 10) { out.innerHTML = ''; return }

    const hex = ensure0x(raw)
    const isEvent = hex.length === 66

    out.innerHTML = '<div class="loading">Looking up...</div>'

    const results = isEvent ? await lookupEventTopic(hex) : await lookupSelector(hex)

    if (results.length === 0) {
      out.innerHTML = `<div class="result-card"><p class="text-dim">No matching signatures found for <span class="mono">${esc(hex)}</span></p></div>`
      return
    }

    out.innerHTML = `<div class="result-card">
      <div class="text-dim">${results.length} match${results.length > 1 ? 'es' : ''} for <span class="mono">${esc(hex.slice(0, 10))}${hex.length > 10 ? '...' : ''}</span></div>
      ${results.map(sig => `<div class="sig-result"><span class="mono text-purple">${esc(sig)}</span></div>`).join('')}
    </div>`

    // Add copy buttons
    out.querySelectorAll('.sig-result').forEach((el, i) => {
      el.appendChild(copyBtn(results[i], 'Copy'))
    })
  }

  function doCompute() {
    const raw = document.getElementById('sel-input').value.trim()
    const out = document.getElementById('sel-output')
    if (!raw || !raw.includes('(')) { out.innerHTML = ''; return }

    try {
      // Normalize: remove "function " or "event " prefix
      let sig = raw.replace(/^(function|event)\s+/, '')
      const hash = keccak256(toBytes(sig))
      const selector = hash.slice(0, 10)

      out.innerHTML = `<div class="result-card">
        <div class="text-dim">Canonical signature:</div>
        <div class="mono text-purple" style="margin-bottom:8px">${esc(sig)}</div>
        <div class="sig-result"><span class="text-dim">Function selector (4 bytes):</span><div class="mono text-blue">${esc(selector)}</div></div>
        <div class="sig-result"><span class="text-dim">Full keccak256 (event topic0):</span><div class="mono text-blue" style="word-break:break-all">${esc(hash)}</div></div>
      </div>`

      out.querySelectorAll('.sig-result').forEach((el, i) => {
        el.appendChild(copyBtn(i === 0 ? selector : hash, 'Copy'))
      })
    } catch (e) {
      out.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }
}
