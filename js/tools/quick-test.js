import { createLocalEVM } from '../shared/local-evm.js'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { esc } from '../shared/formatters.js'

const DEPLOY_ADDR = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
const CALLER = '0x5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e'

// ── Value generators ────────────────────────────────────────

function boundaryValues(type) {
  const t = type.replace(/\s/g, '')
  if (t === 'uint256') return [0n, 1n, 2n, 100n, 2n ** 128n, 2n ** 256n - 1n]
  if (t === 'uint128') return [0n, 1n, 2n ** 64n, 2n ** 128n - 1n]
  if (t === 'uint8') return [0n, 1n, 127n, 255n]
  if (t.startsWith('uint')) {
    const bits = parseInt(t.slice(4)) || 256
    return [0n, 1n, 2n ** BigInt(bits) - 1n]
  }
  if (t === 'int256') return [0n, 1n, -1n, 2n ** 255n - 1n, -(2n ** 255n)]
  if (t.startsWith('int')) {
    const bits = parseInt(t.slice(3)) || 256
    return [0n, 1n, -1n, 2n ** (BigInt(bits) - 1n) - 1n, -(2n ** (BigInt(bits) - 1n))]
  }
  if (t === 'address') return [
    '0x0000000000000000000000000000000000000000',
    CALLER,
    '0x000000000000000000000000000000000000dEaD'
  ]
  if (t === 'bool') return [true, false]
  if (t === 'string') return ['', 'a', 'hello world', 'a'.repeat(256)]
  if (t === 'bytes') return ['0x', '0x00', '0x' + 'ff'.repeat(32)]
  if (t === 'bytes32') return ['0x' + '00'.repeat(32), '0x' + 'ff'.repeat(32), '0x' + '01'.padEnd(64, '0')]
  if (t.startsWith('bytes') && !t.endsWith('[]')) {
    const n = parseInt(t.slice(5))
    return ['0x' + '00'.repeat(n), '0x' + 'ff'.repeat(n)]
  }
  if (t.endsWith('[]')) {
    const base = t.slice(0, -2)
    const baseVals = boundaryValues(base)
    return [[], [baseVals[0]], baseVals.slice(0, 3)]
  }
  return [0n]
}

function randomValue(type) {
  const t = type.replace(/\s/g, '')
  if (t.startsWith('uint')) {
    const bits = parseInt(t.slice(4)) || 256
    const maxVal = 2n ** BigInt(bits) - 1n
    // Mix of small, medium, and large values
    const r = Math.random()
    if (r < 0.15) return 0n
    if (r < 0.25) return 1n
    if (r < 0.35) return maxVal
    const randomBits = Math.floor(Math.random() * bits)
    let val = 0n
    for (let i = 0; i < Math.ceil(randomBits / 32); i++) {
      val = (val << 32n) | BigInt(Math.floor(Math.random() * 0xFFFFFFFF))
    }
    return val & maxVal
  }
  if (t.startsWith('int')) {
    const bits = parseInt(t.slice(3)) || 256
    const maxVal = 2n ** (BigInt(bits) - 1n) - 1n
    const minVal = -(2n ** (BigInt(bits) - 1n))
    const uVal = randomValue(`uint${bits}`)
    return uVal > maxVal ? minVal + (uVal & maxVal) : uVal
  }
  if (t === 'address') {
    const hex = [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
    return '0x' + hex
  }
  if (t === 'bool') return Math.random() > 0.5
  if (t === 'string') {
    const len = Math.floor(Math.random() * 64)
    return [...Array(len)].map(() => String.fromCharCode(32 + Math.floor(Math.random() * 95))).join('')
  }
  if (t === 'bytes32') return '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  if (t === 'bytes') {
    const len = Math.floor(Math.random() * 128)
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

function generateTestCases(fnAbi) {
  const inputs = fnAbi.inputs || []
  if (inputs.length === 0) return [{ name: 'No params', args: [] }]

  const cases = []

  // For each param, generate boundary values while keeping others at safe defaults
  for (let i = 0; i < inputs.length; i++) {
    const bv = boundaryValues(inputs[i].type)
    for (const val of bv) {
      const args = inputs.map((inp, j) => {
        if (j === i) return val
        return safeDefault(inp.type)
      })
      const label = `${inputs[i].name || 'arg' + i}=${formatArg(val)}`
      cases.push({ name: label, args })
    }
  }

  return cases
}

function safeDefault(type) {
  if (type === 'bool') return false
  if (type === 'address') return CALLER
  if (type === 'string') return 'test'
  if (type === 'bytes') return '0x00'
  if (type.startsWith('bytes')) return '0x' + '00'.repeat(parseInt(type.slice(5)) || 32)
  if (type.endsWith('[]')) return []
  return 1n // safe nonzero for uints
}

function formatArg(val) {
  if (typeof val === 'bigint') {
    const s = val.toString()
    return s.length > 20 ? s.slice(0, 8) + '...' + s.slice(-4) : s
  }
  if (typeof val === 'string' && val.startsWith('0x')) return val.slice(0, 10) + (val.length > 10 ? '...' : '')
  if (Array.isArray(val)) return `[${val.length}]`
  return String(val)
}

// ── Main render ─────────────────────────────────────────────

export function render(container, queryParams = {}) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Quick Test / Fuzz</h2>
      <p class="tool-desc">Deploy a contract locally and run deterministic boundary tests or fuzz it with random inputs.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Contract artifact <span class="text-dim">(paste Hardhat/Foundry JSON, or use "Open in Quick Test" from the IDE)</span></label>
        <textarea id="qt-input" class="mono-input" rows="4" placeholder='{"contractName":"...","abi":[...],"deployedBytecode":"0x..."}' spellcheck="false"></textarea>
        <div id="qt-load-status" class="status-line"></div>
      </div>
      <div id="qt-controls" class="hidden">
        <div class="input-row" style="gap:8px;align-items:flex-end">
          <div class="input-group" style="width:200px">
            <label>Function</label>
            <select id="qt-fn" class="mono-input"></select>
          </div>
          <div class="input-group" style="width:120px">
            <label>Mode</label>
            <select id="qt-mode" class="mono-input">
              <option value="quick">Quick Test</option>
              <option value="fuzz">Fuzz</option>
            </select>
          </div>
          <div class="input-group hidden" id="qt-iters-group" style="width:120px">
            <label>Iterations</label>
            <select id="qt-iters" class="mono-input">
              <option value="50">50</option>
              <option value="100" selected>100</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
            </select>
          </div>
          <button id="qt-run" class="btn btn-primary">Run</button>
          <button id="qt-stop" class="btn hidden">Stop</button>
        </div>
      </div>
      <div id="qt-progress" class="status-line"></div>
      <div id="qt-output" class="output-area"></div>
    </div>
  `

  const artifactInput = document.getElementById('qt-input')
  const loadStatus = document.getElementById('qt-load-status')
  const controls = document.getElementById('qt-controls')
  const fnSelect = document.getElementById('qt-fn')
  const modeSelect = document.getElementById('qt-mode')
  const itersGroup = document.getElementById('qt-iters-group')
  const itersSelect = document.getElementById('qt-iters')
  const runBtn = document.getElementById('qt-run')
  const stopBtn = document.getElementById('qt-stop')
  const progress = document.getElementById('qt-progress')
  const output = document.getElementById('qt-output')

  let artifact = null
  let client = null
  let running = false

  // Check for artifact from IDE
  try {
    const fromIde = sessionStorage.getItem('anywei_test_artifact')
    if (fromIde) {
      artifact = JSON.parse(fromIde)
      artifactInput.value = JSON.stringify(artifact, null, 2)
      sessionStorage.removeItem('anywei_test_artifact')
      loadArtifact()
    }
  } catch {}

  modeSelect.addEventListener('change', () => {
    itersGroup.classList.toggle('hidden', modeSelect.value !== 'fuzz')
  })

  artifactInput.addEventListener('change', parseInput)
  artifactInput.addEventListener('paste', () => setTimeout(parseInput, 50))
  runBtn.addEventListener('click', run)
  stopBtn.addEventListener('click', () => { running = false })

  function parseInput() {
    try {
      const raw = artifactInput.value.trim()
      const parsed = JSON.parse(raw)
      artifact = {
        contractName: parsed.contractName || 'Contract',
        abi: parsed.abi || (Array.isArray(parsed) ? parsed : null),
        deployedBytecode: parsed.deployedBytecode || (parsed.bytecode?.object ? '0x' + parsed.bytecode.object : parsed.bytecode) || null
      }
      if (!artifact.abi) throw new Error('No ABI found')
      loadArtifact()
    } catch (e) {
      loadStatus.innerHTML = `<span class="error">${esc(e.message)}</span>`
      controls.classList.add('hidden')
    }
  }

  function loadArtifact() {
    if (!artifact?.abi) return
    loadStatus.innerHTML = `<span class="success">${esc(artifact.contractName)} loaded</span>`

    const fns = artifact.abi.filter(e => e.type === 'function')
    fnSelect.innerHTML = fns.map((fn, i) =>
      `<option value="${i}">${esc(fn.name)}(${(fn.inputs || []).map(p => p.type).join(',')})</option>`
    ).join('')

    controls.classList.remove('hidden')
  }

  async function deploy() {
    if (client) return client

    progress.innerHTML = '<span class="loading">Initializing local EVM...</span>'
    client = await createLocalEVM()

    // Deploy contract and fund caller in one step
    if (artifact.deployedBytecode && artifact.deployedBytecode !== '0x') {
      await client.setup({ contractCode: artifact.deployedBytecode, contractAddress: DEPLOY_ADDR, callerAddress: CALLER })
      progress.innerHTML = '<span class="success">Contract deployed locally</span>'
    } else {
      await client.createAccount(CALLER, { balance: 10n ** 24n })
      progress.innerHTML = '<span class="warning">No bytecode &mdash; running against ABI only (view functions)</span>'
    }

    return client
  }

  async function runCall(c, fnAbi, args) {
    const data = encodeFunctionData({ abi: artifact.abi, functionName: fnAbi.name, args })
    const start = performance.now()

    let result
    try {
      result = await c.call({ from: CALLER, to: DEPLOY_ADDR, data })
    } catch (err) {
      return { success: false, gas: 0n, error: err.message || String(err), duration: performance.now() - start }
    }

    const duration = performance.now() - start

    let decoded = null
    if (result.success && fnAbi.outputs?.length && result.returnData && result.returnData !== '0x') {
      try { decoded = decodeFunctionResult({ abi: artifact.abi, functionName: fnAbi.name, data: result.returnData }) } catch {}
    }

    return { success: result.success, gas: result.executionGasUsed, decoded, error: result.error, duration, data }
  }

  async function runTraceCall(c, fnAbi, args) {
    const data = encodeFunctionData({ abi: artifact.abi, functionName: fnAbi.name, args })
    const result = await c.traceCall({ from: CALLER, to: DEPLOY_ADDR, data })
    let decoded = null
    if (result.success && fnAbi.outputs?.length && result.returnData && result.returnData !== '0x') {
      try { decoded = decodeFunctionResult({ abi: artifact.abi, functionName: fnAbi.name, data: result.returnData }) } catch {}
    }
    return { ...result, decoded, args }
  }

  function renderTraceViewer(traceResult, fnAbi, args) {
    const steps = traceResult.trace || []
    const status = traceResult.success ? '<span class="success">SUCCESS</span>' : '<span class="error">REVERTED</span>'

    // Editable params for re-run
    const inputs = fnAbi.inputs || []
    let paramsHtml = '<div class="trace-params"><div class="trace-params-header">Parameters (edit and re-run)</div>'
    for (let i = 0; i < inputs.length; i++) {
      paramsHtml += `<div class="input-group" style="margin-bottom:4px"><label style="font-size:10px"><span class="text-purple">${esc(inputs[i].name || 'arg' + i)}</span> <span class="text-dim">${esc(inputs[i].type)}</span></label><input type="text" class="mono-input trace-param-input" data-idx="${i}" value="${esc(formatArg(args[i]))}" spellcheck="false" style="font-size:11px;padding:3px 6px"></div>`
    }
    paramsHtml += '<button class="btn btn-primary trace-rerun" style="margin-top:4px;font-size:11px;padding:4px 12px">Re-run with Trace</button></div>'

    // Trace listing
    let traceHtml = '<div class="trace-listing">'
    traceHtml += '<div class="trace-header-row"><span class="trace-col-pc">PC</span><span class="trace-col-op">Opcode</span><span class="trace-col-gas">Gas Left</span><span class="trace-col-stack">Stack (top 4)</span></div>'

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const cls = s.isStorage ? 'trace-storage' : s.isCall ? 'trace-call' : s.isHalt ? 'trace-halt' : s.isLog ? 'trace-log' : ''
      const stackTop = s.stack.slice(-4).reverse().map(v => v.length > 18 ? v.slice(0, 8) + '..' + v.slice(-4) : v).join(' ')

      traceHtml += `<div class="trace-row ${cls}" data-step="${i}" tabindex="0">
        <span class="trace-col-pc">${s.pc.toString(16).padStart(4, '0')}</span>
        <span class="trace-col-op">${s.opcode}</span>
        <span class="trace-col-gas">${s.gasLeft.toString()}</span>
        <span class="trace-col-stack">${esc(stackTop)}</span>
      </div>`
    }
    traceHtml += '</div>'

    // Full stack detail panel (shown on click)
    const detailHtml = '<div id="trace-detail" class="trace-detail"><div class="text-dim">Click a step to inspect full stack</div></div>'

    output.innerHTML = `
      <div class="result-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>${status} <span class="text-dim">&middot; ${steps.length} steps &middot; Gas: ${traceResult.executionGasUsed.toString()}</span></div>
          <button class="btn trace-back" style="font-size:11px;padding:3px 10px">&larr; Back to results</button>
        </div>
        ${paramsHtml}
        <div style="display:flex;gap:8px;margin-top:8px">
          <div style="flex:1;min-width:0">${traceHtml}</div>
          <div style="width:280px;flex-shrink:0">${detailHtml}</div>
        </div>
      </div>
    `

    // Back button
    output.querySelector('.trace-back').addEventListener('click', () => run())

    // Re-run button
    output.querySelector('.trace-rerun').addEventListener('click', async () => {
      const paramEls = output.querySelectorAll('.trace-param-input')
      const newArgs = inputs.map((inp, i) => coerceArg(paramEls[i]?.value?.trim() || '', inp.type))
      progress.innerHTML = '<span class="loading">Re-running with trace...</span>'
      client = null
      const c = await deploy()
      const newResult = await runTraceCall(c, fnAbi, newArgs)
      renderTraceViewer(newResult, fnAbi, newArgs)
      progress.innerHTML = ''
    })

    // Click step to show detail
    output.querySelectorAll('.trace-row').forEach(row => {
      row.addEventListener('click', () => {
        output.querySelectorAll('.trace-row').forEach(r => r.classList.remove('trace-row-selected'))
        row.classList.add('trace-row-selected')
        const idx = parseInt(row.dataset.step)
        const s = steps[idx]
        const detail = document.getElementById('trace-detail')
        detail.innerHTML = `
          <div class="trace-detail-title">Step ${idx}</div>
          <div class="trace-detail-row"><span class="text-dim">PC:</span> <span class="mono">0x${s.pc.toString(16)}</span></div>
          <div class="trace-detail-row"><span class="text-dim">Opcode:</span> <span class="mono">${s.opcode}</span></div>
          <div class="trace-detail-row"><span class="text-dim">Gas fee:</span> <span class="mono">${s.opcodeFee}</span></div>
          <div class="trace-detail-row"><span class="text-dim">Gas left:</span> <span class="mono">${s.gasLeft.toString()}</span></div>
          <div class="trace-detail-row"><span class="text-dim">Depth:</span> <span class="mono">${s.depth}</span></div>
          <div class="trace-detail-section">Stack (${s.stack.length} items, top first)</div>
          ${s.stack.slice().reverse().map((v, i) => `<div class="trace-stack-item"><span class="text-dim">${i}</span> <span class="mono" style="word-break:break-all">${v}</span></div>`).join('')}
        `
      })
    })
  }

  function coerceArg(raw, type) {
    if (!raw && type !== 'string') {
      if (type === 'bool') return false
      if (type === 'address') return CALLER
      if (type.startsWith('uint') || type.startsWith('int')) return 0n
      if (type.startsWith('bytes')) return '0x'
      return ''
    }
    if (type === 'bool') return raw === 'true' || raw === '1'
    if (type === 'address') return raw
    if (type.startsWith('uint') || type.startsWith('int')) return BigInt(raw.replace(/,/g, ''))
    if (type.startsWith('bytes')) return raw.startsWith('0x') ? raw : '0x' + raw
    if (type.endsWith('[]')) { try { return JSON.parse(raw) } catch { return raw.split(',').map(s => s.trim()) } }
    return raw
  }

  async function run() {
    const fns = artifact.abi.filter(e => e.type === 'function')
    const fnAbi = fns[parseInt(fnSelect.value)]
    if (!fnAbi) return

    running = true
    runBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    output.innerHTML = ''

    // Reset client for clean state each run
    client = null
    const c = await deploy()

    const mode = modeSelect.value

    if (mode === 'quick') {
      await runQuickTest(c, fnAbi)
    } else {
      await runFuzz(c, fnAbi, parseInt(itersSelect.value))
    }

    running = false
    runBtn.classList.remove('hidden')
    stopBtn.classList.add('hidden')
  }

  async function runQuickTest(c, fnAbi) {
    const cases = generateTestCases(fnAbi)
    progress.innerHTML = `<span class="loading">Running ${cases.length} test cases...</span>`

    let passCount = 0, failCount = 0
    const testResults = [] // store for trace button access
    let html = `<div class="result-card"><table class="params-table"><thead><tr><th></th><th>Test Case</th><th>Gas</th><th>Result</th><th></th></tr></thead><tbody>`

    for (let i = 0; i < cases.length; i++) {
      if (!running) break
      progress.innerHTML = `<span class="loading">${i + 1}/${cases.length}...</span>`

      const tc = cases[i]
      const result = await runCall(c, fnAbi, tc.args)

      if (result.success) passCount++
      else failCount++

      testResults.push({ tc, result })

      html += `<tr class="${result.success ? '' : 'diff-item-changed'}">
        <td>${result.success ? '<span class="success">PASS</span>' : '<span class="error">FAIL</span>'}</td>
        <td class="mono" style="font-size:11px">${esc(tc.name)}</td>
        <td class="mono text-dim">${result.gas > 0n ? Number(result.gas).toLocaleString() : '-'}</td>
        <td class="mono" style="font-size:11px">${result.error ? '<span class="error">' + esc(result.error.slice(0, 80)) + '</span>' : (result.decoded != null ? esc(formatArg(result.decoded)) : 'OK')}</td>
        <td><button class="btn-copy qt-trace-btn" data-idx="${i}" style="font-size:10px">Trace</button></td>
      </tr>`

      // Reset client state between tests for isolation
      client = null
      await deploy()
    }

    html += '</tbody></table></div>'
    progress.innerHTML = `<span class="${failCount > 0 ? 'warning' : 'success'}">${passCount} passed, ${failCount} failed out of ${passCount + failCount} tests</span>`
    output.innerHTML = html

    // Bind trace buttons
    output.querySelectorAll('.qt-trace-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx)
        const { tc } = testResults[idx]
        btn.textContent = '...'
        btn.disabled = true
        progress.innerHTML = '<span class="loading">Tracing...</span>'
        client = null
        const c2 = await deploy()
        const traceResult = await runTraceCall(c2, fnAbi, tc.args)
        renderTraceViewer(traceResult, fnAbi, tc.args)
        progress.innerHTML = ''
      })
    })
  }

  async function runFuzz(c, fnAbi, iterations) {
    const inputs = fnAbi.inputs || []
    let passCount = 0, failCount = 0
    let gasMin = BigInt(Number.MAX_SAFE_INTEGER), gasMax = 0n, gasTotal = 0n
    const failures = []

    for (let i = 0; i < iterations; i++) {
      if (!running) break
      if (i % 10 === 0) progress.innerHTML = `<span class="loading">Fuzz ${i + 1}/${iterations} &mdash; ${passCount} pass, ${failCount} fail</span>`

      const args = inputs.map(inp => randomValue(inp.type))
      const result = await runCall(c, fnAbi, args)

      if (result.success) {
        passCount++
        if (result.gas > 0n) {
          if (result.gas < gasMin) gasMin = result.gas
          if (result.gas > gasMax) gasMax = result.gas
          gasTotal += result.gas
        }
      } else {
        failCount++
        if (failures.length < 20) {
          failures.push({ args: args.map(a => formatArg(a)), error: result.error })
        }
      }
    }

    const total = passCount + failCount
    const gasAvg = passCount > 0 ? gasTotal / BigInt(passCount) : 0n

    let html = `<div class="result-card">
      <div class="diff-summary">
        <span class="success">${passCount} passed</span>
        <span class="${failCount > 0 ? 'error' : 'text-dim'}">${failCount} reverted</span>
        <span class="text-dim">/ ${total} iterations</span>
      </div>`

    if (passCount > 0) {
      html += `<div style="margin-top:8px">
        <table class="params-table"><thead><tr><th>Gas Stat</th><th>Value</th></tr></thead><tbody>
          <tr><td>Min</td><td class="mono">${Number(gasMin).toLocaleString()}</td></tr>
          <tr><td>Avg</td><td class="mono">${Number(gasAvg).toLocaleString()}</td></tr>
          <tr><td>Max</td><td class="mono">${Number(gasMax).toLocaleString()}</td></tr>
        </tbody></table>
      </div>`
    }

    if (failures.length > 0) {
      html += `<div style="margin-top:12px"><span class="error">Failing inputs (first ${failures.length}):</span></div>
        <table class="params-table" style="margin-top:4px"><thead><tr><th>Args</th><th>Error</th></tr></thead><tbody>`
      for (const f of failures) {
        html += `<tr>
          <td class="mono" style="font-size:11px">${esc(f.args.join(', '))}</td>
          <td class="mono error" style="font-size:11px">${esc((f.error || '').slice(0, 100))}</td>
        </tr>`
      }
      html += '</tbody></table>'
    }

    html += '</div>'
    progress.innerHTML = `<span class="${failCount > 0 ? 'warning' : 'success'}">Fuzz complete: ${passCount} pass, ${failCount} fail</span>`
    output.innerHTML = html
  }
}
