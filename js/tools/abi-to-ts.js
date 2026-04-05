import { esc, copyBtn } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>ABI → TypeScript</h2>
      <p class="tool-desc">Generate TypeScript types for a contract's functions, events, errors, and structs from its ABI.</p>
    </div>
    <div class="tool-body">
      <div class="input-row">
        <div class="input-group flex-1">
          <label>Contract</label>
          <select id="ats-artifact" class="mono-input">
            <option value="">— select a compiled contract —</option>
          </select>
        </div>
      </div>
      <div class="input-group">
        <label>ABI JSON <span class="text-dim">(or paste directly)</span></label>
        <textarea id="ats-abi" class="mono-input" rows="4" placeholder="[ { ... } ]" spellcheck="false"></textarea>
      </div>
      <div class="input-row">
        <label class="check-label">
          <input type="checkbox" id="ats-viem" checked>
          <span>viem-style (Address = \`0x\${string}\`)</span>
        </label>
        <label class="check-label">
          <input type="checkbox" id="ats-named" checked>
          <span>Named tuple args</span>
        </label>
      </div>
      <div id="ats-output" class="output-area" style="margin-top:12px"></div>
    </div>
  `

  const select = document.getElementById('ats-artifact')
  const textarea = document.getElementById('ats-abi')
  const viemCheck = document.getElementById('ats-viem')
  const namedCheck = document.getElementById('ats-named')
  const output = document.getElementById('ats-output')

  let artifacts = {}
  try { artifacts = JSON.parse(localStorage.getItem('anywei_compiled') || '{}') } catch {}
  for (const name of Object.keys(artifacts)) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    select.appendChild(opt)
  }

  select.addEventListener('change', () => {
    const name = select.value
    if (!name || !artifacts[name]?.abi) return
    textarea.value = JSON.stringify(artifacts[name].abi, null, 2)
    generate()
  })
  textarea.addEventListener('input', generate)
  viemCheck.addEventListener('change', generate)
  namedCheck.addEventListener('change', generate)

  function generate() {
    const raw = textarea.value.trim()
    if (!raw) { output.innerHTML = ''; return }
    let abi
    try { abi = JSON.parse(raw) } catch (e) {
      output.innerHTML = `<div class="term-error">Invalid JSON: ${esc(e.message)}</div>`
      return
    }
    if (!Array.isArray(abi)) { output.innerHTML = '<div class="term-error">ABI must be an array</div>'; return }

    const opts = { viem: viemCheck.checked, named: namedCheck.checked }
    const ts = generateTypes(abi, select.value || 'Contract', opts)
    output.innerHTML = `<pre class="ts-output">${esc(ts)}</pre>`
    const wrap = document.createElement('div')
    wrap.style.marginTop = '8px'
    wrap.appendChild(copyBtn(ts, 'Copy TypeScript'))
    output.appendChild(wrap)
  }
}

// ─── Type generation ────────────────────────────────────────

function generateTypes(abi, contractName, opts) {
  const structs = new Map() // struct-name → { fields: [{name, type}], canonical: string }

  // Collect structs from the ABI (from any input/output's `internalType` / `components`)
  collectStructs(abi, structs)

  const lines = []
  lines.push(`// Generated from ${contractName}'s ABI — anywei.dev`)
  lines.push('')

  if (opts.viem) {
    lines.push('export type Address = `0x${string}`;')
    lines.push('export type Hex = `0x${string}`;')
    lines.push('')
  } else {
    lines.push('export type Address = string;')
    lines.push('export type Hex = string;')
    lines.push('')
  }

  // Emit struct interfaces
  for (const [name, info] of structs) {
    lines.push(`export interface ${name} {`)
    for (const f of info.fields) {
      lines.push(`  ${f.name || '_'}: ${solToTs(f, opts)};`)
    }
    lines.push('}')
    lines.push('')
  }

  // Functions
  const funcs = abi.filter(e => e.type === 'function')
  if (funcs.length) {
    lines.push(`export interface ${sanitize(contractName)}Functions {`)
    for (const f of funcs) {
      const argsStr = tupleSig(f.inputs || [], opts)
      const retsStr = returnSig(f.outputs || [], opts)
      lines.push(`  ${sanitize(f.name)}: { args: ${argsStr}; returns: ${retsStr} };`)
    }
    lines.push('}')
    lines.push('')
  }

  // Events
  const events = abi.filter(e => e.type === 'event')
  if (events.length) {
    lines.push(`export interface ${sanitize(contractName)}Events {`)
    for (const ev of events) {
      lines.push(`  ${sanitize(ev.name)}: { args: ${namedFields(ev.inputs || [], opts)} };`)
    }
    lines.push('}')
    lines.push('')
  }

  // Custom errors
  const errors = abi.filter(e => e.type === 'error')
  if (errors.length) {
    lines.push(`export interface ${sanitize(contractName)}Errors {`)
    for (const er of errors) {
      lines.push(`  ${sanitize(er.name)}: { args: ${namedFields(er.inputs || [], opts)} };`)
    }
    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

function collectStructs(node, out) {
  if (Array.isArray(node)) { for (const n of node) collectStructs(n, out); return }
  if (!node || typeof node !== 'object') return
  // A tuple with internalType "struct X.Y" is a named struct
  if (node.type && node.type.startsWith('tuple') && node.internalType) {
    const match = node.internalType.match(/^struct\s+([A-Za-z0-9_.]+)(\[\d*\])*$/)
    if (match) {
      const fullName = match[1]
      const shortName = fullName.split('.').pop()
      if (!out.has(shortName)) {
        out.set(shortName, { fields: node.components || [], canonical: fullName })
      }
    }
  }
  // Recurse into components / inputs / outputs
  if (node.components) collectStructs(node.components, out)
  if (node.inputs) collectStructs(node.inputs, out)
  if (node.outputs) collectStructs(node.outputs, out)
}

// Convert a Solidity type name to its TypeScript equivalent.
// `param` is an ABI input/output entry with {type, components?, internalType?}
function solToTs(param, opts) {
  let t = param.type

  // Handle arrays by stripping suffix(es)
  let arrayDepth = 0
  while (t.endsWith(']')) {
    arrayDepth++
    t = t.slice(0, t.lastIndexOf('['))
  }

  let base
  if (t === 'address' || t === 'address payable') base = 'Address'
  else if (t === 'bool') base = 'boolean'
  else if (t === 'string') base = 'string'
  else if (t === 'bytes' || /^bytes\d+$/.test(t)) base = 'Hex'
  else if (/^(u?int)(\d+)?$/.test(t)) base = 'bigint'
  else if (t === 'tuple') {
    if (param.internalType) {
      const m = param.internalType.match(/^struct\s+([A-Za-z0-9_.]+)/)
      if (m) base = m[1].split('.').pop()
      else base = inlineTuple(param.components || [], opts)
    } else base = inlineTuple(param.components || [], opts)
  } else base = 'unknown'

  return base + '[]'.repeat(arrayDepth)
}

function inlineTuple(components, opts) {
  const parts = components.map(c => `${c.name || '_'}: ${solToTs(c, opts)}`)
  return `{ ${parts.join('; ')} }`
}

// Positional tuple signature: `[to: Address, amount: bigint]`
function tupleSig(inputs, opts) {
  if (inputs.length === 0) return '[]'
  if (!opts.named) return `[${inputs.map(i => solToTs(i, opts)).join(', ')}]`
  return `[${inputs.map((i, idx) => `${i.name || `_${idx}`}: ${solToTs(i, opts)}`).join(', ')}]`
}

// Return-value signature: single value unwrapped, multiple wrapped in tuple.
function returnSig(outputs, opts) {
  if (outputs.length === 0) return 'void'
  if (outputs.length === 1) return solToTs(outputs[0], opts)
  return tupleSig(outputs, opts)
}

// Named-fields object signature for events/errors: `{ from: Address; value: bigint }`
function namedFields(inputs, opts) {
  if (inputs.length === 0) return '{}'
  return `{ ${inputs.map((i, idx) => `${i.name || `_${idx}`}: ${solToTs(i, opts)}`).join('; ')} }`
}

function sanitize(name) {
  if (!name) return '_'
  // Reserved TS keywords
  const reserved = new Set(['default', 'function', 'interface', 'delete', 'new', 'class'])
  if (reserved.has(name)) return `_${name}`
  return name
}
