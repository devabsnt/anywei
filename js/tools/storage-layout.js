import { esc, copyBtn } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Storage Layout</h2>
      <p class="tool-desc">Visualize a contract's state-variable slot layout. Load a compiled artifact from the IDE or paste a storageLayout JSON.</p>
    </div>
    <div class="tool-body">
      <div class="input-row">
        <div class="input-group flex-1">
          <label>Contract</label>
          <select id="sl-artifact" class="mono-input">
            <option value="">— select a compiled contract —</option>
          </select>
        </div>
        <button class="btn" id="sl-paste-btn" style="align-self:flex-end">Paste JSON</button>
      </div>
      <textarea id="sl-json" class="mono-input" style="display:none;width:100%;min-height:140px;margin-top:8px" placeholder='{"storage":[...],"types":{...}}' spellcheck="false"></textarea>
      <div id="sl-output" class="output-area" style="margin-top:12px"></div>
    </div>
  `

  const artifactSelect = document.getElementById('sl-artifact')
  const jsonArea = document.getElementById('sl-json')
  const pasteBtn = document.getElementById('sl-paste-btn')
  const output = document.getElementById('sl-output')

  // Populate artifact dropdown from localStorage
  let artifacts = {}
  try { artifacts = JSON.parse(localStorage.getItem('anywei_compiled') || '{}') } catch {}
  for (const name of Object.keys(artifacts)) {
    if (artifacts[name]?.storageLayout) {
      const opt = document.createElement('option')
      opt.value = name
      opt.textContent = name
      artifactSelect.appendChild(opt)
    }
  }

  if (artifactSelect.options.length === 1) {
    output.innerHTML = '<div class="text-dim">No compiled contracts with storage layout available. Compile a contract in the IDE first.</div>'
  }

  artifactSelect.addEventListener('change', () => {
    jsonArea.style.display = 'none'
    const name = artifactSelect.value
    if (!name) { output.innerHTML = ''; return }
    const layout = artifacts[name]?.storageLayout
    if (!layout) { output.innerHTML = '<div class="text-dim">No storage layout for this contract.</div>'; return }
    renderLayout(layout, name)
  })

  pasteBtn.addEventListener('click', () => {
    jsonArea.style.display = jsonArea.style.display === 'none' ? 'block' : 'none'
    if (jsonArea.style.display === 'block') jsonArea.focus()
  })

  jsonArea.addEventListener('input', () => {
    const txt = jsonArea.value.trim()
    if (!txt) { output.innerHTML = ''; return }
    try {
      const layout = JSON.parse(txt)
      renderLayout(layout, 'pasted')
    } catch (e) {
      output.innerHTML = `<div class="term-error">Invalid JSON: ${esc(e.message)}</div>`
    }
  })

  function renderLayout(layout, name) {
    if (!layout?.storage || !Array.isArray(layout.storage)) {
      output.innerHTML = '<div class="term-error">Layout JSON missing "storage" array.</div>'
      return
    }
    const types = layout.types || {}
    const rows = layout.storage.map(s => {
      const t = types[s.type]
      const size = t?.numberOfBytes || '?'
      const typeLabel = t?.label || s.type
      const encoding = t?.encoding || ''
      return { slot: s.slot, offset: s.offset, size, label: s.label, type: typeLabel, encoding }
    })

    // Group by slot to show packing
    const slots = new Map()
    for (const r of rows) {
      const k = r.slot
      if (!slots.has(k)) slots.set(k, [])
      slots.get(k).push(r)
    }

    let html = `<div class="text-dim" style="margin-bottom:8px">${rows.length} state variable${rows.length === 1 ? '' : 's'} across ${slots.size} slot${slots.size === 1 ? '' : 's'}${name ? ` — ${esc(name)}` : ''}</div>`
    html += `<table class="storage-layout-table"><thead><tr>
      <th>Slot</th><th>Offset</th><th>Size</th><th>Name</th><th>Type</th><th>Encoding</th>
    </tr></thead><tbody>`
    for (const [slot, entries] of slots) {
      const packed = entries.length > 1 ? ' class="packed"' : ''
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        const first = i === 0
        html += `<tr${packed}>`
        html += first ? `<td rowspan="${entries.length}" class="mono-cell">${esc(slot)}</td>` : ''
        html += `<td class="mono-cell">${e.offset}</td>`
        html += `<td class="mono-cell">${e.size}B</td>`
        html += `<td class="mono-cell">${esc(e.label)}</td>`
        html += `<td class="mono-cell">${esc(e.type)}</td>`
        html += `<td class="text-dim" style="font-size:11px">${esc(e.encoding)}</td>`
        html += '</tr>'
      }
    }
    html += '</tbody></table>'

    // Summary: packed slots
    const packedSlots = [...slots.values()].filter(e => e.length > 1).length
    if (packedSlots > 0) {
      html += `<div class="text-dim" style="margin-top:8px;font-size:11px">${packedSlots} slot${packedSlots === 1 ? '' : 's'} packed (multiple variables share a slot — save gas).</div>`
    }
    output.innerHTML = html
    // Add copy button
    const copyWrap = document.createElement('div')
    copyWrap.style.marginTop = '8px'
    copyWrap.appendChild(copyBtn(JSON.stringify(layout, null, 2), 'Copy JSON'))
    output.appendChild(copyWrap)
  }
}
