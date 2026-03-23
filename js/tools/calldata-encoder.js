import { encodeFunctionData, parseAbi, toFunctionSelector } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { esc, copyBtn, ensure0x, strip0x, saveState, loadState } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Calldata Encoder</h2>
      <p class="tool-desc">Build raw calldata from a function signature and parameters.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Function signature or ABI source</label>
        <input type="text" id="enc-sig" class="mono-input" placeholder="transfer(address,uint256) or paste contract address / ABI JSON" spellcheck="false">
        <div id="enc-status" class="status-line"></div>
      </div>
      <div id="enc-fn-select" class="hidden">
        <label>Select function</label>
        <select id="enc-fn-dropdown" class="mono-input"></select>
      </div>
      <div id="enc-params" class="params-builder"></div>
      <div style="display:flex;gap:8px">
        <button id="enc-btn" class="btn btn-primary">Encode</button>
        <button id="enc-random" class="btn">Fill Random</button>
      </div>
      <div id="enc-output" class="output-area"></div>
    </div>
  `

  const sigInput = document.getElementById('enc-sig')
  const status = document.getElementById('enc-status')
  const fnSelect = document.getElementById('enc-fn-select')
  const fnDropdown = document.getElementById('enc-fn-dropdown')
  const paramsDiv = document.getElementById('enc-params')
  const encBtn = document.getElementById('enc-btn')
  const output = document.getElementById('enc-output')

  let currentAbi = null
  let selectedFn = null

  sigInput.addEventListener('change', handleInput)
  sigInput.addEventListener('paste', () => setTimeout(handleInput, 50))
  fnDropdown.addEventListener('change', selectFn)
  encBtn.addEventListener('click', encode)
  document.getElementById('enc-random').addEventListener('click', () => {
    if (!selectedFn) return
    const inputs = selectedFn.inputs || []
    const paramEls = paramsDiv.querySelectorAll('.enc-param')
    for (let i = 0; i < inputs.length && i < paramEls.length; i++) {
      paramEls[i].value = randomParamValue(inputs[i].type)
    }
  })

  async function handleInput() {
    const raw = sigInput.value.trim()
    if (!raw) return

    // Try as address
    if (raw.startsWith('0x') && raw.length === 42) {
      status.innerHTML = '<span class="loading">Fetching ABI...</span>'
      try {
        const result = await fetchAbi(raw)
        if (result.abi) {
          currentAbi = result.abi
          status.innerHTML = `<span class="success">${esc(result.contractName || 'ABI loaded')}</span>`
          populateDropdown()
        } else {
          status.innerHTML = '<span class="error">Not verified</span>'
        }
      } catch (e) { status.innerHTML = `<span class="error">${esc(e.message)}</span>` }
      return
    }

    // Try as ABI JSON
    if (raw.startsWith('[') || raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw)
        currentAbi = Array.isArray(parsed) ? parsed : parsed.abi
        status.innerHTML = '<span class="success">ABI parsed</span>'
        populateDropdown()
        return
      } catch {}
    }

    // Treat as function signature
    try {
      currentAbi = null
      fnSelect.classList.add('hidden')
      const abi = parseAbi([`function ${raw}`])
      selectedFn = abi.find(e => e.type === 'function')
      status.innerHTML = `<span class="success">Parsed: ${esc(raw)}</span>`
      buildParams()
    } catch (e) {
      status.innerHTML = `<span class="error">Invalid signature</span>`
    }
  }

  function populateDropdown() {
    if (!currentAbi) return
    const fns = currentAbi.filter(e => e.type === 'function')
    fnDropdown.innerHTML = fns.map((f, i) =>
      `<option value="${i}">${esc(f.name)}(${(f.inputs || []).map(p => p.type).join(',')})</option>`
    ).join('')
    fnSelect.classList.remove('hidden')
    if (fns.length > 0) {
      selectedFn = fns[0]
      buildParams()
    }
  }

  function selectFn() {
    const fns = currentAbi.filter(e => e.type === 'function')
    selectedFn = fns[parseInt(fnDropdown.value)]
    buildParams()
  }

  function buildParams() {
    if (!selectedFn) { paramsDiv.innerHTML = ''; return }
    const inputs = selectedFn.inputs || []
    paramsDiv.innerHTML = inputs.map((inp, i) => `
      <div class="input-group">
        <label><span class="text-purple">${esc(inp.name || `arg${i}`)}</span> <span class="text-dim">${esc(inp.type)}</span></label>
        <input type="text" class="mono-input enc-param" data-idx="${i}" placeholder="${esc(inp.type)}" spellcheck="false">
      </div>
    `).join('')
  }

  function encode() {
    if (!selectedFn) return
    const inputs = selectedFn.inputs || []
    const args = []
    const paramEls = paramsDiv.querySelectorAll('.enc-param')

    for (let i = 0; i < inputs.length; i++) {
      const raw = paramEls[i]?.value?.trim() || ''
      args.push(coerceParam(raw, inputs[i].type))
    }

    try {
      const abi = currentAbi || [selectedFn]
      const data = encodeFunctionData({ abi, functionName: selectedFn.name, args })
      const selector = data.slice(0, 10)
      const payload = data.slice(10)
      const words = []
      for (let i = 0; i < payload.length; i += 64) {
        const word = payload.slice(i, i + 64)
        const paramLabel = i / 64 < inputs.length ? `${inputs[i / 64].name || 'arg' + (i / 64)}` : 'data'
        words.push(`<div class="raw-word"><span class="text-dim">${String(i / 64).padStart(3)}</span> ${esc(word)} <span class="text-dim">// ${esc(paramLabel)}</span></div>`)
      }

      output.innerHTML = `<div class="result-card">
        <div class="result-row"><span class="text-dim">Full calldata:</span></div>
        <div class="mono copyable" id="enc-result">${esc(data)}</div>
        <div style="margin-top:8px"><span class="text-dim">Selector:</span> <span class="mono selector-badge">${esc(selector)}</span></div>
        ${words.length ? `<div style="margin-top:8px" class="raw-words-header">Words:</div>${words.join('')}` : ''}
      </div>`

      const resultEl = document.getElementById('enc-result')
      resultEl.appendChild(copyBtn(data))
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }
}

function randomParamValue(type) {
  const t = type.replace(/\s/g, '')
  if (t === 'bool') return Math.random() > 0.5 ? 'true' : 'false'
  if (t === 'address') return '0x' + [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  if (t === 'string') return ['hello', 'test', 'world', 'solidity', 'anywei'][Math.floor(Math.random() * 5)]
  if (t === 'bytes32') return '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  if (t.startsWith('bytes') && !t.endsWith('[]')) {
    const n = parseInt(t.slice(5)) || Math.floor(Math.random() * 16) + 1
    return '0x' + [...Array(n * 2)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  }
  if (t.startsWith('uint')) {
    const r = Math.random()
    if (r < 0.3) return '0'
    if (r < 0.6) return String(Math.floor(Math.random() * 10000))
    return String(BigInt(Math.floor(Math.random() * 1e15)))
  }
  if (t.startsWith('int')) {
    const v = BigInt(Math.floor(Math.random() * 1e12))
    return Math.random() > 0.5 ? String(v) : String(-v)
  }
  if (t.endsWith('[]')) {
    const base = t.slice(0, -2)
    const len = Math.floor(Math.random() * 3) + 1
    return JSON.stringify([...Array(len)].map(() => randomParamValue(base)))
  }
  return '0'
}

function coerceParam(raw, type) {
  if (!raw && type !== 'string' && type !== 'bytes') return type === 'bool' ? false : type.startsWith('uint') || type.startsWith('int') ? 0n : '0x'
  if (type === 'bool') return raw === 'true' || raw === '1'
  if (type === 'address') return raw
  if (type.startsWith('uint') || type.startsWith('int')) return BigInt(raw.replace(/,/g, ''))
  if (type.startsWith('bytes')) return ensure0x(raw)
  if (type.endsWith('[]')) {
    try { return JSON.parse(raw) } catch {
      return raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    }
  }
  return raw
}
