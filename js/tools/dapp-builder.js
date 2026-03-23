import { esc } from '../shared/formatters.js'
import { fetchAbi } from '../shared/abi-cache.js'

// ── Component definitions ───────────────────────────────────

const COMPONENT_TYPES = {
  'connect-wallet': { label: 'Connect Wallet', icon: '\u26A1', defaults: { label: 'Connect Wallet' } },
  'call-button': { label: 'Call Button', icon: '\u25B6', defaults: { label: 'Send', functionName: '', params: {} } },
  'read-display': { label: 'Read Display', icon: '\u25C9', defaults: { label: '', functionName: '', pollInterval: 0, params: {} } },
  'input-field': { label: 'Input Field', icon: '\u2A37', defaults: { label: '', placeholder: '', paramType: 'text', boundId: '' } },
  'heading': { label: 'Text / Heading', icon: 'T', defaults: { text: 'Heading', tag: 'h2', align: 'center', fontFamily: 'system', fontSize: '' } },
  'balance': { label: 'Balance Display', icon: '\u039E', defaults: { label: 'Balance', token: '' } },
  'event-feed': { label: 'Event Feed', icon: '\u2759', defaults: { eventName: '', maxItems: 5 } },
}

const FONT_MAP = {
  'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  'mono': '"Consolas", "Courier New", monospace',
  'inter': '"Inter", -apple-system, sans-serif',
  'serif': '"Georgia", "Times New Roman", serif',
  'space': '"Space Grotesk", -apple-system, sans-serif',
}

// ── State ───────────────────────────────────────────────────

const BUILDER_STATE_KEY = 'anywei_dapp_builder'

function loadBuilderState() {
  try {
    const saved = localStorage.getItem(BUILDER_STATE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function saveBuilderState() {
  try { localStorage.setItem(BUILDER_STATE_KEY, JSON.stringify(state)) } catch {}
}

let state = loadBuilderState() || {
  contract: { address: '', abi: null, chainId: 1 },
  theme: { mode: 'dark', primary: '#f59e0b', bg: '#0a0a0a', surface: '#141414', text: '#e5e5e5', radius: '4px' },
  layout: 'grid',
  gridCols: 6,
  components: [],
  selected: null,
  nextId: 1,
}

function findNextGridRow() {
  if (state.components.length === 0) return 1
  const maxRow = Math.max(...state.components.map(c => (c.position.row || 0) + (c.position.height || 1)))
  return maxRow + 1
}

function addComponent(type, pos) {
  const def = COMPONENT_TYPES[type]
  const comp = {
    id: 'c' + state.nextId++,
    type,
    position: { col: pos?.col || 1, row: pos?.row || findNextGridRow(), width: type === 'heading' ? state.gridCols : 2, height: 1 },
    props: { ...def.defaults },
    bindings: { onSuccess: [] },
    style: {},
  }
  state.components.push(comp)
  state.selected = comp.id
  saveBuilderState()
  return comp
}

function removeComponent(id) {
  state.components = state.components.filter(c => c.id !== id)
  // Clean up bindings referencing this component
  for (const c of state.components) {
    c.bindings.onSuccess = c.bindings.onSuccess.filter(rid => rid !== id)
    if (c.props.params) {
      for (const [k, v] of Object.entries(c.props.params)) {
        if (v === id) delete c.props.params[k]
      }
    }
  }
  if (state.selected === id) state.selected = null
  saveBuilderState()
}

function getComp(id) { return state.components.find(c => c.id === id) }

// ── Render ──────────────────────────────────────────────────

export function render(container) {
  container.innerHTML = `
    <div class="db-layout">
      <div class="db-top-bar">
        <div class="db-top-left">
          <div class="db-contract-section">
            <select id="db-contract-source" class="mono-input" style="font-size:11px;width:130px">
              <option value="address">Address</option>
              <option value="ide">From IDE</option>
              <option value="abi">Paste ABI</option>
            </select>
            <input type="text" id="db-contract" class="mono-input" placeholder="0x contract address" spellcheck="false" style="font-size:11px;width:240px">
            <select id="db-ide-contract" class="mono-input hidden" style="font-size:11px;width:240px"></select>
            <div id="db-contract-status" class="status-line" style="font-size:10px"></div>
          </div>
          <div class="db-target-section">
            <input type="text" id="db-target-addr" class="mono-input" placeholder="Target address (for export)" spellcheck="false" style="font-size:11px;width:240px" title="The address used in the exported frontend. Set this if using CREATE2 or deploying later.">
          </div>
          <select id="db-theme" class="mono-input" style="width:80px;font-size:11px">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="db-top-right">
          <button id="db-preview" class="btn">Preview</button>
          <button id="db-export" class="btn btn-primary">Export HTML</button>
        </div>
      </div>

      <div class="db-main">
        <div class="db-palette">
          <div class="db-palette-header">Components</div>
          ${Object.entries(COMPONENT_TYPES).map(([type, def]) => `
            <div class="db-palette-item" draggable="true" data-type="${type}">
              <span class="db-palette-icon">${def.icon}</span> ${def.label}
            </div>
          `).join('')}
        </div>

        <div class="db-canvas-wrap">
          <div id="db-canvas" class="db-canvas db-grid"></div>
        </div>

        <div class="db-props" id="db-props">
          <div class="db-props-header">Properties</div>
          <div class="db-props-empty">Select a component</div>
        </div>
      </div>
    </div>
  `

  const canvas = document.getElementById('db-canvas')
  const propsPanel = document.getElementById('db-props')
  const contractInput = document.getElementById('db-contract')
  const contractSource = document.getElementById('db-contract-source')
  const ideContractSelect = document.getElementById('db-ide-contract')
  const contractStatus = document.getElementById('db-contract-status')

  // ── Contract source switching ──
  contractSource.addEventListener('change', () => {
    const mode = contractSource.value
    contractInput.classList.toggle('hidden', mode === 'ide')
    ideContractSelect.classList.toggle('hidden', mode !== 'ide')
    contractInput.placeholder = mode === 'address' ? '0x contract address (deployed or CREATE2 predicted)' : 'Paste ABI JSON array'
    if (mode === 'ide') populateIdeContracts()
  })

  const targetAddrInput = document.getElementById('db-target-addr')

  contractInput.addEventListener('change', loadContract)
  contractInput.addEventListener('paste', () => setTimeout(loadContract, 50))
  ideContractSelect.addEventListener('change', loadIdeContract)
  targetAddrInput.addEventListener('input', () => {
    state.contract.address = targetAddrInput.value.trim()
  })

  // Populate IDE contracts dropdown
  function populateIdeContracts() {
    try {
      const compiled = localStorage.getItem('anywei_compiled')
      if (!compiled) { ideContractSelect.innerHTML = '<option value="">No compiled contracts</option>'; return }
      const arts = JSON.parse(compiled)
      const names = Object.keys(arts)
      if (names.length === 0) { ideContractSelect.innerHTML = '<option value="">No compiled contracts</option>'; return }
      ideContractSelect.innerHTML = '<option value="">Select a contract...</option>' +
        names.map(n => `<option value="${esc(n)}">${esc(n)} (${arts[n].abi?.filter(e => e.type === 'function').length || 0} fn)</option>`).join('')
    } catch {
      ideContractSelect.innerHTML = '<option value="">Error loading</option>'
    }
  }

  // Auto-load first IDE contract on init
  try {
    const compiled = localStorage.getItem('anywei_compiled')
    if (compiled) {
      const arts = JSON.parse(compiled)
      const first = Object.values(arts)[0]
      if (first?.abi) {
        state.contract.abi = first.abi
        contractSource.value = 'ide'
        contractInput.classList.add('hidden')
        ideContractSelect.classList.remove('hidden')
        populateIdeContracts()
        ideContractSelect.value = Object.keys(arts)[0]
        contractStatus.innerHTML = `<span class="success">${first.abi.filter(e => e.type === 'function').length} functions loaded from IDE</span>`
      }
    }
  } catch {}

  function loadIdeContract() {
    const name = ideContractSelect.value
    if (!name) return
    try {
      const arts = JSON.parse(localStorage.getItem('anywei_compiled'))
      const art = arts[name]
      if (art?.abi) {
        state.contract.abi = art.abi
        state.contract.address = '' // No address yet — user can set one
        contractStatus.innerHTML = `<span class="success">${esc(name)}: ${art.abi.filter(e => e.type === 'function').length} functions</span>`
        renderProps()
      }
    } catch {}
  }

  async function loadContract() {
    const raw = contractInput.value.trim()
    if (!raw) return
    const mode = contractSource.value

    if (mode === 'address' && raw.startsWith('0x') && raw.length === 42) {
      contractStatus.innerHTML = '<span class="loading">Fetching ABI...</span>'
      try {
        const result = await fetchAbi(raw)
        if (result.abi) {
          state.contract.abi = result.abi
          state.contract.address = raw
          targetAddrInput.value = raw
          contractStatus.innerHTML = `<span class="success">${esc(result.contractName || 'Loaded')}: ${result.abi.filter(e => e.type === 'function').length} functions at ${raw.slice(0, 8)}...</span>`
        } else {
          contractStatus.innerHTML = '<span class="error">Not verified — paste ABI manually</span>'
        }
      } catch (e) {
        contractStatus.innerHTML = `<span class="error">${esc(e.message)}</span>`
      }
    } else if (mode === 'address' && raw.startsWith('0x')) {
      // Looks like an address but wrong length — might be typing
      state.contract.address = raw
      contractStatus.innerHTML = '<span class="text-dim">Enter full address (42 chars) to fetch ABI, or switch to "Paste ABI"</span>'
    } else {
      // ABI mode — try to parse JSON
      try {
        const parsed = JSON.parse(raw)
        state.contract.abi = Array.isArray(parsed) ? parsed : parsed.abi
        contractStatus.innerHTML = `<span class="success">${state.contract.abi.filter(e => e.type === 'function').length} functions loaded</span>`
      } catch {
        contractStatus.innerHTML = '<span class="error">Invalid ABI JSON</span>'
      }
    }
    renderProps()
  }

  // ── Theme ──
  document.getElementById('db-theme').addEventListener('change', (e) => {
    state.theme.mode = e.target.value
    if (e.target.value === 'light') {
      Object.assign(state.theme, { bg: '#ffffff', surface: '#f5f5f5', text: '#1a1a1a' })
    } else if (e.target.value === 'dark') {
      Object.assign(state.theme, { bg: '#0a0a0a', surface: '#141414', text: '#e5e5e5' })
    }
    saveBuilderState()
  })

  // ── Drag from palette ──
  container.querySelectorAll('.db-palette-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('component-type', item.dataset.type)
    })
  })

  canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' })
  canvas.addEventListener('drop', (e) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('component-type')
    if (!type) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const col = Math.max(1, Math.ceil((x / rect.width) * state.gridCols))
    const row = Math.max(1, Math.ceil(y / 50))
    addComponent(type, { col, row })
    renderCanvas()
    renderProps()
  })

  // Also allow clicking palette to add
  container.querySelectorAll('.db-palette-item').forEach(item => {
    item.addEventListener('click', () => {
      addComponent(item.dataset.type)
      renderCanvas()
      renderProps()
    })
  })

  // ── Canvas rendering ──
  function renderCanvas() {
    saveBuilderState()
    canvas.innerHTML = ''
    canvas.style.gridTemplateColumns = `repeat(${state.gridCols}, 1fr)`

    for (const comp of state.components) {
      const el = document.createElement('div')
      el.className = `db-comp ${state.selected === comp.id ? 'db-comp-selected' : ''}`
      el.dataset.id = comp.id

      el.style.gridColumn = `${comp.position.col} / span ${comp.position.width}`
      el.style.gridRow = `${comp.position.row} / span ${comp.position.height}`

      const def = COMPONENT_TYPES[comp.type]

      // Apply heading-specific styles
      if (comp.type === 'heading') {
        if (comp.props.align) el.style.textAlign = comp.props.align
        if (comp.props.fontFamily && comp.props.fontFamily !== 'system') el.style.fontFamily = FONT_MAP[comp.props.fontFamily] || ''
        if (comp.props.fontSize) el.style.fontSize = comp.props.fontSize + 'px'
      }

      // Apply font props to any component that has them
      if (comp.style?.fontFamily) el.style.fontFamily = FONT_MAP[comp.style.fontFamily] || ''
      if (comp.style?.fontSize) el.style.fontSize = comp.style.fontSize + 'px'

      el.innerHTML = `<span class="db-comp-icon">${def.icon}</span> <span class="db-comp-label">${esc(comp.props.label || comp.props.text || comp.props.functionName || def.label)}</span><button class="db-comp-remove" data-id="${comp.id}">&times;</button><div class="db-resize-handle"></div>`

      // Track drag vs click
      let didDrag = false

      el.style.cursor = 'move'
      el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('db-comp-remove')) return
        if (e.target.classList.contains('db-resize-handle')) return // handled separately
        e.preventDefault()
        didDrag = false
        state.selected = comp.id

        // Update selection immediately without re-render
        canvas.querySelectorAll('.db-comp').forEach(c => c.classList.remove('db-comp-selected'))
        el.classList.add('db-comp-selected')
        renderProps()

        const rect = canvas.getBoundingClientRect()
        const cellW = rect.width / state.gridCols
        const rowH = 56
        const onMove = (ev) => {
          didDrag = true
          const x = ev.clientX - rect.left
          const y = ev.clientY - rect.top
          const newCol = Math.max(1, Math.min(state.gridCols - comp.position.width + 1, Math.ceil(x / cellW)))
          const newRow = Math.max(1, Math.ceil(y / rowH))
          if (newCol !== comp.position.col || newRow !== comp.position.row) {
            comp.position.col = newCol
            comp.position.row = newRow
            el.style.gridColumn = `${newCol} / span ${comp.position.width}`
            el.style.gridRow = `${newRow} / span ${comp.position.height}`
          }
        }
        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          if (didDrag) { renderCanvas(); renderProps() }
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })

      // Remove button
      const removeBtn = el.querySelector('.db-comp-remove')
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          removeComponent(comp.id)
          renderCanvas()
          renderProps()
        })
      }

      // Resize handle — drag to change column span
      const resizeHandle = el.querySelector('.db-resize-handle')
      if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
          e.stopPropagation()
          e.preventDefault()
          const startX = e.clientX
          const origWidth = comp.position.width
          const rect = canvas.getBoundingClientRect()
          const cellW = rect.width / state.gridCols
          const onMove = (ev) => {
            const deltaCols = Math.round((ev.clientX - startX) / cellW)
            const newWidth = Math.max(1, Math.min(state.gridCols - comp.position.col + 1, origWidth + deltaCols))
            if (newWidth !== comp.position.width) {
              comp.position.width = newWidth
              el.style.gridColumn = `${comp.position.col} / span ${newWidth}`
            }
          }
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); renderCanvas(); renderProps() }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        })
      }

      canvas.appendChild(el)
    }

    if (state.components.length === 0) {
      canvas.innerHTML = '<div class="db-canvas-empty">Drag components here or click them in the palette</div>'
    }

    // Draw chain lines (SVG overlay)
    const chains = state.components.filter(c => c.bindings.onSuccess?.length > 0)
    if (chains.length > 0) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.classList.add('db-chain-svg')
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      svg.style.position = 'absolute'
      svg.style.inset = '0'
      svg.style.pointerEvents = 'none'
      svg.style.zIndex = '5'

      // Need to wait for layout so we can read element positions
      requestAnimationFrame(() => {
        const canvasRect = canvas.getBoundingClientRect()
        for (const comp of chains) {
          const fromEl = canvas.querySelector(`[data-id="${comp.id}"]`)
          if (!fromEl) continue
          const fromRect = fromEl.getBoundingClientRect()
          const fromX = fromRect.left - canvasRect.left + fromRect.width / 2
          const fromY = fromRect.top - canvasRect.top + fromRect.height

          for (const targetId of comp.bindings.onSuccess) {
            const toEl = canvas.querySelector(`[data-id="${targetId}"]`)
            if (!toEl) continue
            const toRect = toEl.getBoundingClientRect()
            const toX = toRect.left - canvasRect.left + toRect.width / 2
            const toY = toRect.top - canvasRect.top

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
            line.setAttribute('x1', fromX)
            line.setAttribute('y1', fromY)
            line.setAttribute('x2', toX)
            line.setAttribute('y2', toY)
            line.setAttribute('stroke', '#f59e0b')
            line.setAttribute('stroke-width', '1.5')
            line.setAttribute('stroke-dasharray', '4 3')
            line.setAttribute('opacity', '0.5')
            svg.appendChild(line)

            // Arrow head
            const angle = Math.atan2(toY - fromY, toX - fromX)
            const arrowSize = 6
            const ax = toX - arrowSize * Math.cos(angle - 0.4)
            const ay = toY - arrowSize * Math.sin(angle - 0.4)
            const bx = toX - arrowSize * Math.cos(angle + 0.4)
            const by = toY - arrowSize * Math.sin(angle + 0.4)
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
            arrow.setAttribute('points', `${toX},${toY} ${ax},${ay} ${bx},${by}`)
            arrow.setAttribute('fill', '#f59e0b')
            arrow.setAttribute('opacity', '0.6')
            svg.appendChild(arrow)
          }
        }
      })

      canvas.appendChild(svg)
    }
  }

  // Delete key removes selected component — immediate visual feedback
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      e.preventDefault()
      // Immediately remove from DOM for instant feedback
      const el = canvas.querySelector(`[data-id="${state.selected}"]`)
      if (el) el.remove()
      removeComponent(state.selected)
      renderProps()
      // Deferred full re-render for chain lines etc
      requestAnimationFrame(() => renderCanvas())
    }
  })

  // ── Properties panel ──
  function renderProps() {
    const comp = getComp(state.selected)
    if (!comp) {
      propsPanel.innerHTML = '<div class="db-props-header">Properties</div><div class="db-props-empty">Select a component</div>'
      return
    }

    const def = COMPONENT_TYPES[comp.type]
    const fns = state.contract.abi?.filter(e => e.type === 'function') || []
    const writeFns = fns.filter(f => f.stateMutability !== 'view' && f.stateMutability !== 'pure')
    const readFns = fns.filter(f => f.stateMutability === 'view' || f.stateMutability === 'pure')
    const events = state.contract.abi?.filter(e => e.type === 'event') || []
    const inputComps = state.components.filter(c => c.type === 'input-field')
    const refreshable = state.components.filter(c => c.type === 'read-display' || c.type === 'balance')

    let html = `<div class="db-props-header">${esc(def.label)} <span class="text-dim">${comp.id}</span></div>`

    // Common props
    if (comp.type !== 'heading') {
      html += propInput('Label', 'label', comp.props.label || '')
    }

    // Type-specific props
    if (comp.type === 'heading') {
      html += propInput('Text', 'text', comp.props.text || '')
      html += propSelect('Tag', 'tag', comp.props.tag, { h1: 'H1', h2: 'H2', h3: 'H3', p: 'Paragraph' })
      html += propSelect('Align', 'align', comp.props.align || 'center', { left: 'Left', center: 'Center', right: 'Right' })
      html += propSelect('Font', 'fontFamily', comp.props.fontFamily || 'system', { system: 'System', mono: 'Monospace', inter: 'Inter', serif: 'Serif', space: 'Space Grotesk' })
      html += propInput('Font size (px)', 'fontSize', comp.props.fontSize || '')
    }

    if (comp.type === 'call-button') {
      html += propSelect('Function', 'functionName', comp.props.functionName, Object.fromEntries(writeFns.map(f => [f.name, `${f.name}(${(f.inputs || []).map(i => i.type).join(',')})`])))
      // Param bindings
      const fn = writeFns.find(f => f.name === comp.props.functionName)
      if (fn?.inputs?.length) {
        html += '<div class="db-prop-section">Parameter Sources</div>'
        html += '<div class="db-prop-hint">Link input fields to function parameters</div>'
        for (const inp of fn.inputs) {
          html += propSelect(`${inp.name} (${inp.type})`, `param_${inp.name}`, comp.props.params?.[inp.name] || '', { '': '— prompt user —', ...Object.fromEntries(inputComps.map(c => [c.id, c.props.label || c.id])) })
        }
      }
    }

    // Chaining — available for call-button type
    if (comp.type === 'call-button') {
      const others = state.components.filter(c => c.id !== comp.id && (c.type === 'read-display' || c.type === 'balance' || c.type === 'event-feed'))
      html += '<div class="db-prop-section">Chains</div>'
      if (others.length === 0) {
        html += '<div class="db-prop-hint">Add Read Display or Balance components, then chain them here to auto-refresh after this button\'s transaction succeeds.</div>'
      } else {
        html += '<div class="db-prop-hint">After this tx succeeds, refresh:</div>'
        for (const rc of others) {
          const checked = comp.bindings.onSuccess.includes(rc.id) ? 'checked' : ''
          const rcDef = COMPONENT_TYPES[rc.type]
          html += `<label class="db-prop-check"><input type="checkbox" data-chain="${rc.id}" ${checked}><span class="db-chain-icon">${rcDef.icon}</span> ${esc(rc.props.label || rc.props.functionName || rc.props.eventName || rc.id)}</label>`
        }
      }
    }

    if (comp.type === 'read-display') {
      html += propSelect('Function', 'functionName', comp.props.functionName, Object.fromEntries(readFns.map(f => [f.name, `${f.name}(${(f.inputs || []).map(i => i.type).join(',')})`])))
      html += propInput('Poll interval (ms)', 'pollInterval', comp.props.pollInterval || '0')
    }

    if (comp.type === 'input-field') {
      html += propInput('Placeholder', 'placeholder', comp.props.placeholder || '')
      html += propSelect('Type', 'paramType', comp.props.paramType, { text: 'Text', number: 'Number', address: 'Address' })
    }

    if (comp.type === 'balance') {
      html += propInput('Token address (empty = ETH)', 'token', comp.props.token || '')
    }

    if (comp.type === 'event-feed') {
      html += propSelect('Event', 'eventName', comp.props.eventName, Object.fromEntries(events.map(e => [e.name, e.name])))
      html += propInput('Max items', 'maxItems', comp.props.maxItems || '5')
    }

    // Style (for non-heading components — heading has its own font controls above)
    if (comp.type !== 'heading') {
      html += '<div class="db-prop-section">Style</div>'
      html += propSelect('Font', 'style_fontFamily', comp.style?.fontFamily || 'system', { system: 'System', mono: 'Monospace', inter: 'Inter', serif: 'Serif', space: 'Space Grotesk' })
      html += propInput('Font size (px)', 'style_fontSize', comp.style?.fontSize || '')
    }

    // Position
    html += '<div class="db-prop-section">Position</div>'
    html += propInput('Column', 'pos_col', comp.position.col)
    html += propInput('Row', 'pos_row', comp.position.row)
    html += propInput('Width (cols)', 'pos_width', comp.position.width)

    propsPanel.innerHTML = html

    // Bind prop inputs
    propsPanel.querySelectorAll('.db-prop-input').forEach(el => {
      el.addEventListener('input', () => {
        const key = el.dataset.prop
        const val = el.value
        if (key.startsWith('pos_')) {
          const posKey = key.slice(4)
          comp.position[posKey] = parseInt(val) || 0
        } else if (key.startsWith('param_')) {
          if (!comp.props.params) comp.props.params = {}
          comp.props.params[key.slice(6)] = val
        } else if (key.startsWith('style_')) {
          if (!comp.style) comp.style = {}
          comp.style[key.slice(6)] = val
        } else {
          comp.props[key] = val
        }
        renderCanvas()
      })
    })

    // Bind chain checkboxes
    propsPanel.querySelectorAll('[data-chain]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.chain
        if (cb.checked) { if (!comp.bindings.onSuccess.includes(id)) comp.bindings.onSuccess.push(id) }
        else { comp.bindings.onSuccess = comp.bindings.onSuccess.filter(x => x !== id) }
      })
    })
  }

  function propInput(label, key, value) {
    return `<div class="db-prop-row"><label class="db-prop-label">${label}</label><input type="text" class="mono-input db-prop-input" data-prop="${key}" value="${esc(String(value))}" spellcheck="false"></div>`
  }

  function propSelect(label, key, value, options) {
    const opts = Object.entries(options || {}).map(([k, v]) => `<option value="${esc(k)}" ${k === value ? 'selected' : ''}>${esc(v)}</option>`).join('')
    return `<div class="db-prop-row"><label class="db-prop-label">${label}</label><select class="mono-input db-prop-input" data-prop="${key}">${opts}</select></div>`
  }

  // ── Preview ──
  document.getElementById('db-preview').addEventListener('click', () => {
    const html = generateExport()
    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
  })

  // ── Export ──
  document.getElementById('db-export').addEventListener('click', () => {
    const html = generateExport()
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'dapp.html'
    a.click()
    URL.revokeObjectURL(a.href)
  })

  function generateExport() {
    const t = state.theme
    const isDark = t.mode === 'dark'
    const bg = isDark ? '#0a0a0a' : '#ffffff'
    const surface = isDark ? '#141414' : '#f5f5f5'
    const text = isDark ? '#e5e5e5' : '#1a1a1a'
    const border = isDark ? '#262626' : '#e0e0e0'
    const accent = t.primary
    const radius = t.radius

    const contractAddr = state.contract.address || '0x_CONTRACT_ADDRESS_HERE'
    const abi = state.contract.abi ? JSON.stringify(state.contract.abi) : '[]'

    let compsHtml = ''
    let compsJs = ''

    for (const comp of state.components) {
      const cid = comp.id
      const label = esc(comp.props.label || '')

      if (comp.type === 'connect-wallet') {
        compsHtml += `<div id="${cid}" class="dapp-comp"><button onclick="connectWallet()" id="${cid}-btn">${label || 'Connect Wallet'}</button></div>`
        compsJs += `\nasync function connectWallet(){try{const[a]=await ethereum.request({method:'eth_requestAccounts'});document.getElementById('${cid}-btn').textContent=a.slice(0,6)+'...'+a.slice(-4);window._account=a;window._provider=new ethers.BrowserProvider(ethereum)}catch(e){alert(e.message)}}`
      }

      if (comp.type === 'heading') {
        const tag = comp.props.tag || 'h2'
        compsHtml += `<div id="${cid}" class="dapp-comp"><${tag}>${esc(comp.props.text || '')}</${tag}></div>`
      }

      if (comp.type === 'input-field') {
        compsHtml += `<div id="${cid}" class="dapp-comp"><label>${label}</label><input type="${comp.props.paramType === 'number' ? 'number' : 'text'}" id="${cid}-input" placeholder="${esc(comp.props.placeholder || '')}" class="dapp-input"></div>`
      }

      if (comp.type === 'call-button') {
        const fnName = comp.props.functionName
        const fn = state.contract.abi?.find(e => e.type === 'function' && e.name === fnName)
        const paramSources = fn?.inputs?.map(inp => {
          const boundId = comp.props.params?.[inp.name]
          return boundId ? `document.getElementById('${boundId}-input').value` : `prompt('${inp.name} (${inp.type}):')`
        }) || []
        const refreshIds = comp.bindings.onSuccess || []

        compsHtml += `<div id="${cid}" class="dapp-comp"><button onclick="${cid}_call()" id="${cid}-btn">${label || fnName || 'Call'}</button><div id="${cid}-status" class="dapp-status"></div></div>`
        compsJs += `\nasync function ${cid}_call(){
  const btn=document.getElementById('${cid}-btn');const st=document.getElementById('${cid}-status');
  if(!window._provider){st.textContent='Connect wallet first';return}
  btn.disabled=true;st.textContent='Sending...';
  try{const signer=await window._provider.getSigner();const c=new ethers.Contract('${contractAddr}',abi,signer);
  const tx=await c.${fnName}(${paramSources.join(',')});st.textContent='Tx: '+tx.hash.slice(0,14)+'...';
  await tx.wait();st.textContent='Confirmed!';${refreshIds.map(r => `try{${r}_refresh()}catch(e){}`).join(';')}
  }catch(e){st.textContent='Error: '+e.message?.slice(0,60)}btn.disabled=false}`
      }

      if (comp.type === 'read-display') {
        const fnName = comp.props.functionName
        compsHtml += `<div id="${cid}" class="dapp-comp"><div class="dapp-label">${label || fnName}</div><div id="${cid}-value" class="dapp-value">—</div></div>`
        compsJs += `\nasync function ${cid}_refresh(){
  try{const p=window._provider||new ethers.JsonRpcProvider('https://eth.llamarpc.com');const c=new ethers.Contract('${contractAddr}',abi,p);
  const r=await c.${fnName}();document.getElementById('${cid}-value').textContent=r.toString()}catch(e){document.getElementById('${cid}-value').textContent='Error'}}`
        if (comp.props.pollInterval > 0) {
          compsJs += `\nsetInterval(${cid}_refresh,${comp.props.pollInterval});${cid}_refresh();`
        } else {
          compsJs += `\n${cid}_refresh();`
        }
      }

      if (comp.type === 'balance') {
        compsHtml += `<div id="${cid}" class="dapp-comp"><div class="dapp-label">${label}</div><div id="${cid}-value" class="dapp-value">—</div></div>`
        compsJs += `\nasync function ${cid}_refresh(){
  if(!window._provider||!window._account)return;
  try{const b=await window._provider.getBalance(window._account);document.getElementById('${cid}-value').textContent=ethers.formatEther(b)+' ETH'}catch(e){}}`
        compsJs += `\nsetInterval(${cid}_refresh,5000);`
      }

      if (comp.type === 'event-feed') {
        compsHtml += `<div id="${cid}" class="dapp-comp"><div class="dapp-label">${comp.props.eventName || 'Events'}</div><div id="${cid}-list" class="dapp-events"></div></div>`
        compsJs += `\n(async()=>{try{const p=window._provider||new ethers.JsonRpcProvider('https://eth.llamarpc.com');const c=new ethers.Contract('${contractAddr}',abi,p);
  c.on('${comp.props.eventName}',(...args)=>{const el=document.getElementById('${cid}-list');const d=document.createElement('div');d.className='dapp-event';d.textContent=JSON.stringify(args.slice(0,-1).map(a=>a.toString()));el.prepend(d);while(el.children.length>${comp.props.maxItems || 5})el.lastChild.remove()})}catch(e){}})()`
      }
    }

    // Build layout CSS
    let layoutCss = `.dapp-canvas{display:grid;grid-template-columns:repeat(${state.gridCols},1fr);gap:12px;padding:20px;max-width:900px;margin:0 auto}`
    for (const comp of state.components) {
      layoutCss += `\n#${comp.id}{grid-column:${comp.position.col}/span ${comp.position.width};grid-row:${comp.position.row}/span ${comp.position.height}}`
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>dApp</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${bg};color:${text};font-family:-apple-system,system-ui,sans-serif;min-height:100vh}
${layoutCss}
.dapp-comp{padding:8px}
button{background:${accent};color:#000;border:none;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;border-radius:${radius};width:100%}
button:hover{opacity:0.9}button:disabled{opacity:0.5}
.dapp-input{width:100%;padding:10px;background:${surface};border:1px solid ${border};color:${text};font-size:14px;border-radius:${radius};margin-top:4px}
.dapp-label{font-size:12px;color:${isDark ? '#737373' : '#666'};margin-bottom:4px}
.dapp-value{font-size:20px;font-weight:600;font-family:monospace}
.dapp-status{font-size:12px;margin-top:4px;color:${isDark ? '#737373' : '#666'}}
.dapp-events{font-size:11px;font-family:monospace}
.dapp-event{padding:4px 0;border-bottom:1px solid ${border}}
h1,h2,h3{color:${text}}h1{font-size:28px}h2{font-size:22px}h3{font-size:16px}
label{font-size:13px;color:${isDark ? '#b0b0b0' : '#555'}}
</style>
</head>
<body>
<div class="dapp-canvas">
${compsHtml}
</div>
<script>
const abi=${abi};
${compsJs}
if(window.ethereum){ethereum.on('accountsChanged',()=>location.reload());ethereum.on('chainChanged',()=>location.reload())}
<\/script>
</body>
</html>`
  }

  renderCanvas()
}
