import { decodeAbiParameters, parseAbi, decodeErrorResult } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { lookupSelector } from '../shared/etherscan.js'
import { esc, ensure0x, strip0x } from '../shared/formatters.js'

const PANIC_CODES = {
  0x00: 'Generic compiler panic',
  0x01: 'Assert condition failed',
  0x11: 'Arithmetic overflow/underflow',
  0x12: 'Division or modulo by zero',
  0x21: 'Conversion to invalid enum value',
  0x22: 'Access to incorrectly encoded storage byte array',
  0x31: 'Pop on empty array',
  0x32: 'Array index out of bounds',
  0x41: 'Too much memory allocated',
  0x51: 'Called zero-initialized function pointer',
}

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Error / Revert Decoder</h2>
      <p class="tool-desc">Paste revert data from a failed transaction to decode the error.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Revert data (hex)</label>
        <textarea id="err-input" class="mono-input" rows="3" placeholder="0x08c379a0..." spellcheck="false"></textarea>
      </div>
      <div class="input-group">
        <label>ABI <span class="text-dim">(for custom errors)</span></label>
        <input type="text" id="err-abi" class="mono-input" placeholder="Contract address or ABI JSON" spellcheck="false">
      </div>
      <div id="err-output" class="output-area"></div>
    </div>
  `

  const input = document.getElementById('err-input')
  const abiInput = document.getElementById('err-abi')
  const output = document.getElementById('err-output')
  let currentAbi = null

  input.addEventListener('input', decode)
  input.addEventListener('paste', () => setTimeout(decode, 50))
  abiInput.addEventListener('change', async () => {
    const raw = abiInput.value.trim()
    if (raw.startsWith('0x') && raw.length === 42) {
      const r = await fetchAbi(raw)
      currentAbi = r.abi
    } else {
      try {
        const p = JSON.parse(raw)
        currentAbi = Array.isArray(p) ? p : p.abi
      } catch { currentAbi = null }
    }
    decode()
  })

  async function decode() {
    const raw = input.value.trim()
    if (!raw || raw.length < 10) { output.innerHTML = ''; return }
    const data = ensure0x(raw)
    const selector = data.slice(0, 10)

    // Error(string) — 0x08c379a0
    if (selector === '0x08c379a0') {
      try {
        const [msg] = decodeAbiParameters([{ type: 'string' }], '0x' + data.slice(10))
        output.innerHTML = `<div class="result-card">
          <div class="badge error-badge">Error(string)</div>
          <div class="error-message">"${esc(msg)}"</div>
        </div>`
        return
      } catch {}
    }

    // Panic(uint256) — 0x4e487b71
    if (selector === '0x4e487b71') {
      try {
        const [code] = decodeAbiParameters([{ type: 'uint256' }], '0x' + data.slice(10))
        const num = Number(code)
        const desc = PANIC_CODES[num] || 'Unknown panic code'
        output.innerHTML = `<div class="result-card">
          <div class="badge error-badge">Panic(uint256)</div>
          <div class="error-message">Code: 0x${num.toString(16).padStart(2, '0')} (${num})</div>
          <div class="text-bright" style="margin-top:4px">${esc(desc)}</div>
        </div>`
        return
      } catch {}
    }

    // Try custom error with ABI
    if (currentAbi) {
      try {
        const result = decodeErrorResult({ abi: currentAbi, data })
        const args = result.args || []
        let rows = ''
        const errAbi = currentAbi.find(e => e.type === 'error' && e.name === result.errorName)
        const inputs = errAbi?.inputs || []
        for (let i = 0; i < args.length; i++) {
          rows += `<tr><td class="text-dim">${i}</td><td class="text-purple">${esc(inputs[i]?.name || `arg${i}`)}</td><td class="text-dim">${esc(inputs[i]?.type || '?')}</td><td class="mono">${esc(String(args[i]))}</td></tr>`
        }
        output.innerHTML = `<div class="result-card">
          <div class="badge error-badge">${esc(result.errorName)}</div>
          <div class="selector-badge">${esc(selector)}</div>
          ${rows ? `<table class="params-table"><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        </div>`
        return
      } catch {}
    }

    // Lookup selector
    output.innerHTML = '<div class="result-card"><div class="loading">Looking up error selector...</div></div>'
    const sigs = await lookupSelector(selector)

    if (sigs.length > 0) {
      output.innerHTML = `<div class="result-card">
        <div class="selector-badge">${esc(selector)}</div>
        <p>Possible error signatures:</p>
        ${sigs.map(s => `<div class="mono">${esc(s)}</div>`).join('')}
        <p class="text-dim" style="margin-top:8px">Paste the contract ABI to decode parameters.</p>
      </div>`
    } else {
      output.innerHTML = `<div class="result-card">
        <div class="selector-badge">${esc(selector)}</div>
        <p class="text-dim">Unknown error selector. Paste the contract ABI to decode custom errors.</p>
      </div>`
    }
  }
}
