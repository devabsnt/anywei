import { toFunctionSelector } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { esc } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Interface Checker</h2>
      <p class="tool-desc">Check if a contract correctly implements an interface. Paste two ABIs or addresses.</p>
    </div>
    <div class="tool-body">
      <div class="diff-inputs">
        <div class="input-group flex-1">
          <label>Contract (implementation)</label>
          <textarea id="ic-contract" class="mono-input" rows="3" placeholder="Contract address or ABI JSON" spellcheck="false"></textarea>
          <div id="ic-contract-status" class="status-line"></div>
        </div>
        <div class="input-group flex-1">
          <label>Interface (expected)</label>
          <textarea id="ic-interface" class="mono-input" rows="3" placeholder="Interface address, ABI, or standard (ERC20, ERC721...)" spellcheck="false"></textarea>
          <div id="ic-interface-status" class="status-line"></div>
        </div>
      </div>
      <button id="ic-check" class="btn btn-primary">Check Implementation</button>
      <div id="ic-output" class="output-area"></div>
    </div>
  `

  const STANDARDS = {
    'ERC20': [
      { name: 'totalSupply', inputs: [], outputs: ['uint256'], mutability: 'view' },
      { name: 'balanceOf', inputs: ['address'], outputs: ['uint256'], mutability: 'view' },
      { name: 'transfer', inputs: ['address', 'uint256'], outputs: ['bool'], mutability: 'nonpayable' },
      { name: 'transferFrom', inputs: ['address', 'address', 'uint256'], outputs: ['bool'], mutability: 'nonpayable' },
      { name: 'approve', inputs: ['address', 'uint256'], outputs: ['bool'], mutability: 'nonpayable' },
      { name: 'allowance', inputs: ['address', 'address'], outputs: ['uint256'], mutability: 'view' },
    ],
    'ERC721': [
      { name: 'balanceOf', inputs: ['address'], outputs: ['uint256'], mutability: 'view' },
      { name: 'ownerOf', inputs: ['uint256'], outputs: ['address'], mutability: 'view' },
      { name: 'safeTransferFrom', inputs: ['address', 'address', 'uint256'], outputs: [], mutability: 'nonpayable' },
      { name: 'transferFrom', inputs: ['address', 'address', 'uint256'], outputs: [], mutability: 'nonpayable' },
      { name: 'approve', inputs: ['address', 'uint256'], outputs: [], mutability: 'nonpayable' },
      { name: 'setApprovalForAll', inputs: ['address', 'bool'], outputs: [], mutability: 'nonpayable' },
      { name: 'getApproved', inputs: ['uint256'], outputs: ['address'], mutability: 'view' },
      { name: 'isApprovedForAll', inputs: ['address', 'address'], outputs: ['bool'], mutability: 'view' },
    ],
    'ERC1155': [
      { name: 'balanceOf', inputs: ['address', 'uint256'], outputs: ['uint256'], mutability: 'view' },
      { name: 'balanceOfBatch', inputs: ['address[]', 'uint256[]'], outputs: ['uint256[]'], mutability: 'view' },
      { name: 'setApprovalForAll', inputs: ['address', 'bool'], outputs: [], mutability: 'nonpayable' },
      { name: 'isApprovedForAll', inputs: ['address', 'address'], outputs: ['bool'], mutability: 'view' },
      { name: 'safeTransferFrom', inputs: ['address', 'address', 'uint256', 'uint256', 'bytes'], outputs: [], mutability: 'nonpayable' },
      { name: 'safeBatchTransferFrom', inputs: ['address', 'address', 'uint256[]', 'uint256[]', 'bytes'], outputs: [], mutability: 'nonpayable' },
    ],
  }

  document.getElementById('ic-check').addEventListener('click', check)

  async function resolveAbi(raw, statusEl) {
    raw = raw.trim()
    if (!raw) return null
    // Check for standard name
    const upper = raw.toUpperCase()
    if (STANDARDS[upper] || STANDARDS[raw]) {
      const std = STANDARDS[upper] || STANDARDS[raw]
      statusEl.innerHTML = `<span class="success">${raw} standard (${std.length} functions)</span>`
      return std.map(f => ({ type: 'function', name: f.name, inputs: f.inputs.map(t => ({ type: t })), outputs: f.outputs.map(t => ({ type: t })), stateMutability: f.mutability }))
    }
    if (raw.startsWith('0x') && raw.length === 42) {
      statusEl.innerHTML = '<span class="loading">Fetching...</span>'
      const r = await fetchAbi(raw)
      statusEl.innerHTML = r.abi ? `<span class="success">${r.contractName || 'Loaded'} (${r.abi.filter(e => e.type === 'function').length} fn)</span>` : '<span class="error">Not verified</span>'
      return r.abi
    }
    try {
      const p = JSON.parse(raw)
      const abi = Array.isArray(p) ? p : p.abi
      statusEl.innerHTML = `<span class="success">${abi.filter(e => e.type === 'function').length} functions</span>`
      return abi
    } catch {
      statusEl.innerHTML = '<span class="error">Invalid</span>'
      return null
    }
  }

  async function check() {
    const output = document.getElementById('ic-output')
    const contractAbi = await resolveAbi(document.getElementById('ic-contract').value, document.getElementById('ic-contract-status'))
    const ifaceAbi = await resolveAbi(document.getElementById('ic-interface').value, document.getElementById('ic-interface-status'))

    if (!contractAbi || !ifaceAbi) { output.innerHTML = '<div class="result-card error">Need both a contract and an interface to check.</div>'; return }

    const contractFns = new Map()
    for (const fn of contractAbi.filter(e => e.type === 'function')) {
      const sig = `${fn.name}(${(fn.inputs || []).map(i => i.type).join(',')})`
      contractFns.set(sig, fn)
    }

    const results = []
    let passCount = 0, failCount = 0

    for (const fn of ifaceAbi.filter(e => e.type === 'function')) {
      const sig = `${fn.name}(${(fn.inputs || []).map(i => i.type).join(',')})`
      const impl = contractFns.get(sig)

      if (!impl) {
        results.push({ sig, status: 'missing', message: 'Function not found in contract' })
        failCount++
        continue
      }

      // Check return types
      const expectedOutputs = (fn.outputs || []).map(o => o.type).join(',')
      const actualOutputs = (impl.outputs || []).map(o => o.type).join(',')
      if (expectedOutputs && actualOutputs !== expectedOutputs) {
        results.push({ sig, status: 'wrong', message: `Wrong return type: expected (${expectedOutputs}), got (${actualOutputs})` })
        failCount++
        continue
      }

      results.push({ sig, status: 'ok', message: 'Implemented correctly' })
      passCount++
    }

    // Check events too
    const contractEvents = new Set(contractAbi.filter(e => e.type === 'event').map(e => e.name))
    for (const evt of ifaceAbi.filter(e => e.type === 'event')) {
      if (!contractEvents.has(evt.name)) {
        results.push({ sig: `event ${evt.name}`, status: 'missing', message: 'Event not found' })
        failCount++
      } else {
        results.push({ sig: `event ${evt.name}`, status: 'ok', message: 'Present' })
        passCount++
      }
    }

    const total = passCount + failCount
    const allPass = failCount === 0

    output.innerHTML = `<div class="result-card">
      <div style="margin-bottom:10px">
        <span class="${allPass ? 'success' : 'error'}" style="font-weight:700;font-size:14px">${allPass ? 'FULLY IMPLEMENTS' : 'INCOMPLETE IMPLEMENTATION'}</span>
        <span class="text-dim" style="margin-left:8px">${passCount}/${total} checks passed</span>
      </div>
      <table class="params-table">
        <thead><tr><th></th><th>Signature</th><th>Status</th></tr></thead>
        <tbody>
          ${results.map(r => `<tr>
            <td>${r.status === 'ok' ? '<span class="success">&#10003;</span>' : '<span class="error">&#10007;</span>'}</td>
            <td class="mono" style="font-size:11px">${esc(r.sig)}</td>
            <td class="${r.status === 'ok' ? 'success' : 'error'}" style="font-size:11px">${esc(r.message)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`
  }
}
