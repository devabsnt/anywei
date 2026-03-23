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
function openPalette() {
  const palette = document.getElementById('cmd-palette')
  palette.classList.remove('hidden')
  const input = document.getElementById('cmd-input')
  input.value = ''
  input.focus()
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
      t.id.includes(q)
    )
  }

  // Auto-detect pasted data
  let suggestion = null
  if (q.startsWith('0x') || q.startsWith('0X')) {
    const len = q.length
    if (len === 42) suggestion = { tool: TOOLS.find(t => t.id === 'abi-explorer'), hint: 'Explore this address' }
    else if (len === 10) suggestion = { tool: TOOLS.find(t => t.id === 'selector-lookup'), hint: 'Look up this selector' }
    else if (len === 66) suggestion = { tool: TOOLS.find(t => t.id === 'event-decoder'), hint: 'Decode this topic/hash' }
    else if (len > 10) suggestion = { tool: TOOLS.find(t => t.id === 'calldata-decoder'), hint: 'Decode this calldata' }
  } else if (q.startsWith('[') || q.startsWith('{')) {
    suggestion = { tool: TOOLS.find(t => t.id === 'abi-explorer'), hint: 'Explore this ABI' }
  } else if (q.includes('(') && q.includes(')')) {
    suggestion = { tool: TOOLS.find(t => t.id === 'selector-lookup'), hint: 'Compute selector' }
  }

  container.innerHTML = ''

  if (suggestion) {
    const item = document.createElement('div')
    item.className = 'cmd-item cmd-suggestion'
    item.innerHTML = `<span class="cmd-icon">${suggestion.tool.icon}</span> <span>${suggestion.hint}</span>`
    item.addEventListener('click', () => {
      closePalette()
      navigateTo(suggestion.tool)
    })
    container.appendChild(item)
  }

  for (const tool of filtered) {
    const item = document.createElement('div')
    item.className = 'cmd-item'
    if (activeTool?.id === tool.id) item.classList.add('cmd-active')
    item.innerHTML = `<span class="cmd-icon">${tool.icon}</span> <span>${tool.label}</span>`
    item.addEventListener('click', () => {
      closePalette()
      navigateTo(tool)
    })
    container.appendChild(item)
  }
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
        const gwei = (Number(BigInt(data.result)) / 1e9).toFixed(1)
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
    if (e.key === 'Enter') {
      const first = document.querySelector('.cmd-item')
      if (first) first.click()
    }
  })

  // Global keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      openPalette()
    }
  })

  // Browser back/forward
  window.addEventListener('popstate', () => {
    navigateTo(getToolFromPath())
  })

  // Initial load
  navigateTo(getToolFromPath())
}

document.addEventListener('DOMContentLoaded', init)
