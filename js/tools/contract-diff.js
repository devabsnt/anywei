import { fetchAbi } from '../shared/abi-cache.js'
import { fetchBytecode } from '../shared/etherscan.js'
import { esc, strip0x } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Contract Diff</h2>
      <p class="tool-desc">Compare two ABIs or bytecodes to see what changed between contract versions.</p>
    </div>
    <div class="tool-body">
      <div class="mode-tabs">
        <button class="mode-btn active" data-mode="abi">ABI Diff</button>
        <button class="mode-btn" data-mode="bytecode">Bytecode Diff</button>
      </div>
      <div class="diff-inputs">
        <div class="input-group flex-1">
          <label>Contract A</label>
          <textarea id="diff-a" class="mono-input" rows="3" placeholder="Address, ABI JSON, or bytecode" spellcheck="false"></textarea>
          <div id="diff-a-status" class="status-line"></div>
        </div>
        <div class="input-group flex-1">
          <label>Contract B</label>
          <textarea id="diff-b" class="mono-input" rows="3" placeholder="Address, ABI JSON, or bytecode" spellcheck="false"></textarea>
          <div id="diff-b-status" class="status-line"></div>
        </div>
      </div>
      <button id="diff-btn" class="btn btn-primary">Compare</button>
      <div id="diff-output" class="output-area"></div>
    </div>
  `

  let diffMode = 'abi'
  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      diffMode = btn.dataset.mode
    })
  })
  document.getElementById('diff-btn').addEventListener('click', () => diffMode === 'bytecode' ? compareBytecode() : compare())

  async function resolveAbi(raw, statusEl) {
    if (!raw) return null
    if (raw.startsWith('0x') && raw.length === 42) {
      statusEl.innerHTML = '<span class="loading">Fetching...</span>'
      const r = await fetchAbi(raw)
      statusEl.innerHTML = r.abi ? `<span class="success">${esc(r.contractName || 'Loaded')}</span>` : '<span class="error">Not verified</span>'
      return r.abi
    }
    try {
      const p = JSON.parse(raw)
      const abi = Array.isArray(p) ? p : p.abi
      statusEl.innerHTML = '<span class="success">Parsed</span>'
      return abi
    } catch {
      statusEl.innerHTML = '<span class="error">Invalid</span>'
      return null
    }
  }

  async function compare() {
    const output = document.getElementById('diff-output')
    const abiA = await resolveAbi(document.getElementById('diff-a').value.trim(), document.getElementById('diff-a-status'))
    const abiB = await resolveAbi(document.getElementById('diff-b').value.trim(), document.getElementById('diff-b-status'))

    if (!abiA || !abiB) {
      output.innerHTML = '<div class="result-card error">Need two valid ABIs to compare.</div>'
      return
    }

    const keysA = new Map()
    const keysB = new Map()

    for (const item of abiA) {
      const k = itemKey(item)
      if (k) keysA.set(k, item)
    }
    for (const item of abiB) {
      const k = itemKey(item)
      if (k) keysB.set(k, item)
    }

    const added = []
    const removed = []
    const changed = []
    const unchanged = []

    for (const [k, item] of keysB) {
      if (!keysA.has(k)) {
        added.push(item)
      } else {
        const a = keysA.get(k)
        if (itemSig(a) !== itemSig(item)) {
          changed.push({ old: a, new: item })
        } else {
          unchanged.push(item)
        }
      }
    }
    for (const [k, item] of keysA) {
      if (!keysB.has(k)) removed.push(item)
    }

    let html = `<div class="result-card">
      <div class="diff-summary">
        <span class="diff-added">${added.length} added</span>
        <span class="diff-removed">${removed.length} removed</span>
        <span class="diff-changed">${changed.length} changed</span>
        <span class="text-dim">${unchanged.length} unchanged</span>
      </div>`

    if (added.length) {
      html += '<div class="diff-section"><div class="diff-section-header diff-added">Added</div>'
      for (const item of added) html += `<div class="diff-item diff-item-added">${esc(itemSig(item))}</div>`
      html += '</div>'
    }
    if (removed.length) {
      html += '<div class="diff-section"><div class="diff-section-header diff-removed">Removed</div>'
      for (const item of removed) html += `<div class="diff-item diff-item-removed">${esc(itemSig(item))}</div>`
      html += '</div>'
    }
    if (changed.length) {
      html += '<div class="diff-section"><div class="diff-section-header diff-changed">Changed</div>'
      for (const c of changed) {
        html += `<div class="diff-item diff-item-changed"><div class="diff-old">${esc(itemSig(c.old))}</div><div class="diff-new">${esc(itemSig(c.new))}</div></div>`
      }
      html += '</div>'
    }
    if (unchanged.length) {
      html += `<details class="diff-section"><summary class="diff-section-header text-dim">Unchanged (${unchanged.length})</summary>`
      for (const item of unchanged) html += `<div class="diff-item text-dim">${esc(itemSig(item))}</div>`
      html += '</details>'
    }

    html += '</div>'
    output.innerHTML = html
  }

  function itemKey(item) {
    if (!item.name && item.type !== 'constructor') return null
    return `${item.type}:${item.name || 'constructor'}`
  }

  function itemSig(item) {
    const name = item.name || 'constructor'
    const inputs = (item.inputs || []).map(i => `${i.type} ${i.name || ''}`).join(', ')
    const outputs = (item.outputs || []).map(o => o.type).join(', ')
    const mut = item.stateMutability ? ` [${item.stateMutability}]` : ''
    return `${item.type} ${name}(${inputs})${outputs ? ` -> (${outputs})` : ''}${mut}`
  }

  async function resolveBytecode(raw, statusEl) {
    if (!raw) return null
    if (raw.startsWith('0x') && raw.length === 42) {
      statusEl.innerHTML = '<span class="loading">Fetching bytecode...</span>'
      const bc = await fetchBytecode(raw)
      statusEl.innerHTML = bc && bc !== '0x' ? `<span class="success">${(strip0x(bc).length / 2).toLocaleString()} bytes</span>` : '<span class="error">No bytecode</span>'
      return bc
    }
    const hex = raw.startsWith('0x') ? raw : '0x' + raw
    if (/^0x[0-9a-fA-F]+$/.test(hex) && hex.length > 10) {
      statusEl.innerHTML = `<span class="success">${(strip0x(hex).length / 2).toLocaleString()} bytes</span>`
      return hex
    }
    statusEl.innerHTML = '<span class="error">Invalid bytecode</span>'
    return null
  }

  async function compareBytecode() {
    const output = document.getElementById('diff-output')
    const bcA = await resolveBytecode(document.getElementById('diff-a').value.trim(), document.getElementById('diff-a-status'))
    const bcB = await resolveBytecode(document.getElementById('diff-b').value.trim(), document.getElementById('diff-b-status'))
    if (!bcA || !bcB) { output.innerHTML = '<div class="result-card error">Need two valid bytecodes to compare.</div>'; return }

    const hexA = strip0x(bcA)
    const hexB = strip0x(bcB)
    const lenA = hexA.length / 2
    const lenB = hexB.length / 2
    const maxLen = Math.max(hexA.length, hexB.length)

    // Count differences at byte level
    let diffCount = 0
    let sameCount = 0
    for (let i = 0; i < maxLen; i += 2) {
      const a = hexA.slice(i, i + 2)
      const b = hexB.slice(i, i + 2)
      if (a === b) sameCount++
      else diffCount++
    }

    // Check CBOR metadata
    const cborA = hexA.length > 8 ? parseInt(hexA.slice(-4), 16) : 0
    const cborB = hexB.length > 8 ? parseInt(hexB.slice(-4), 16) : 0
    const cborNote = (cborA > 0 && cborA < 100 && cborB > 0 && cborB < 100)
      ? `<div class="text-dim" style="margin-top:8px">CBOR metadata: A=${cborA} bytes, B=${cborB} bytes. Metadata often differs between identical source compiled at different times.</div>`
      : ''

    // Build highlighted side-by-side rows
    let rows = ''
    const rowSize = 64
    let diffRegions = 0
    for (let i = 0; i < maxLen; i += rowSize) {
      const chunkA = hexA.slice(i, i + rowSize) || ''
      const chunkB = hexB.slice(i, i + rowSize) || ''
      const isDiff = chunkA !== chunkB
      if (isDiff) diffRegions++

      // Highlight individual byte differences within each chunk
      let highlightedA = '', highlightedB = ''
      for (let j = 0; j < rowSize; j += 2) {
        const byteA = chunkA.slice(j, j + 2)
        const byteB = chunkB.slice(j, j + 2)
        if (!byteA && !byteB) break
        if (byteA === byteB) {
          highlightedA += byteA
          highlightedB += byteB
        } else {
          highlightedA += byteA ? `<span class="diff-byte-changed">${byteA}</span>` : ''
          highlightedB += byteB ? `<span class="diff-byte-changed">${byteB}</span>` : ''
        }
      }

      rows += `<div class="diff-bc-row${isDiff ? ' diff-bc-changed' : ''}"><span class="bc-offset">${(i / 2).toString(16).padStart(4, '0')}</span><span class="diff-bc-chunk">${highlightedA || '<span class="text-dim">—</span>'}</span><span class="diff-bc-chunk">${highlightedB || '<span class="text-dim">—</span>'}</span></div>`
    }

    const pct = maxLen > 0 ? ((diffCount / (maxLen / 2)) * 100).toFixed(1) : 0

    output.innerHTML = `<div class="result-card">
      <div class="diff-summary">
        <span>A: ${lenA.toLocaleString()} bytes</span>
        <span>B: ${lenB.toLocaleString()} bytes</span>
        <span class="${diffCount > 0 ? 'diff-changed' : 'diff-added'}">${diffCount} bytes differ (${pct}%)</span>
        <span>${sameCount} bytes identical</span>
      </div>
      ${cborNote}
      <div class="bc-listing" style="margin-top:12px">
        <div class="diff-bc-header"><span>Offset</span><span>Contract A</span><span>Contract B</span></div>
        ${rows}
      </div>
    </div>`
  }
}
