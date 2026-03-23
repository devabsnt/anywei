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

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Chain Reference</h2>
      <p class="tool-desc">Quick reference for EVM chain IDs, RPCs, and block explorers.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <input type="text" id="chain-search" class="mono-input" placeholder="Search by name, chain ID, or symbol..." spellcheck="false">
      </div>
      <div class="mode-tabs" style="margin-bottom:12px">
        <button class="mode-btn active" data-filter="all">All</button>
        <button class="mode-btn" data-filter="mainnet">Mainnets</button>
        <button class="mode-btn" data-filter="testnet">Testnets</button>
      </div>
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

  searchInput.addEventListener('input', renderList)
  renderList()

  function renderList() {
    const q = searchInput.value.toLowerCase().trim()
    const list = document.getElementById('chain-list')

    let filtered = CHAINS
    if (filter !== 'all') filtered = filtered.filter(c => c.type === filter)
    if (q) filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(q) ||
      String(c.id).includes(q) ||
      c.symbol.toLowerCase().includes(q)
    )

    list.innerHTML = filtered.map(c => `
      <div class="chain-card">
        <div class="chain-card-header">
          <span class="chain-name">${esc(c.name)}</span>
          <span class="chain-id">${c.id}</span>
          <span class="badge ${c.type === 'testnet' ? 'view-badge' : 'payable-badge'}">${c.type}</span>
        </div>
        <div class="chain-details">
          <div class="chain-row"><span class="text-dim">Chain ID</span><span class="mono">${c.id} <span class="text-dim">(0x${c.id.toString(16)})</span></span></div>
          <div class="chain-row"><span class="text-dim">Currency</span><span class="mono">${esc(c.symbol)}</span></div>
          <div class="chain-row"><span class="text-dim">RPC</span><span class="mono chain-copyable" data-copy="${esc(c.rpc)}">${esc(c.rpc)}</span></div>
          <div class="chain-row"><span class="text-dim">Explorer</span><a href="${c.explorer}" target="_blank" class="text-blue">${esc(c.explorer)}</a></div>
        </div>
      </div>
    `).join('')

    // Copy on click for RPC URLs
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
  }
}
