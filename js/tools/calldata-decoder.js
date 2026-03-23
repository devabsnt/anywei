import { decodeFunctionData, parseAbi } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { lookupSelector } from '../shared/etherscan.js'
import { esc, copyBtn, ensure0x, strip0x, saveState, loadState, etherscanLink, truncAddr } from '../shared/formatters.js'

export function render(container, queryParams = {}) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Calldata Decoder</h2>
      <p class="tool-desc">Paste raw transaction calldata to decode it into a readable function call.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Calldata (hex)</label>
        <textarea id="cd-input" class="mono-input" rows="4" placeholder="0xa9059cbb000000000000000000000000..." spellcheck="false"></textarea>
      </div>
      <div class="input-group">
        <label>ABI source (optional &mdash; paste address or ABI JSON for named params)</label>
        <input type="text" id="cd-abi" class="mono-input" placeholder="0x contract address or [{ ... }] ABI JSON" spellcheck="false">
        <div id="cd-abi-status" class="status-line"></div>
      </div>
      <div id="cd-output" class="output-area"></div>
    </div>
  `

  const input = document.getElementById('cd-input')
  const abiInput = document.getElementById('cd-abi')
  const output = document.getElementById('cd-output')
  const abiStatus = document.getElementById('cd-abi-status')

  let currentAbi = null

  // Query params take precedence, then sessionStorage
  if (queryParams.data) {
    input.value = queryParams.data
  } else {
    const saved = loadState('calldata-decoder')
    if (saved) {
      if (saved.data) input.value = saved.data
      if (saved.abi) abiInput.value = saved.abi
    }
  }
  if (queryParams.address) abiInput.value = queryParams.address

  async function resolveAbi() {
    const raw = abiInput.value.trim()
    if (!raw) { currentAbi = null; abiStatus.textContent = ''; return }

    if (raw.startsWith('0x') && raw.length === 42) {
      abiStatus.innerHTML = '<span class="loading">Fetching ABI...</span>'
      try {
        const result = await fetchAbi(raw)
        if (result.abi) {
          currentAbi = result.abi
          abiStatus.innerHTML = `<span class="success">${esc(result.contractName || 'ABI loaded')}${result.isProxy ? ' (proxy)' : ''}</span>`
        } else {
          currentAbi = null
          abiStatus.innerHTML = '<span class="error">Contract not verified</span>'
        }
      } catch (e) {
        abiStatus.innerHTML = `<span class="error">${esc(e.message)}</span>`
      }
    } else {
      try {
        const parsed = JSON.parse(raw)
        currentAbi = Array.isArray(parsed) ? parsed : parsed.abi || null
        abiStatus.innerHTML = currentAbi ? '<span class="success">ABI parsed</span>' : '<span class="error">Invalid ABI</span>'
      } catch {
        currentAbi = null
        abiStatus.innerHTML = '<span class="error">Invalid JSON</span>'
      }
    }
    decode()
  }

  async function decode() {
    const raw = input.value.trim()
    saveState('calldata-decoder', { data: raw, abi: abiInput.value.trim() })
    if (!raw || raw.length < 10) { output.innerHTML = ''; return }

    const data = ensure0x(raw)
    const selector = data.slice(0, 10)

    // Try ABI decode
    if (currentAbi) {
      try {
        const result = decodeFunctionData({ abi: currentAbi, data })
        output.innerHTML = renderDecoded(selector, result.functionName, currentAbi, result.args)
        return
      } catch {}
    }

    // Fallback: lookup selector
    output.innerHTML = `<div class="result-card"><div class="selector-badge">${esc(selector)}</div><div class="loading">Looking up selector...</div></div>`
    const sigs = await lookupSelector(selector)

    if (sigs.length === 0) {
      output.innerHTML = `<div class="result-card"><div class="selector-badge">${esc(selector)}</div><p class="text-dim">Unknown selector. Paste the contract ABI to decode.</p><div class="raw-words">${renderRawWords(data)}</div></div>`
      return
    }

    // Try each signature
    for (const sig of sigs) {
      try {
        const abi = parseAbi([`function ${sig}`])
        const result = decodeFunctionData({ abi, data })
        output.innerHTML = renderDecoded(selector, result.functionName, abi, result.args)
        if (sigs.length > 1) {
          output.innerHTML += `<div class="text-dim" style="margin-top:8px;font-size:11px">${sigs.length} matching signatures found. Using first match.</div>`
        }
        return
      } catch { continue }
    }

    // Couldn't decode with any sig
    output.innerHTML = `<div class="result-card"><div class="selector-badge">${esc(selector)}</div><p>Possible signatures:</p>${sigs.map(s => `<div class="mono text-dim">${esc(s)}</div>`).join('')}<p class="text-dim" style="margin-top:8px">Could not decode params. The data may not match these signatures.</p><div class="raw-words">${renderRawWords(data)}</div></div>`
  }

  abiInput.addEventListener('change', resolveAbi)
  abiInput.addEventListener('paste', () => setTimeout(resolveAbi, 50))
  input.addEventListener('input', decode)
  input.addEventListener('paste', () => setTimeout(decode, 50))

  if (input.value) {
    if (abiInput.value) resolveAbi()
    else decode()
  }
}

function renderDecoded(selector, fnName, abi, args) {
  const fnAbi = (Array.isArray(abi) ? abi : []).find(e => e.type === 'function' && e.name === fnName)
  const inputs = fnAbi?.inputs || []
  const sig = `${fnName}(${inputs.map(i => i.type).join(', ')})`

  let rows = ''
  for (let i = 0; i < (args?.length || 0); i++) {
    const inp = inputs[i] || {}
    const val = args[i]
    rows += `<tr>
      <td class="text-dim">${i}</td>
      <td class="text-purple">${esc(inp.name || `arg${i}`)}</td>
      <td class="text-dim">${esc(inp.type || '?')}</td>
      <td class="mono">${renderValue(val, inp.type)}</td>
    </tr>`
  }

  return `<div class="result-card">
    <div class="selector-badge">${esc(selector)}</div>
    <div class="fn-signature"><span class="text-purple">${esc(fnName)}</span>(${inputs.map(i => `<span class="text-dim">${esc(i.type)}</span> <span class="text-blue">${esc(i.name)}</span>`).join(', ')})</div>
    ${rows ? `<table class="params-table"><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="text-dim">No parameters</p>'}
  </div>`
}

function renderValue(val, type) {
  if (val === undefined || val === null) return '<span class="text-dim">null</span>'
  if (typeof val === 'bigint') {
    const s = val.toString()
    return `${esc(s)}${s.length > 10 ? ` <span class="text-dim">(${formatTokenAmount(val)})</span>` : ''}`
  }
  if (typeof val === 'string' && val.startsWith('0x') && val.length === 42) {
    return `<a href="${etherscanLink(val)}" target="_blank" class="text-blue">${esc(val)}</a>`
  }
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  if (Array.isArray(val)) {
    return `[${val.map((v, i) => renderValue(v, type?.replace('[]', ''))).join(', ')}]`
  }
  if (typeof val === 'object') {
    return `<pre class="inline-pre">${esc(JSON.stringify(val, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2))}</pre>`
  }
  return esc(String(val))
}

function formatTokenAmount(val) {
  const s = val.toString()
  if (s.length >= 18) return (Number(val) / 1e18).toFixed(4) + ' (18 dec)'
  if (s.length >= 6 && s.length < 12) return (Number(val) / 1e6).toFixed(2) + ' (6 dec)'
  return ''
}

function renderRawWords(data) {
  const hex = strip0x(data)
  if (hex.length <= 8) return ''
  const words = []
  const payload = hex.slice(8)
  for (let i = 0; i < payload.length; i += 64) {
    words.push(`<div class="raw-word"><span class="text-dim">${String(i / 64).padStart(3)}</span> ${esc(payload.slice(i, i + 64))}</div>`)
  }
  return `<div class="raw-words-header">Raw 32-byte words:</div>${words.join('')}`
}
