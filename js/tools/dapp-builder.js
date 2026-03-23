import { esc } from '../shared/formatters.js'
import { fetchAbi } from '../shared/abi-cache.js'

// ── Component definitions ───────────────────────────────────

const COMPONENT_TYPES = {
  'connect-wallet': { label: 'Connect Wallet', icon: '\u26A1', defaults: { label: 'Connect Wallet' } },
  'call-button': { label: 'Call Button', icon: '\u25B6', defaults: { label: 'Send', functionName: '', params: {} } },
  'read-display': { label: 'Read Display', icon: '\u25C9', defaults: { label: '', functionName: '', pollInterval: 0, params: {} } },
  'input-field': { label: 'Input Field', icon: '\u2A37', defaults: { label: '', placeholder: '', paramType: 'text', boundId: '' } },
  'heading': { label: 'Text / Heading', icon: 'T', defaults: { text: 'Heading', tag: 'h2' } },
  'balance': { label: 'Balance Display', icon: '\u039E', defaults: { label: 'Balance', token: '' } },
  'event-feed': { label: 'Event Feed', icon: '\u2759', defaults: { eventName: '', maxItems: 5 } },
}

// ── State ───────────────────────────────────────────────────

let state = {
  contract: { address: '', abi: null, chainId: 1 },
  theme: { mode: 'dark', primary: '#f59e0b', bg: '#0a0a0a', surface: '#141414', text: '#e5e5e5', radius: '4px' },
  layout: 'grid',
  gridCols: 6,
  components: [],
  selected: null,
  nextId: 1,
}

function addComponent(type, pos) {
  const def = COMPONENT_TYPES[type]
  const comp = {
    id: 'c' + state.nextId++,
    type,
    position: state.layout === 'grid'
      ? { col: pos?.col || 1, row: pos?.row || state.components.length + 1, width: type === 'heading' ? state.gridCols : 2, height: 1 }
      : { x: pos?.x || 20, y: pos?.y || 20 + state.components.length * 60, width: 200, height: 44 },
    props: { ...def.defaults },
    bindings: { onSuccess: [] },
    style: {},
  }
  state.components.push(comp)
  state.selected = comp.id
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
}

function getComp(id) { return state.components.find(c => c.id === id) }

// ── Render ──────────────────────────────────────────────────

export function render(container) {
  container.innerHTML = `
    <div class="db-layout">
      <div class="db-top-bar">
        <div class="db-top-left">
          <div class="input-group" style="width:260px">
            <input type="text" id="db-contract" class="mono-input" placeholder="Contract address or paste ABI" spellcheck="false" style="font-size:11px">
          </div>
          <div class="mode-tabs" style="margin:0">
            <button class="mode-btn active" data-layout="grid">Grid</button>
            <button class="mode-btn" data-layout="freeform">Freeform</button>
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
  let renderQueued = false

  // ── Contract loading ──
  contractInput.addEventListener('change', loadContract)
  contractInput.addEventListener('paste', () => setTimeout(loadContract, 50))

  // Check for compiled artifact from IDE
  try {
    const compiled = sessionStorage.getItem('anywei_compiled')
    if (compiled) {
      const arts = JSON.parse(compiled)
      const first = Object.values(arts)[0]
      if (first?.abi) {
        state.contract.abi = first.abi
        contractInput.value = first.contractName || 'From IDE'
        contractInput.title = `${first.abi.filter(e => e.type === 'function').length} functions loaded`
      }
    }
  } catch {}

  async function loadContract() {
    const raw = contractInput.value.trim()
    if (!raw) return
    if (raw.startsWith('0x') && raw.length === 42) {
      try {
        const result = await fetchAbi(raw)
        if (result.abi) {
          state.contract.abi = result.abi
          state.contract.address = raw
          contractInput.title = `${result.contractName || ''} — ${result.abi.filter(e => e.type === 'function').length} functions`
        }
      } catch {}
    } else {
      try {
        const parsed = JSON.parse(raw)
        state.contract.abi = Array.isArray(parsed) ? parsed : parsed.abi
      } catch {}
    }
    renderProps()
  }

  // ── Layout toggle ──
  container.querySelectorAll('[data-layout]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-layout]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      state.layout = btn.dataset.layout
      canvas.classList.toggle('db-grid', state.layout === 'grid')
      canvas.classList.toggle('db-freeform', state.layout === 'freeform')
      renderCanvas()
    })
  })

  // ── Theme ──
  document.getElementById('db-theme').addEventListener('change', (e) => {
    state.theme.mode = e.target.value
    if (e.target.value === 'light') {
      Object.assign(state.theme, { bg: '#ffffff', surface: '#f5f5f5', text: '#1a1a1a' })
    } else if (e.target.value === 'dark') {
      Object.assign(state.theme, { bg: '#0a0a0a', surface: '#141414', text: '#e5e5e5' })
    }
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
    if (state.layout === 'grid') {
      const col = Math.max(1, Math.ceil((x / rect.width) * state.gridCols))
      const row = Math.max(1, Math.ceil(y / 50))
      addComponent(type, { col, row })
    } else {
      addComponent(type, { x, y })
    }
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
    canvas.innerHTML = ''
    if (state.layout === 'grid') {
      canvas.style.gridTemplateColumns = `repeat(${state.gridCols}, 1fr)`
    }

    for (const comp of state.components) {
      const el = document.createElement('div')
      el.className = `db-comp ${state.selected === comp.id ? 'db-comp-selected' : ''}`
      el.dataset.id = comp.id

      if (state.layout === 'grid') {
        el.style.gridColumn = `${comp.position.col} / span ${comp.position.width}`
        el.style.gridRow = `${comp.position.row} / span ${comp.position.height}`
      } else {
        el.style.position = 'absolute'
        el.style.left = comp.position.x + 'px'
        el.style.top = comp.position.y + 'px'
        el.style.width = comp.position.width + 'px'
      }

      const def = COMPONENT_TYPES[comp.type]
      el.innerHTML = `<span class="db-comp-icon">${def.icon}</span> <span class="db-comp-label">${esc(comp.props.label || comp.props.text || comp.props.functionName || def.label)}</span><button class="db-comp-remove" data-id="${comp.id}">&times;</button>`

      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('db-comp-remove')) {
          removeComponent(comp.id)
          renderCanvas()
          renderProps()
          return
        }
        state.selected = comp.id
        renderCanvas()
        renderProps()
      })

      // Freeform drag to reposition
      if (state.layout === 'freeform') {
        el.style.cursor = 'move'
        el.addEventListener('mousedown', (e) => {
          if (e.target.classList.contains('db-comp-remove')) return
          e.preventDefault()
          const startX = e.clientX, startY = e.clientY
          const origX = comp.position.x, origY = comp.position.y
          const onMove = (ev) => {
            comp.position.x = Math.max(0, origX + ev.clientX - startX)
            comp.position.y = Math.max(0, origY + ev.clientY - startY)
            el.style.left = comp.position.x + 'px'
            el.style.top = comp.position.y + 'px'
          }
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        })
      }

      canvas.appendChild(el)
    }

    if (state.components.length === 0) {
      canvas.innerHTML = '<div class="db-canvas-empty">Drag components here or click them in the palette</div>'
    }
  }

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
    }

    if (comp.type === 'call-button') {
      html += propSelect('Function', 'functionName', comp.props.functionName, Object.fromEntries(writeFns.map(f => [f.name, `${f.name}(${(f.inputs || []).map(i => i.type).join(',')})`])))
      // Param bindings
      const fn = writeFns.find(f => f.name === comp.props.functionName)
      if (fn?.inputs?.length) {
        html += '<div class="db-prop-section">Parameter Sources</div>'
        for (const inp of fn.inputs) {
          html += propSelect(`${inp.name} (${inp.type})`, `param_${inp.name}`, comp.props.params?.[inp.name] || '', { '': '— manual —', ...Object.fromEntries(inputComps.map(c => [c.id, c.props.label || c.id])) })
        }
      }
      // Chaining
      if (refreshable.length) {
        html += '<div class="db-prop-section">On Success &rarr; Refresh</div>'
        for (const rc of refreshable) {
          const checked = comp.bindings.onSuccess.includes(rc.id) ? 'checked' : ''
          html += `<label class="db-prop-check"><input type="checkbox" data-chain="${rc.id}" ${checked}> ${esc(rc.props.label || rc.props.functionName || rc.id)}</label>`
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

    // Position
    html += '<div class="db-prop-section">Position</div>'
    if (state.layout === 'grid') {
      html += propInput('Column', 'pos_col', comp.position.col)
      html += propInput('Row', 'pos_row', comp.position.row)
      html += propInput('Width (cols)', 'pos_width', comp.position.width)
    } else {
      html += propInput('X', 'pos_x', comp.position.x)
      html += propInput('Y', 'pos_y', comp.position.y)
      html += propInput('Width', 'pos_width', comp.position.width)
    }

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
    let layoutCss = ''
    if (state.layout === 'grid') {
      layoutCss = `.dapp-canvas{display:grid;grid-template-columns:repeat(${state.gridCols},1fr);gap:12px;padding:20px;max-width:900px;margin:0 auto}`
      for (const comp of state.components) {
        layoutCss += `\n#${comp.id}{grid-column:${comp.position.col}/span ${comp.position.width};grid-row:${comp.position.row}/span ${comp.position.height}}`
      }
    } else {
      layoutCss = `.dapp-canvas{position:relative;min-height:600px;max-width:900px;margin:0 auto;padding:20px}`
      for (const comp of state.components) {
        layoutCss += `\n#${comp.id}{position:absolute;left:${comp.position.x}px;top:${comp.position.y}px;width:${comp.position.width}px}`
      }
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
