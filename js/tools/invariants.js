// Invariant testing — function-sequence fuzzing against user-defined
// `invariant_*()` functions. After each random call, every invariant is
// asserted. A broken invariant halts the run and shows the failing sequence.
//
// Compatibility note: invariant functions should be view/pure, take no args,
// and return a single bool. Public/external state-modifying functions act as
// the "action set" the fuzzer picks from each step.

import { createLocalEVM } from '../shared/local-evm.js'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { esc } from '../shared/formatters.js'

const DEPLOY_ADDR = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
const CALLER = '0x5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Invariant Testing</h2>
      <p class="tool-desc">Define <span class="mono">invariant_*()</span> view functions that should always return true, then fuzz random sequences of state-modifying calls against them.</p>
    </div>
    <div class="tool-body">
      <div class="input-row">
        <div class="input-group flex-1">
          <label>Artifact <span class="text-dim">(from IDE, or paste JSON)</span></label>
          <select id="inv-artifact" class="mono-input">
            <option value="">— select a compiled contract —</option>
          </select>
        </div>
      </div>
      <div class="input-group">
        <label>Artifact JSON</label>
        <textarea id="inv-json" class="mono-input" rows="3" placeholder='{"abi":[...],"deployedBytecode":"0x..."}' spellcheck="false"></textarea>
        <div id="inv-status" class="status-line"></div>
      </div>
      <div id="inv-controls" class="hidden" style="display:flex;gap:8px;align-items:flex-end">
        <div class="input-group" style="width:120px">
          <label>Runs</label>
          <select id="inv-runs" class="mono-input">
            <option value="50">50</option>
            <option value="100" selected>100</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>
        </div>
        <div class="input-group" style="width:120px">
          <label>Seq depth</label>
          <select id="inv-depth" class="mono-input">
            <option value="5">5</option>
            <option value="10" selected>10</option>
            <option value="25">25</option>
            <option value="50">50</option>
          </select>
        </div>
        <button id="inv-run" class="btn btn-primary">Run</button>
        <button id="inv-stop" class="btn hidden">Stop</button>
      </div>
      <div id="inv-summary" class="status-line" style="margin-top:8px"></div>
      <div id="inv-output" class="output-area"></div>
    </div>
  `

  const artifactSelect = document.getElementById('inv-artifact')
  const jsonArea = document.getElementById('inv-json')
  const statusEl = document.getElementById('inv-status')
  const controls = document.getElementById('inv-controls')
  const runBtn = document.getElementById('inv-run')
  const stopBtn = document.getElementById('inv-stop')
  const summary = document.getElementById('inv-summary')
  const output = document.getElementById('inv-output')

  let artifact = null
  let running = false

  // Populate dropdown from localStorage
  let artifacts = {}
  try { artifacts = JSON.parse(localStorage.getItem('anywei_compiled') || '{}') } catch {}
  for (const name of Object.keys(artifacts)) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    artifactSelect.appendChild(opt)
  }

  artifactSelect.addEventListener('change', () => {
    const name = artifactSelect.value
    if (!name) return
    jsonArea.value = JSON.stringify(artifacts[name], null, 2)
    loadArtifact()
  })
  jsonArea.addEventListener('input', loadArtifact)
  runBtn.addEventListener('click', run)
  stopBtn.addEventListener('click', () => { running = false })

  function loadArtifact() {
    try {
      const raw = jsonArea.value.trim()
      if (!raw) { controls.classList.add('hidden'); statusEl.innerHTML = ''; return }
      const parsed = JSON.parse(raw)
      artifact = {
        abi: parsed.abi || (Array.isArray(parsed) ? parsed : null),
        deployedBytecode: parsed.deployedBytecode || (parsed.bytecode?.object ? '0x' + parsed.bytecode.object : parsed.bytecode) || null,
      }
      if (!artifact.abi) throw new Error('No ABI')
      if (!artifact.deployedBytecode || artifact.deployedBytecode === '0x') throw new Error('No deployed bytecode')

      const invariants = findInvariants(artifact.abi)
      const actions = findActions(artifact.abi)

      if (invariants.length === 0) {
        statusEl.innerHTML = '<span class="error">No invariant_* functions found. Add view functions starting with "invariant_" that return bool.</span>'
        controls.classList.add('hidden')
        return
      }
      if (actions.length === 0) {
        statusEl.innerHTML = '<span class="error">No state-modifying actions found to fuzz.</span>'
        controls.classList.add('hidden')
        return
      }
      statusEl.innerHTML = `<span class="success">${invariants.length} invariant${invariants.length === 1 ? '' : 's'} · ${actions.length} action${actions.length === 1 ? '' : 's'}</span>`
      controls.classList.remove('hidden')
    } catch (e) {
      statusEl.innerHTML = `<span class="error">${esc(e.message)}</span>`
      controls.classList.add('hidden')
    }
  }

  async function run() {
    if (!artifact || running) return
    running = true
    runBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    output.innerHTML = ''

    const runs = parseInt(document.getElementById('inv-runs').value)
    const depth = parseInt(document.getElementById('inv-depth').value)
    const invariants = findInvariants(artifact.abi)
    const actions = findActions(artifact.abi)

    let broken = null
    let totalSteps = 0
    let reverts = 0

    for (let r = 0; r < runs && running; r++) {
      if (r % 10 === 0) summary.innerHTML = `<span class="loading">Run ${r + 1}/${runs} · ${totalSteps} steps · ${reverts} reverts</span>`

      // Fresh EVM for each run (independent state)
      const evm = await createLocalEVM()
      await evm.setup({ contractCode: artifact.deployedBytecode, contractAddress: DEPLOY_ADDR, callerAddress: CALLER })

      const sequence = []
      for (let s = 0; s < depth && running; s++) {
        const action = actions[Math.floor(Math.random() * actions.length)]
        const args = (action.inputs || []).map(inp => randomValue(inp.type))
        let data
        try { data = encodeFunctionData({ abi: artifact.abi, functionName: action.name, args }) }
        catch { continue }

        const value = action.stateMutability === 'payable' ? BigInt(Math.floor(Math.random() * 1e16)) : 0n
        let result
        try { result = await evm.call({ from: CALLER, to: DEPLOY_ADDR, data, value }) }
        catch { continue }

        totalSteps++
        sequence.push({ name: action.name, args, success: result.success, value })
        if (!result.success) { reverts++; continue }

        // Check every invariant
        for (const inv of invariants) {
          const invData = encodeFunctionData({ abi: artifact.abi, functionName: inv.name, args: [] })
          let invRes
          try { invRes = await evm.call({ from: CALLER, to: DEPLOY_ADDR, data: invData }) } catch { continue }
          if (!invRes.success) continue
          let decoded
          try { decoded = decodeFunctionResult({ abi: artifact.abi, functionName: inv.name, data: invRes.returnData }) } catch { continue }
          if (decoded === false) {
            broken = { invariant: inv.name, sequence, run: r + 1, step: s + 1 }
            running = false
            break
          }
        }
      }
      if (broken) break
    }

    running = false
    runBtn.classList.remove('hidden')
    stopBtn.classList.add('hidden')

    if (broken) {
      summary.innerHTML = `<span class="error">BROKEN: invariant_${esc(broken.invariant.replace(/^invariant_/, ''))} failed at run ${broken.run}, step ${broken.step}</span>`
      output.innerHTML = renderCounterexample(broken)
    } else {
      summary.innerHTML = `<span class="success">All invariants held across ${runs} runs · ${totalSteps} steps · ${reverts} reverts</span>`
      output.innerHTML = ''
    }
  }
}

function findInvariants(abi) {
  return abi.filter(f =>
    f.type === 'function' &&
    typeof f.name === 'string' &&
    f.name.startsWith('invariant_') &&
    (!f.inputs || f.inputs.length === 0) &&
    f.outputs?.length === 1 &&
    f.outputs[0].type === 'bool' &&
    (f.stateMutability === 'view' || f.stateMutability === 'pure')
  )
}

function findActions(abi) {
  return abi.filter(f =>
    f.type === 'function' &&
    f.stateMutability !== 'view' && f.stateMutability !== 'pure' &&
    typeof f.name === 'string' &&
    !f.name.startsWith('invariant_')
  )
}

function renderCounterexample(broken) {
  let html = '<div class="result-card error">'
  html += `<div style="font-weight:700;margin-bottom:8px">Counter-example sequence (${broken.sequence.length} step${broken.sequence.length === 1 ? '' : 's'})</div>`
  html += '<div class="mono" style="font-size:12px">'
  for (let i = 0; i < broken.sequence.length; i++) {
    const s = broken.sequence[i]
    const cls = s.success ? 'text' : 'text-dim'
    const mark = s.success ? '\u2713' : '\u00D7'
    const argStr = s.args.map(a => fmtArg(a)).join(', ')
    const valStr = s.value && s.value > 0n ? ` {value: ${s.value}}` : ''
    html += `<div class="${cls}"><span style="width:24px;display:inline-block;text-align:right;padding-right:6px">${i + 1}</span>${mark} ${esc(s.name)}(${esc(argStr)})${esc(valStr)}</div>`
  }
  html += '</div></div>'
  return html
}

function fmtArg(v) {
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'string') return v.length > 20 ? v.slice(0, 10) + '..' + v.slice(-4) : v
  if (Array.isArray(v)) return '[' + v.map(fmtArg).join(',') + ']'
  return String(v)
}

// Reasonable-value random generator (mirror of quick-test's)
function randomValue(type) {
  const t = type.replace(/\s/g, '')
  if (t.startsWith('uint')) {
    const bits = parseInt(t.slice(4)) || 256
    const maxVal = 2n ** BigInt(bits) - 1n
    const r = Math.random()
    if (r < 0.2) return 0n
    if (r < 0.3) return 1n
    if (r < 0.4) return maxVal
    const rb = Math.floor(Math.random() * Math.min(bits, 128))
    let val = 0n
    for (let i = 0; i < Math.ceil(rb / 32); i++) val = (val << 32n) | BigInt(Math.floor(Math.random() * 0xFFFFFFFF))
    return val & maxVal
  }
  if (t.startsWith('int')) {
    const bits = parseInt(t.slice(3)) || 256
    const u = randomValue(`uint${bits}`)
    const max = 2n ** (BigInt(bits) - 1n) - 1n
    return u > max ? -(u - max) : u
  }
  if (t === 'address') {
    const choices = [
      '0x0000000000000000000000000000000000000000',
      CALLER,
      '0x000000000000000000000000000000000000dEaD',
      '0x' + [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
    ]
    return choices[Math.floor(Math.random() * choices.length)]
  }
  if (t === 'bool') return Math.random() > 0.5
  if (t === 'string') {
    const len = Math.floor(Math.random() * 32)
    return [...Array(len)].map(() => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')
  }
  if (t === 'bytes32') return '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  if (t === 'bytes') {
    const len = Math.floor(Math.random() * 32)
    return '0x' + [...Array(len * 2)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  }
  if (t.startsWith('bytes')) {
    const n = parseInt(t.slice(5))
    return '0x' + [...Array(n * 2)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  }
  if (t.endsWith('[]')) {
    const base = t.slice(0, -2)
    const len = Math.floor(Math.random() * 5)
    return [...Array(len)].map(() => randomValue(base))
  }
  return 0n
}
