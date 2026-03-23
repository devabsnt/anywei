import { fetchAbi } from '../shared/abi-cache.js'
import { readStorageSlot, fetchBytecode } from '../shared/etherscan.js'
import { esc, etherscanLink } from '../shared/formatters.js'

const PROXY_SLOTS = {
  'EIP-1967 Implementation': '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  'EIP-1967 Admin': '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  'EIP-1967 Beacon': '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  'EIP-1822 (UUPS)': '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
  'OpenZeppelin (old)': '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
}

const ZERO = '0x' + '0'.repeat(64)
const ZERO_ADDR = '0x' + '0'.repeat(40)

// Minimal proxy (EIP-1167) bytecode pattern
const MINIMAL_PROXY_PREFIX = '363d3d373d3d3d363d73'
const MINIMAL_PROXY_SUFFIX = '5af43d82803e903d91602b57fd5bf3'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Proxy Inspector</h2>
      <p class="tool-desc">Paste any contract address to detect its proxy pattern and inspect implementation details.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Contract address</label>
        <input type="text" id="pi-addr" class="mono-input" placeholder="0x..." spellcheck="false">
      </div>
      <div id="pi-output" class="output-area"></div>
    </div>
  `

  const addrInput = document.getElementById('pi-addr')
  const output = document.getElementById('pi-output')

  addrInput.addEventListener('change', inspect)
  addrInput.addEventListener('paste', () => setTimeout(inspect, 50))

  async function inspect() {
    const addr = addrInput.value.trim()
    if (!addr || addr.length !== 42) return
    output.innerHTML = '<div class="loading">Inspecting proxy pattern...</div>'

    try {
      // Check all known proxy storage slots in parallel
      const slotResults = await Promise.all(
        Object.entries(PROXY_SLOTS).map(async ([label, slot]) => {
          const val = await readStorageSlot(addr, slot)
          const addrFromSlot = val && val !== ZERO ? '0x' + val.slice(26) : null
          return { label, slot, address: addrFromSlot && addrFromSlot !== ZERO_ADDR ? addrFromSlot : null }
        })
      )

      // Check for minimal proxy (EIP-1167)
      const bytecode = await fetchBytecode(addr)
      const bcHex = bytecode?.slice(2)?.toLowerCase() || ''
      let minimalProxyImpl = null
      if (bcHex.startsWith(MINIMAL_PROXY_PREFIX)) {
        minimalProxyImpl = '0x' + bcHex.slice(MINIMAL_PROXY_PREFIX.length, MINIMAL_PROXY_PREFIX.length + 40)
      }

      // Check Etherscan proxy info
      let etherscanInfo = null
      try {
        const r = await fetchAbi(addr)
        etherscanInfo = { contractName: r.contractName, isProxy: r.isProxy, implementation: r.implementation }
      } catch {}

      // Determine proxy type
      const detected = slotResults.filter(s => s.address)
      const implSlot = detected.find(s => s.label.includes('Implementation'))
      const adminSlot = detected.find(s => s.label.includes('Admin'))
      const beaconSlot = detected.find(s => s.label.includes('Beacon'))

      let proxyType = 'Not a proxy'
      let confidence = 'low'

      if (minimalProxyImpl) {
        proxyType = 'Minimal Proxy (EIP-1167 Clone)'
        confidence = 'high'
      } else if (implSlot && beaconSlot) {
        proxyType = 'Beacon Proxy'
        confidence = 'high'
      } else if (implSlot && adminSlot) {
        proxyType = 'Transparent Proxy (EIP-1967)'
        confidence = 'high'
      } else if (implSlot) {
        proxyType = 'UUPS Proxy (EIP-1967)'
        confidence = 'high'
      } else if (detected.find(s => s.label.includes('UUPS'))) {
        proxyType = 'UUPS Proxy (EIP-1822)'
        confidence = 'medium'
      } else if (detected.find(s => s.label.includes('OpenZeppelin'))) {
        proxyType = 'OpenZeppelin Proxy (legacy)'
        confidence = 'medium'
      } else if (etherscanInfo?.isProxy) {
        proxyType = 'Proxy (detected by Etherscan)'
        confidence = 'medium'
      } else if (bcHex.length < 200 && bcHex.includes('363d3d37')) {
        proxyType = 'Possible Minimal Proxy variant'
        confidence = 'low'
      }

      const isProxy = proxyType !== 'Not a proxy'
      const implAddr = minimalProxyImpl || implSlot?.address || etherscanInfo?.implementation

      let html = `<div class="result-card">
        <div style="margin-bottom:10px">
          <span class="${isProxy ? 'warning' : 'success'}" style="font-weight:700;font-size:14px">${esc(proxyType)}</span>
          ${isProxy ? `<span class="text-dim" style="margin-left:8px">confidence: ${confidence}</span>` : ''}
        </div>
        <table class="params-table">
          <tbody>
            <tr><td class="text-dim">Address</td><td><a href="${etherscanLink(addr)}" target="_blank" class="text-blue mono">${esc(addr)}</a></td></tr>
            ${etherscanInfo?.contractName ? `<tr><td class="text-dim">Contract name</td><td>${esc(etherscanInfo.contractName)}</td></tr>` : ''}
            ${implAddr ? `<tr><td class="text-dim">Implementation</td><td><a href="${etherscanLink(implAddr)}" target="_blank" class="text-blue mono">${esc(implAddr)}</a></td></tr>` : ''}
            ${adminSlot?.address ? `<tr><td class="text-dim">Admin</td><td class="mono">${esc(adminSlot.address)}</td></tr>` : ''}
            ${beaconSlot?.address ? `<tr><td class="text-dim">Beacon</td><td class="mono">${esc(beaconSlot.address)}</td></tr>` : ''}
            <tr><td class="text-dim">Bytecode size</td><td class="mono">${((bcHex.length || 0) / 2).toLocaleString()} bytes</td></tr>
          </tbody>
        </table>`

      // Show all checked slots
      if (isProxy) {
        html += '<div style="margin-top:12px"><span class="text-dim" style="font-size:11px">Storage slots checked:</span></div>'
        for (const s of slotResults) {
          html += `<div style="font-size:11px;padding:2px 0;display:flex;gap:8px">
            <span class="${s.address ? 'success' : 'text-dim'}">${s.address ? '&#10003;' : '&#8212;'}</span>
            <span class="text-dim">${esc(s.label)}</span>
            ${s.address ? `<span class="mono text-blue">${esc(s.address)}</span>` : ''}
          </div>`
        }
      }

      html += '</div>'
      output.innerHTML = html
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }
}
