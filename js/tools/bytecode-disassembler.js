import { fetchBytecode } from '../shared/etherscan.js'
import { lookupSelector } from '../shared/etherscan.js'
import { esc, ensure0x, strip0x } from '../shared/formatters.js'
import { parseSourceMap, buildLineIndex, rangeToLines } from '../shared/source-map.js'

// EVM opcode table
const OPCODES = {
  '00':'STOP','01':'ADD','02':'MUL','03':'SUB','04':'DIV','05':'SDIV','06':'MOD','07':'SMOD','08':'ADDMOD','09':'MULMOD','0a':'EXP','0b':'SIGNEXTEND',
  '10':'LT','11':'GT','12':'SLT','13':'SGT','14':'EQ','15':'ISZERO','16':'AND','17':'OR','18':'XOR','19':'NOT','1a':'BYTE','1b':'SHL','1c':'SHR','1d':'SAR',
  '20':'SHA3',
  '30':'ADDRESS','31':'BALANCE','32':'ORIGIN','33':'CALLER','34':'CALLVALUE','35':'CALLDATALOAD','36':'CALLDATASIZE','37':'CALLDATACOPY','38':'CODESIZE','39':'CODECOPY','3a':'GASPRICE','3b':'EXTCODESIZE','3c':'EXTCODECOPY','3d':'RETURNDATASIZE','3e':'RETURNDATACOPY','3f':'EXTCODEHASH',
  '40':'BLOCKHASH','41':'COINBASE','42':'TIMESTAMP','43':'NUMBER','44':'DIFFICULTY','45':'GASLIMIT','46':'CHAINID','47':'SELFBALANCE','48':'BASEFEE',
  '50':'POP','51':'MLOAD','52':'MSTORE','53':'MSTORE8','54':'SLOAD','55':'SSTORE','56':'JUMP','57':'JUMPI','58':'PC','59':'MSIZE','5a':'GAS','5b':'JUMPDEST',
  '5f':'PUSH0',
  'f0':'CREATE','f1':'CALL','f2':'CALLCODE','f3':'RETURN','f4':'DELEGATECALL','f5':'CREATE2','fa':'STATICCALL','fd':'REVERT','fe':'INVALID','ff':'SELFDESTRUCT'
}
// PUSH1-PUSH32, DUP1-DUP16, SWAP1-SWAP16, LOG0-LOG4
for (let i = 0; i < 32; i++) OPCODES[(0x60 + i).toString(16)] = `PUSH${i + 1}`
for (let i = 0; i < 16; i++) OPCODES[(0x80 + i).toString(16)] = `DUP${i + 1}`
for (let i = 0; i < 16; i++) OPCODES[(0x90 + i).toString(16)] = `SWAP${i + 1}`
for (let i = 0; i < 5; i++) OPCODES[(0xa0 + i).toString(16)] = `LOG${i}`

function opcodeCategory(name) {
  if (['SLOAD','SSTORE'].includes(name)) return 'storage'
  if (['MLOAD','MSTORE','MSTORE8','MSIZE','SHA3'].includes(name)) return 'memory'
  if (['CALL','DELEGATECALL','STATICCALL','CALLCODE','CREATE','CREATE2'].includes(name)) return 'call'
  if (['JUMP','JUMPI','JUMPDEST','REVERT','RETURN','STOP','INVALID','SELFDESTRUCT'].includes(name)) return 'control'
  if (name.startsWith('PUSH') || name.startsWith('DUP') || name.startsWith('SWAP') || name === 'POP') return 'stack'
  return 'other'
}

function disassemble(hex) {
  const bytes = strip0x(hex)
  const ops = []
  let i = 0
  const selectors = new Set()

  while (i < bytes.length) {
    const offset = i / 2
    const opByte = bytes.slice(i, i + 2).toLowerCase()
    const name = OPCODES[opByte] || `UNKNOWN(0x${opByte})`
    i += 2

    let operand = ''
    if (name.startsWith('PUSH') && name !== 'PUSH0') {
      const n = parseInt(name.slice(4))
      operand = bytes.slice(i, i + n * 2)
      i += n * 2
      if (name === 'PUSH4' && operand.length === 8) selectors.add('0x' + operand)
    }

    ops.push({ offset, name, operand, category: opcodeCategory(name) })
  }

  return { ops, selectors: [...selectors] }
}

function detectCBOR(hex) {
  const bytes = strip0x(hex)
  // Last 2 bytes = CBOR length, preceding bytes = CBOR data
  if (bytes.length < 4) return null
  const lenHex = bytes.slice(-4)
  const len = parseInt(lenHex, 16)
  if (len > 0 && len < bytes.length / 2 && len < 100) {
    return { length: len, data: bytes.slice(-(len * 2 + 4), -4) }
  }
  return null
}

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Bytecode Disassembler</h2>
      <p class="tool-desc">Paste bytecode or a contract address to see the opcode breakdown. Load a compiled artifact to link opcodes to source.</p>
    </div>
    <div class="tool-body">
      <div class="input-row">
        <div class="input-group flex-1">
          <label>Load artifact <span class="text-dim">(for source-map linking)</span></label>
          <select id="bc-artifact" class="mono-input">
            <option value="">— paste bytecode below instead —</option>
          </select>
        </div>
        <div class="input-group">
          <label>Which code?</label>
          <select id="bc-which" class="mono-input">
            <option value="deployed">Deployed (runtime)</option>
            <option value="creation">Creation</option>
          </select>
        </div>
      </div>
      <div class="input-group">
        <label>Bytecode (hex) or contract address</label>
        <textarea id="bc-input" class="mono-input" rows="3" placeholder="0x608060405234801561001057... or 0x contract address" spellcheck="false"></textarea>
      </div>
      <div id="bc-output" class="output-area"></div>
    </div>
  `

  const input = document.getElementById('bc-input')
  const output = document.getElementById('bc-output')
  const artifactSelect = document.getElementById('bc-artifact')
  const whichSelect = document.getElementById('bc-which')

  // Source-map state for enriched rendering
  let smState = null // { entries: [...], source: str, lineIndex: [...], fileName: str }

  // Populate artifact dropdown
  let artifacts = {}
  try { artifacts = JSON.parse(localStorage.getItem('anywei_compiled') || '{}') } catch {}
  let ideFiles = {}
  try { ideFiles = JSON.parse(localStorage.getItem('anywei_ide_files') || '{}') } catch {}
  for (const name of Object.keys(artifacts)) {
    const a = artifacts[name]
    if (!a?.sourceMap && !a?.deployedSourceMap) continue
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    artifactSelect.appendChild(opt)
  }

  artifactSelect.addEventListener('change', () => {
    const name = artifactSelect.value
    if (!name) { smState = null; input.value = ''; output.innerHTML = ''; return }
    loadArtifact(name)
  })
  whichSelect.addEventListener('change', () => {
    if (artifactSelect.value) loadArtifact(artifactSelect.value)
  })

  function loadArtifact(name) {
    const a = artifacts[name]
    if (!a) return
    const which = whichSelect.value
    const bc = which === 'creation' ? a.bytecode : a.deployedBytecode
    const sm = which === 'creation' ? a.sourceMap : a.deployedSourceMap
    const sourceName = a.sourceFile || Object.keys(ideFiles)[0]
    const source = ideFiles[sourceName]?.content || ''
    if (!bc || bc === '0x') { output.innerHTML = '<div class="result-card error">This artifact has no bytecode for that selection.</div>'; return }
    input.value = bc
    if (sm && source) {
      smState = {
        entries: parseSourceMap(sm),
        source,
        lineIndex: buildLineIndex(source),
        fileName: sourceName,
      }
    } else {
      smState = null
    }
    run()
  }

  input.addEventListener('input', () => { if (!artifactSelect.value) smState = null; run() })
  input.addEventListener('paste', () => setTimeout(() => { if (!artifactSelect.value) smState = null; run() }, 50))

  async function run() {
    const raw = input.value.trim()
    if (!raw) { output.innerHTML = ''; return }

    let bytecode = raw
    if (raw.startsWith('0x') && raw.length === 42) {
      output.innerHTML = '<div class="loading">Fetching bytecode...</div>'
      bytecode = await fetchBytecode(raw)
      if (!bytecode || bytecode === '0x') {
        output.innerHTML = '<div class="result-card error">No bytecode at this address (EOA or empty contract)</div>'
        return
      }
    }

    if (strip0x(bytecode).length < 2) { output.innerHTML = ''; return }

    const { ops, selectors } = disassemble(bytecode)
    const cbor = detectCBOR(bytecode)

    // Stats
    const stats = {
      bytes: strip0x(bytecode).length / 2,
      sstore: ops.filter(o => o.name === 'SSTORE').length,
      sload: ops.filter(o => o.name === 'SLOAD').length,
      calls: ops.filter(o => ['CALL','DELEGATECALL','STATICCALL'].includes(o.name)).length,
      jumpdests: ops.filter(o => o.name === 'JUMPDEST').length,
    }

    let html = `<div class="result-card">
      <div class="bc-stats">
        <span>${stats.bytes.toLocaleString()} bytes</span>
        <span class="text-dim">&middot;</span>
        <span>${stats.sload} SLOAD</span>
        <span class="text-dim">&middot;</span>
        <span>${stats.sstore} SSTORE</span>
        <span class="text-dim">&middot;</span>
        <span>${stats.calls} external calls</span>
        <span class="text-dim">&middot;</span>
        <span>${stats.jumpdests} JUMPDESTs</span>
      </div>`

    if (selectors.length > 0) {
      html += `<div class="bc-selectors"><span class="text-dim">Function selectors found:</span><div class="selector-list">`
      for (const sel of selectors) {
        html += `<span class="mono selector-badge">${esc(sel)}</span> `
      }
      html += '</div></div>'
    }

    if (cbor) {
      html += `<div class="text-dim" style="margin-top:8px">CBOR metadata: ${cbor.length} bytes at end of bytecode</div>`
    }

    html += '</div>'

    // Opcode listing — with source-map linking when available
    if (smState) {
      html += `<div class="bc-split">`
      html += `<div class="bc-listing bc-listing-split" id="bc-listing-el">`
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]
        const sm = smState.entries[i]
        let lineInfo = ''
        let click = ''
        if (sm && sm.s >= 0 && sm.l > 0) {
          const r = rangeToLines(smState.lineIndex, sm.s, sm.l)
          if (r) {
            lineInfo = `<span class="bc-srcline">L${r.startLine}${r.endLine !== r.startLine ? '-' + r.endLine : ''}</span>`
            click = `data-start="${sm.s}" data-length="${sm.l}" data-line="${r.startLine}"`
          }
        }
        html += `<div class="bc-op bc-${op.category}" ${click}><span class="bc-offset">${op.offset.toString(16).padStart(4, '0')}</span><span class="bc-name">${op.name}</span>${op.operand ? `<span class="bc-operand">0x${op.operand}</span>` : ''}${lineInfo}</div>`
      }
      html += '</div>'
      // Source panel
      html += `<div class="bc-source-panel" id="bc-source-el">`
      html += `<div class="bc-source-header">${esc(smState.fileName || 'source')}</div>`
      html += `<pre class="bc-source-code">`
      const lines = smState.source.split('\n')
      for (let i = 0; i < lines.length; i++) {
        html += `<div class="bc-src-line" data-line="${i + 1}"><span class="bc-src-lineno">${(i + 1).toString().padStart(4, ' ')}</span>${esc(lines[i]) || ' '}</div>`
      }
      html += `</pre></div>`
      html += '</div>'
    } else {
      html += '<div class="bc-listing">'
      for (const op of ops) {
        html += `<div class="bc-op bc-${op.category}"><span class="bc-offset">${op.offset.toString(16).padStart(4, '0')}</span><span class="bc-name">${op.name}</span>${op.operand ? `<span class="bc-operand">0x${op.operand}</span>` : ''}</div>`
      }
      html += '</div>'
    }

    output.innerHTML = html

    // Wire click-to-highlight-source if we rendered the split view
    if (smState) {
      const listingEl = document.getElementById('bc-listing-el')
      const sourceEl = document.getElementById('bc-source-el')
      listingEl?.addEventListener('click', (e) => {
        const opDiv = e.target.closest('.bc-op')
        if (!opDiv || !opDiv.dataset.line) return
        const line = parseInt(opDiv.dataset.line)
        sourceEl.querySelectorAll('.bc-src-line.active').forEach(el => el.classList.remove('active'))
        const target = sourceEl.querySelector(`.bc-src-line[data-line="${line}"]`)
        if (target) {
          target.classList.add('active')
          target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
        listingEl.querySelectorAll('.bc-op.active').forEach(el => el.classList.remove('active'))
        opDiv.classList.add('active')
      })
    }
  }
}
