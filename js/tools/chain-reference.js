import { esc, copyBtn } from '../shared/formatters.js'

const CHAINS = [
  { id: 1, name: 'Ethereum Mainnet', symbol: 'ETH', explorer: 'https://etherscan.io', rpc: 'https://eth.llamarpc.com', type: 'mainnet' },
  { id: 11155111, name: 'Sepolia', symbol: 'ETH', explorer: 'https://sepolia.etherscan.io', rpc: 'https://rpc.sepolia.org', type: 'testnet' },
  { id: 17000, name: 'Holesky', symbol: 'ETH', explorer: 'https://holesky.etherscan.io', rpc: 'https://rpc.holesky.ethpandaops.io', type: 'testnet' },
  { id: 137, name: 'Polygon', symbol: 'MATIC', explorer: 'https://polygonscan.com', rpc: 'https://polygon-rpc.com', type: 'mainnet' },
  { id: 80002, name: 'Polygon Amoy', symbol: 'MATIC', explorer: 'https://amoy.polygonscan.com', rpc: 'https://rpc-amoy.polygon.technology', type: 'testnet' },
  { id: 42161, name: 'Arbitrum One', symbol: 'ETH', explorer: 'https://arbiscan.io', rpc: 'https://arb1.arbitrum.io/rpc', type: 'mainnet' },
  { id: 421614, name: 'Arbitrum Sepolia', symbol: 'ETH', explorer: 'https://sepolia.arbiscan.io', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', type: 'testnet' },
  { id: 10, name: 'Optimism', symbol: 'ETH', explorer: 'https://optimistic.etherscan.io', rpc: 'https://mainnet.optimism.io', type: 'mainnet' },
  { id: 11155420, name: 'OP Sepolia', symbol: 'ETH', explorer: 'https://sepolia-optimism.etherscan.io', rpc: 'https://sepolia.optimism.io', type: 'testnet' },
  { id: 8453, name: 'Base', symbol: 'ETH', explorer: 'https://basescan.org', rpc: 'https://mainnet.base.org', type: 'mainnet' },
  { id: 84532, name: 'Base Sepolia', symbol: 'ETH', explorer: 'https://sepolia.basescan.org', rpc: 'https://sepolia.base.org', type: 'testnet' },
  { id: 56, name: 'BNB Smart Chain', symbol: 'BNB', explorer: 'https://bscscan.com', rpc: 'https://bsc-dataseed.binance.org', type: 'mainnet' },
  { id: 43114, name: 'Avalanche C-Chain', symbol: 'AVAX', explorer: 'https://snowtrace.io', rpc: 'https://api.avax.network/ext/bc/C/rpc', type: 'mainnet' },
  { id: 250, name: 'Fantom', symbol: 'FTM', explorer: 'https://ftmscan.com', rpc: 'https://rpc.ftm.tools', type: 'mainnet' },
  { id: 324, name: 'zkSync Era', symbol: 'ETH', explorer: 'https://explorer.zksync.io', rpc: 'https://mainnet.era.zksync.io', type: 'mainnet' },
  { id: 59144, name: 'Linea', symbol: 'ETH', explorer: 'https://lineascan.build', rpc: 'https://rpc.linea.build', type: 'mainnet' },
  { id: 534352, name: 'Scroll', symbol: 'ETH', explorer: 'https://scrollscan.com', rpc: 'https://rpc.scroll.io', type: 'mainnet' },
  { id: 5000, name: 'Mantle', symbol: 'MNT', explorer: 'https://mantlescan.xyz', rpc: 'https://rpc.mantle.xyz', type: 'mainnet' },
  { id: 81457, name: 'Blast', symbol: 'ETH', explorer: 'https://blastscan.io', rpc: 'https://rpc.blast.io', type: 'mainnet' },
  { id: 7777777, name: 'Zora', symbol: 'ETH', explorer: 'https://explorer.zora.energy', rpc: 'https://rpc.zora.energy', type: 'mainnet' },
  { id: 100, name: 'Gnosis', symbol: 'xDAI', explorer: 'https://gnosisscan.io', rpc: 'https://rpc.gnosischain.com', type: 'mainnet' },
  { id: 1101, name: 'Polygon zkEVM', symbol: 'ETH', explorer: 'https://zkevm.polygonscan.com', rpc: 'https://zkevm-rpc.com', type: 'mainnet' },
]

const CUSTOM_CHAINS_KEY = 'anywei_custom_chains'

function loadCustomChains() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CHAINS_KEY)) || [] } catch { return [] }
}
function saveCustomChains(chains) {
  localStorage.setItem(CUSTOM_CHAINS_KEY, JSON.stringify(chains))
}

export function render(container) {
  let customChains = loadCustomChains()

  container.innerHTML = `
    <div class="tool-header">
      <h2>Chain Reference</h2>
      <p class="tool-desc">Quick reference for EVM chain IDs, RPCs, and block explorers.</p>
    </div>
    <div class="tool-body">
      <div class="input-row" style="gap:8px;align-items:flex-end">
        <div class="input-group" style="flex:1">
          <input type="text" id="chain-search" class="mono-input" placeholder="Search by name, chain ID, or symbol..." spellcheck="false">
        </div>
        <button id="chain-add-btn" class="btn">+ Add Chain</button>
      </div>
      <div class="mode-tabs" style="margin-bottom:12px">
        <button class="mode-btn active" data-filter="all">All</button>
        <button class="mode-btn" data-filter="mainnet">Mainnets</button>
        <button class="mode-btn" data-filter="testnet">Testnets</button>
        <button class="mode-btn" data-filter="custom">Custom</button>
      </div>
      <div id="chain-add-form" class="hidden"></div>
      <div id="chain-list"></div>
    </div>
  `

  let filter = 'all'
  const searchInput = document.getElementById('chain-search')

  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      filter = btn.dataset.filter
      renderList()
    })
  })

  document.getElementById('chain-add-btn').addEventListener('click', showAddForm)
  searchInput.addEventListener('input', renderList)
  renderList()

  function showAddForm() {
    const form = document.getElementById('chain-add-form')
    form.classList.remove('hidden')
    form.innerHTML = `
      <div class="chain-card" style="border-color:var(--accent)">
        <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px">Add Custom Chain</div>
        <div class="input-group"><label>Chain name</label><input type="text" id="cc-name" class="mono-input" placeholder="My Chain" spellcheck="false"></div>
        <div class="input-row" style="gap:8px">
          <div class="input-group flex-1"><label>Chain ID</label><input type="text" id="cc-id" class="mono-input" placeholder="12345" spellcheck="false"></div>
          <div class="input-group flex-1"><label>Currency symbol</label><input type="text" id="cc-symbol" class="mono-input" placeholder="ETH" spellcheck="false"></div>
        </div>
        <div class="input-group"><label>RPC URL</label><input type="text" id="cc-rpc" class="mono-input" placeholder="https://..." spellcheck="false"></div>
        <div class="input-group"><label>Block explorer URL</label><input type="text" id="cc-explorer" class="mono-input" placeholder="https://..." spellcheck="false"></div>
        <div class="input-row" style="gap:8px">
          <div class="input-group" style="width:120px"><label>Type</label><select id="cc-type" class="mono-input"><option value="mainnet">Mainnet</option><option value="testnet" selected>Testnet</option></select></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="cc-save" class="btn btn-primary">Save Chain</button>
          <button id="cc-cancel" class="btn">Cancel</button>
        </div>
      </div>
    `
    document.getElementById('cc-save').addEventListener('click', () => {
      const name = document.getElementById('cc-name').value.trim()
      const id = parseInt(document.getElementById('cc-id').value.trim())
      const symbol = document.getElementById('cc-symbol').value.trim() || 'ETH'
      const rpc = document.getElementById('cc-rpc').value.trim()
      const explorer = document.getElementById('cc-explorer').value.trim()
      const type = document.getElementById('cc-type').value
      if (!name || !id) return
      customChains.push({ id, name, symbol, rpc, explorer, type, custom: true })
      saveCustomChains(customChains)
      form.classList.add('hidden')
      form.innerHTML = ''
      renderList()
    })
    document.getElementById('cc-cancel').addEventListener('click', () => { form.classList.add('hidden'); form.innerHTML = '' })
    document.getElementById('cc-name').focus()
  }

  function renderList() {
    const q = searchInput.value.toLowerCase().trim()
    const list = document.getElementById('chain-list')

    let allChains = [...CHAINS, ...customChains]
    let filtered = allChains
    if (filter === 'custom') filtered = customChains
    else if (filter !== 'all') filtered = filtered.filter(c => c.type === filter)
    if (q) filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(q) ||
      String(c.id).includes(q) ||
      c.symbol.toLowerCase().includes(q)
    )

    list.innerHTML = filtered.map(c => `
      <div class="chain-card ${c.custom ? 'chain-card-custom' : ''}">
        <div class="chain-card-header">
          <span class="chain-name">${esc(c.name)}</span>
          <span class="chain-id">${c.id}</span>
          <span class="badge ${c.type === 'testnet' ? 'view-badge' : 'payable-badge'}">${c.type}</span>
          ${c.custom ? '<span class="badge" style="border-color:var(--accent);color:var(--accent)">custom</span>' : ''}
          ${c.custom ? `<button class="chain-delete" data-id="${c.id}" title="Remove">&times;</button>` : ''}
        </div>
        <div class="chain-details">
          <div class="chain-row"><span class="text-dim">Chain ID</span><span class="mono">${c.id} <span class="text-dim">(0x${c.id.toString(16)})</span></span></div>
          <div class="chain-row"><span class="text-dim">Currency</span><span class="mono">${esc(c.symbol)}</span></div>
          <div class="chain-row"><span class="text-dim">RPC</span><span class="mono chain-copyable" data-copy="${esc(c.rpc)}">${esc(c.rpc || '—')}</span></div>
          <div class="chain-row"><span class="text-dim">Explorer</span>${c.explorer ? `<a href="${c.explorer}" target="_blank" class="text-blue">${esc(c.explorer)}</a>` : '<span class="text-dim">—</span>'}</div>
        </div>
      </div>
    `).join('')

    // Copy on click
    list.querySelectorAll('.chain-copyable').forEach(el => {
      el.style.cursor = 'pointer'
      el.title = 'Click to copy'
      el.addEventListener('click', () => {
        navigator.clipboard.writeText(el.dataset.copy)
        const orig = el.textContent
        el.textContent = 'Copied!'
        setTimeout(() => el.textContent = orig, 1000)
      })
    })

    // Delete custom chains
    list.querySelectorAll('.chain-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id)
        customChains = customChains.filter(c => c.id !== id)
        saveCustomChains(customChains)
        renderList()
      })
    })
  }
}
