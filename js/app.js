import { inject } from '@vercel/analytics'
inject()

// ── Tool registry ────────────────────────────────────────────
const TOOLS = [
  // ── Build ──
  { id: 'solidity-ide', path: '/ide', label: 'Solidity IDE', icon: '\u270E', keywords: 'solidity ide compile editor write code', seo: 'Online Solidity IDE with compiler, security analysis, and deployment' },
  { id: 'dapp-builder', path: '/builder', label: 'dApp Builder', icon: '\u25A8', keywords: 'dapp builder frontend wysiwyg drag drop ui', seo: 'Drag-and-drop dApp frontend builder for smart contracts' },
  { id: 'quick-test', path: '/test', label: 'Quick Test', icon: '\u2713', keywords: 'test fuzz quick boundary smoke deploy bytecode', seo: 'Fuzz test Solidity contracts in-browser with opcode trace viewer' },
  { id: 'gas-estimator', path: '/gas', label: 'Gas', icon: '\u0394', keywords: 'gas estimate cost price', seo: 'Ethereum gas cost estimator for smart contract functions' },
  // ── Decode ──
  { id: 'calldata-decoder', path: '/calldata', label: 'Decode Calldata', icon: '\u2933', keywords: 'decode calldata transaction input data', seo: 'Decode Ethereum transaction calldata into readable function calls' },
  { id: 'calldata-encoder', path: '/encode', label: 'Encode Calldata', icon: '\u2934', keywords: 'encode calldata build transaction', seo: 'Encode Solidity function calls into raw calldata' },
  { id: 'event-decoder', path: '/events', label: 'Decode Events', icon: '\u2699', keywords: 'decode event log topics', seo: 'Decode Ethereum event logs from topics and data' },
  { id: 'error-decoder', path: '/errors', label: 'Decode Errors', icon: '\u26A0', keywords: 'decode error revert panic', seo: 'Decode Solidity revert reasons and panic codes' },
  // ── Inspect ──
  { id: 'explorer', path: '/explorer', label: 'Explorer', icon: '\u2315', keywords: 'explorer address transaction balance history account', seo: 'Explore Ethereum addresses and transactions with decoded calldata and events' },
  { id: 'abi-explorer', path: '/abi', label: 'ABI Explorer', icon: '\u2630', keywords: 'abi explorer contract functions events', seo: 'Explore smart contract ABIs with function selectors and proxy detection' },
  { id: 'bytecode-disassembler', path: '/bytecode', label: 'Bytecode', icon: '\u2328', keywords: 'bytecode disassemble opcode evm', seo: 'Disassemble EVM bytecode into readable opcodes' },
  { id: 'contract-diff', path: '/diff', label: 'Diff', icon: '\u2260', keywords: 'diff compare contract abi bytecode', seo: 'Compare smart contract ABIs and bytecodes side by side' },
  { id: 'storage-slot', path: '/storage', label: 'Storage Slots', icon: '\u25A6', keywords: 'storage slot mapping keccak256 calculate', seo: 'Calculate Solidity storage slot positions for mappings and arrays' },
  { id: 'selector-lookup', path: '/selectors', label: 'Selectors', icon: '\u2318', keywords: 'selector signature lookup 4byte function event', seo: 'Look up Solidity function and event selectors from 4byte signatures' },
  { id: 'interface-checker', path: '/interface', label: 'Interface Check', icon: '\u2611', keywords: 'interface check implement erc20 erc721 erc1155', seo: 'Check if a smart contract implements ERC20, ERC721, or ERC1155 correctly' },
  { id: 'proxy-inspector', path: '/proxy', label: 'Proxy Inspector', icon: '\u229B', keywords: 'proxy inspect eip1967 uups transparent beacon implementation', seo: 'Detect proxy patterns and find implementation addresses for upgradeable contracts' },
  // ── Utilities ──
  { id: 'unit-converter', path: '/convert', label: 'Convert', icon: '\u21C4', keywords: 'convert unit wei gwei ether hex decimal keccak address timestamp', seo: 'Convert between wei, gwei, ether, hex, decimal, and more' },
  { id: 'merkle-tree', path: '/merkle', label: 'Merkle Tree', icon: '\u2042', keywords: 'merkle tree root proof airdrop allowlist whitelist', seo: 'Generate Merkle tree roots and proofs for airdrops and allowlists' },
  { id: 'create2-calc', path: '/create2', label: 'CREATE2', icon: '\u2316', keywords: 'create2 deterministic address deploy factory salt', seo: 'Calculate CREATE2 deterministic contract deployment addresses' },
  { id: 'eip712-signer', path: '/eip712', label: 'EIP-712', icon: '\u2712', keywords: 'eip712 sign verify typed data signature permit', seo: 'Sign and verify EIP-712 typed data for permit and gasless transactions' },
  { id: 'multicall-builder', path: '/multicall', label: 'Multicall', icon: '\u2261', keywords: 'multicall batch aggregate calls multicall3', seo: 'Build batched Multicall3 calls for efficient contract reads' },
  { id: 'chain-reference', path: '/chains', label: 'Chains', icon: '\u26D3', keywords: 'chain id network rpc explorer reference', seo: 'EVM chain reference with chain IDs, RPC URLs, and block explorers' },
  { id: 'event-monitor', path: '/events-live', label: 'Event Monitor', icon: '\u2301', keywords: 'event monitor watch live stream contract logs', seo: 'Monitor smart contract events in real-time' },
  { id: 'safe-tx-builder', path: '/safe', label: 'Safe TX Builder', icon: '\u2610', keywords: 'safe gnosis multisig transaction builder batch', seo: 'Build Gnosis Safe transaction batches with encoded calldata' },
  { id: 'vanity-address', path: '/vanity', label: 'Vanity Address', icon: '\u2662', keywords: 'vanity address generate mine custom pattern', seo: 'Generate custom Ethereum vanity addresses in your browser' },
]

let activeTool = null
const toolModules = new Map()

// ── Routing ──────────────────────────────────────────────────
function getToolFromPath() {
  const path = window.location.pathname
  return TOOLS.find(t => t.path === path) || TOOLS[0]
}

async function navigateTo(tool, queryParams) {
  if (activeTool?.id === tool.id && !queryParams) return
  activeTool = tool

  // Update URL, title, and meta for SEO
  const url = queryParams ? `${tool.path}?${queryParams}` : tool.path
  history.pushState(null, '', url)
  document.title = `${tool.label} | anywei`
  const metaDesc = document.querySelector('meta[name="description"]')
  if (metaDesc && tool.seo) metaDesc.content = tool.seo

  // Update sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tool === tool.id)
  })

  // Load and render tool
  const area = document.getElementById('tool-area')
  area.innerHTML = '<div class="tool-loading">Loading...</div>'

  try {
    if (!toolModules.has(tool.id)) {
      const mod = await import(`./tools/${tool.id}.js`)
      toolModules.set(tool.id, mod)
    }
    const mod = toolModules.get(tool.id)
    area.innerHTML = ''
    // Pass query params to tool if available
    const params = Object.fromEntries(new URLSearchParams(window.location.search))
    mod.render(area, params)
  } catch (err) {
    area.innerHTML = `<div class="tool-error">Failed to load tool: ${err.message}</div>`
  }
}

// ── Command Palette ──────────────────────────────────────────
let paletteIndex = 0

function openPalette() {
  const palette = document.getElementById('cmd-palette')
  palette.classList.remove('hidden')
  const input = document.getElementById('cmd-input')
  input.value = ''
  input.focus()
  paletteIndex = 0
  renderPaletteResults('')
}

function closePalette() {
  document.getElementById('cmd-palette').classList.add('hidden')
}

function renderPaletteResults(query) {
  const container = document.getElementById('cmd-results')
  const q = query.toLowerCase().trim()
  let filtered = TOOLS
  if (q) {
    filtered = TOOLS.filter(t =>
      t.label.toLowerCase().includes(q) ||
      t.keywords.includes(q) ||
      t.id.includes(q) ||
      (t.seo && t.seo.toLowerCase().includes(q))
    )
  }

  // Auto-detect pasted data
  let suggestion = null
  if (q.startsWith('0x') || q.startsWith('0X')) {
    const len = q.length
    if (len === 42) suggestion = { tool: TOOLS.find(t => t.id === 'explorer'), hint: 'Look up this address' }
    else if (len === 10) suggestion = { tool: TOOLS.find(t => t.id === 'selector-lookup'), hint: 'Look up this selector' }
    else if (len === 66) suggestion = { tool: TOOLS.find(t => t.id === 'explorer'), hint: 'Look up this transaction' }
    else if (len > 10) suggestion = { tool: TOOLS.find(t => t.id === 'calldata-decoder'), hint: 'Decode this calldata' }
  } else if (q.startsWith('[') || q.startsWith('{')) {
    suggestion = { tool: TOOLS.find(t => t.id === 'abi-explorer'), hint: 'Explore this ABI' }
  } else if (q.includes('(') && q.includes(')')) {
    suggestion = { tool: TOOLS.find(t => t.id === 'selector-lookup'), hint: 'Compute selector' }
  }

  container.innerHTML = ''
  let idx = 0

  if (suggestion) {
    const item = document.createElement('div')
    item.className = 'cmd-item cmd-suggestion'
    item.dataset.idx = idx++
    item.innerHTML = `<span class="cmd-icon">${suggestion.tool.icon}</span><span class="cmd-label">${suggestion.hint}</span>`
    item.addEventListener('click', () => { closePalette(); navigateTo(suggestion.tool) })
    container.appendChild(item)
  }

  for (let i = 0; i < filtered.length; i++) {
    const tool = filtered[i]
    const item = document.createElement('div')
    item.className = 'cmd-item'
    item.dataset.idx = idx
    if (activeTool?.id === tool.id) item.classList.add('cmd-active')
    // Show number hint for first 9
    const numHint = idx < 9 ? `<span class="cmd-num">${idx + 1}</span>` : ''
    item.innerHTML = `${numHint}<span class="cmd-icon">${tool.icon}</span><span class="cmd-label">${tool.label}</span><span class="cmd-desc">${tool.seo || ''}</span>`
    item.addEventListener('click', () => { closePalette(); navigateTo(tool) })
    container.appendChild(item)
    idx++
  }

  // Highlight first item
  paletteIndex = 0
  updatePaletteHighlight()
}

function updatePaletteHighlight() {
  const items = document.querySelectorAll('.cmd-item')
  items.forEach((el, i) => el.classList.toggle('cmd-highlighted', i === paletteIndex))
  const highlighted = items[paletteIndex]
  if (highlighted) highlighted.scrollIntoView({ block: 'nearest' })
}

function selectPaletteItem() {
  const items = document.querySelectorAll('.cmd-item')
  if (items[paletteIndex]) items[paletteIndex].click()
}

// ── Init ─────────────────────────────────────────────────────
function init() {
  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const tool = TOOLS.find(t => t.id === link.dataset.tool)
      if (tool) navigateTo(tool)
    })
  })

  // Theme toggle
  const savedTheme = localStorage.getItem('anywei_theme') || 'dark'
  if (savedTheme === 'light') document.documentElement.classList.add('light-theme')
  // Mobile search button opens command palette
  document.getElementById('mobile-search').addEventListener('click', openPalette)

  const themeBtn = document.getElementById('theme-toggle')
  themeBtn.textContent = savedTheme === 'light' ? '\u2600' : '\u263D'
  themeBtn.addEventListener('click', () => {
    const isLight = document.documentElement.classList.toggle('light-theme')
    localStorage.setItem('anywei_theme', isLight ? 'light' : 'dark')
    themeBtn.textContent = isLight ? '\u2600' : '\u263D'
  })

  // Live gas ticker
  async function updateGasTicker() {
    try {
      const res = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }) })
      const data = await res.json()
      if (data.result) {
        const gwei = (Number(BigInt(data.result)) / 1e9).toFixed(2)
        document.getElementById('gas-ticker').innerHTML = `<span class="gas-ticker-label">Gas:</span> <span class="gas-ticker-value">${gwei} gwei</span>`
      }
    } catch {}
  }
  updateGasTicker()
  setInterval(updateGasTicker, 15000)

  // Command palette
  document.getElementById('cmd-palette').querySelector('.cmd-overlay').addEventListener('click', closePalette)
  document.getElementById('cmd-input').addEventListener('input', (e) => renderPaletteResults(e.target.value))
  document.getElementById('cmd-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePalette()
    if (e.key === 'Enter') { e.preventDefault(); selectPaletteItem() }
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, document.querySelectorAll('.cmd-item').length - 1); updatePaletteHighlight() }
    if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); updatePaletteHighlight() }
    // Number keys 1-9 select items directly
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey) {
      const idx = parseInt(e.key) - 1
      const items = document.querySelectorAll('.cmd-item')
      if (items[idx]) { e.preventDefault(); items[idx].click() }
    }
  })

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.closest('.cm-editor')

    // Ctrl+K or Cmd+K opens palette
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      openPalette()
      return
    }

    // "/" opens palette when not typing
    if (e.key === '/' && !isTyping) {
      e.preventDefault()
      openPalette()
      return
    }

    // Sidebar keyboard navigation:
    // Left arrow = enter sidebar nav mode (highlights current tool in sidebar)
    // Up/Down = move between tools while in sidebar mode
    // Right arrow or Enter = confirm selection and focus tool
    // Escape = exit sidebar mode
    const paletteOpen = !document.getElementById('cmd-palette').classList.contains('hidden')
    const sidebarActive = document.querySelector('.sidebar.keyboard-nav')

    if (!paletteOpen && e.key === 'ArrowLeft' && !isTyping && !sidebarActive) {
      e.preventDefault()
      document.getElementById('sidebar').classList.add('keyboard-nav')
      const active = document.querySelector('.nav-item.active')
      if (active) active.focus()
      return
    }

    if (sidebarActive) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const currentIdx = TOOLS.findIndex(t => t.id === activeTool?.id)
        let nextIdx
        if (e.key === 'ArrowDown') nextIdx = Math.min(currentIdx + 1, TOOLS.length - 1)
        else nextIdx = Math.max(currentIdx - 1, 0)
        if (nextIdx !== currentIdx) navigateTo(TOOLS[nextIdx])
        // Keep sidebar in nav mode and focus the new item
        setTimeout(() => {
          document.getElementById('sidebar').classList.add('keyboard-nav')
          const active = document.querySelector('.nav-item.active')
          if (active) active.focus()
        }, 10)
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        document.getElementById('sidebar').classList.remove('keyboard-nav')
        document.getElementById('tool-area').focus()
      }
    }
  })

  // Browser back/forward
  window.addEventListener('popstate', () => {
    navigateTo(getToolFromPath())
  })

  // Load background ASCII watermark
  fetch('/ascii.txt').then(r => r.text()).then(t => { document.getElementById('bg-eth').textContent = t }).catch(() => {})

  // Initial load
  navigateTo(getToolFromPath())
}

document.addEventListener('DOMContentLoaded', init)
