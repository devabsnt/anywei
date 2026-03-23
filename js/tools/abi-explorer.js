import { toFunctionSelector, toEventSelector } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { esc, copyBtn, etherscanLink } from '../shared/formatters.js'

export function render(container, queryParams = {}) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>ABI Explorer</h2>
      <p class="tool-desc">Paste a contract address or ABI JSON to explore the interface.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Contract address or ABI JSON</label>
        <textarea id="abi-input" class="mono-input" rows="3" placeholder="0x... or [{ ... }]" spellcheck="false"></textarea>
        <div id="abi-status" class="status-line"></div>
      </div>
      <div class="input-group">
        <input type="text" id="abi-filter" class="mono-input" placeholder="Filter functions..." spellcheck="false" style="display:none">
      </div>
      <div id="abi-output" class="output-area"></div>
    </div>
  `

  const input = document.getElementById('abi-input')
  const status = document.getElementById('abi-status')
  const filter = document.getElementById('abi-filter')
  const output = document.getElementById('abi-output')

  input.addEventListener('change', load)
  input.addEventListener('paste', () => setTimeout(load, 50))
  filter.addEventListener('input', () => renderAbi(lastAbi, filter.value.trim().toLowerCase()))

  let lastAbi = null

  // Query param support
  if (queryParams.address) {
    input.value = queryParams.address
    setTimeout(load, 50)
  }

  async function load() {
    const raw = input.value.trim()
    if (!raw) return

    if (raw.startsWith('0x') && raw.length === 42) {
      status.innerHTML = '<span class="loading">Fetching ABI...</span>'
      try {
        const result = await fetchAbi(raw)
        if (result.abi) {
          lastAbi = result.abi
          status.innerHTML = `<span class="success">${esc(result.contractName || 'Loaded')}${result.isProxy ? ' (proxy)' : ''}</span>`
          filter.style.display = ''
          renderAbi(lastAbi, '')
        } else {
          status.innerHTML = '<span class="error">Contract not verified</span>'
        }
      } catch (e) { status.innerHTML = `<span class="error">${esc(e.message)}</span>` }
    } else {
      try {
        const parsed = JSON.parse(raw)
        lastAbi = Array.isArray(parsed) ? parsed : parsed.abi
        if (!lastAbi) throw new Error('No ABI found')
        status.innerHTML = '<span class="success">ABI parsed</span>'
        filter.style.display = ''
        renderAbi(lastAbi, '')
      } catch (e) { status.innerHTML = `<span class="error">${esc(e.message)}</span>` }
    }
  }

  function renderAbi(abi, q) {
    if (!abi) return

    const writeFns = abi.filter(e => e.type === 'function' && e.stateMutability !== 'view' && e.stateMutability !== 'pure')
    const readFns = abi.filter(e => e.type === 'function' && (e.stateMutability === 'view' || e.stateMutability === 'pure'))
    const events = abi.filter(e => e.type === 'event')
    const errors = abi.filter(e => e.type === 'error')
    const constructor = abi.find(e => e.type === 'constructor')

    const stats = `<div class="abi-stats">
      ${writeFns.length} write &middot; ${readFns.length} read &middot; ${events.length} events &middot; ${errors.length} errors
      <button class="btn-copy" id="abi-download-btn" style="margin-left:12px">Download ABI</button>
    </div>`

    let html = stats

    if (constructor) {
      html += renderSection('Constructor', [constructor], q, 'constructor')
    }
    if (writeFns.length) html += renderSection('Write Functions', writeFns, q, 'function')
    if (readFns.length) html += renderSection('Read Functions', readFns, q, 'function')
    if (events.length) html += renderSection('Events', events, q, 'event')
    if (errors.length) html += renderSection('Errors', errors, q, 'error')

    output.innerHTML = html

    // Add copy buttons for selectors
    output.querySelectorAll('.abi-selector').forEach(el => {
      el.appendChild(copyBtn(el.dataset.selector, 'Copy'))
    })

    // Download ABI button
    const dlBtn = document.getElementById('abi-download-btn')
    if (dlBtn) {
      dlBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(abi, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'abi.json'
        a.click()
        URL.revokeObjectURL(url)
      })
    }
  }

  function renderSection(title, items, q, type) {
    const filtered = q ? items.filter(i => (i.name || '').toLowerCase().includes(q)) : items
    if (filtered.length === 0 && q) return ''

    let html = `<div class="abi-section"><div class="abi-section-header">${esc(title)} (${filtered.length})</div>`
    for (const item of filtered) {
      const name = item.name || '(constructor)'
      const inputs = item.inputs || []
      const outputs = item.outputs || []
      const sig = `${name}(${inputs.map(i => i.type).join(',')})`

      let selector = ''
      try {
        if (type === 'function') selector = toFunctionSelector(sig)
        else if (type === 'event') selector = toEventSelector(sig)
      } catch {}

      const badges = []
      if (item.stateMutability === 'payable') badges.push('<span class="badge payable-badge">payable</span>')
      if (item.stateMutability === 'view') badges.push('<span class="badge view-badge">view</span>')
      if (item.stateMutability === 'pure') badges.push('<span class="badge view-badge">pure</span>')

      html += `<div class="abi-item">
        <div class="abi-item-header">
          <span class="text-purple">${esc(name)}</span>
          <span class="text-dim">(${inputs.map(i => `<span class="text-dim">${esc(i.type)}</span> ${esc(i.name || '')}`).join(', ')})</span>
          ${outputs.length ? `<span class="text-dim"> &rarr; (${outputs.map(o => esc(o.type)).join(', ')})</span>` : ''}
          ${badges.join(' ')}
        </div>
        ${selector ? `<div class="abi-selector" data-selector="${esc(selector)}"><span class="mono text-dim">${esc(selector)}</span></div>` : ''}
      </div>`
    }
    html += '</div>'
    return html
  }
}
