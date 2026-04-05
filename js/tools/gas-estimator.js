import { encodeFunctionData, toFunctionSelector } from 'viem'
import { createLocalEVM } from '../shared/local-evm.js'
import { fetchAbi } from '../shared/abi-cache.js'
import { fetchRecentTxs, getPriceData } from '../shared/etherscan.js'
import { esc, ensure0x } from '../shared/formatters.js'

const DEPLOY_ADDR = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
const CALLER = '0x5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Gas Estimator</h2>
      <p class="tool-desc">Estimate gas costs for deployed contracts (historical) or your own contracts (local EVM).</p>
    </div>
    <div class="tool-body">
      <div class="mode-tabs">
        <button class="mode-btn active" data-mode="deployed">Deployed Contract</button>
        <button class="mode-btn" data-mode="local">Local / Custom Bytecode</button>
      </div>
      <div id="gas-deployed-section">
        <div class="input-group">
          <label>Contract address</label>
          <input type="text" id="gas-addr" class="mono-input" placeholder="0x..." spellcheck="false">
          <div id="gas-deploy-status" class="status-line"></div>
        </div>
        <div id="gas-fn-section" class="hidden">
          <div class="input-group">
            <label>Function</label>
            <select id="gas-fn" class="mono-input"></select>
          </div>
        </div>
      </div>
      <div id="gas-local-section" class="hidden">
        <div class="input-group">
          <label>Contract artifact <span class="text-dim">(Hardhat/Foundry JSON)</span></label>
          <textarea id="gas-artifact" class="mono-input" rows="8" placeholder='{"abi":[...],"deployedBytecode":"0x..."}' spellcheck="false"></textarea>
          <div id="gas-local-status" class="status-line"></div>
        </div>
        <div id="gas-local-fn-section" class="hidden">
          <div class="input-group">
            <label>Function</label>
            <select id="gas-local-fn" class="mono-input"></select>
          </div>
          <div id="gas-local-params"></div>
          <div style="display:flex;gap:8px">
            <button id="gas-local-run" class="btn btn-primary">Estimate Gas</button>
            <button id="gas-local-random" class="btn">Fill All Random</button>
            <button id="gas-local-deploy" class="btn">Deploy Cost</button>
          </div>
        </div>
      </div>
      <div id="gas-output" class="output-area"></div>
    </div>
  `

  let mode = 'deployed'
  let deployedAbi = null
  let deployedAddr = null
  let recentTxs = []
  let localArtifact = null
  let localClient = null

  // ── Mode switching ──
  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      mode = btn.dataset.mode
      document.getElementById('gas-deployed-section').classList.toggle('hidden', mode !== 'deployed')
      document.getElementById('gas-local-section').classList.toggle('hidden', mode !== 'local')
      document.getElementById('gas-output').innerHTML = ''
    })
  })

  // ── Deployed contract: historical gas ──
  const addrInput = document.getElementById('gas-addr')
  const deployStatus = document.getElementById('gas-deploy-status')
  const fnSection = document.getElementById('gas-fn-section')
  const fnSelect = document.getElementById('gas-fn')

  addrInput.addEventListener('change', loadDeployed)
  addrInput.addEventListener('paste', () => setTimeout(loadDeployed, 50))
  fnSelect.addEventListener('change', analyzeHistorical)

  async function loadDeployed() {
    const addr = addrInput.value.trim()
    if (!addr || addr.length !== 42) return
    deployedAddr = addr

    deployStatus.innerHTML = '<span class="loading">Loading...</span>'
    document.getElementById('gas-output').innerHTML = ''

    try {
      const [abiResult, txResult] = await Promise.all([
        fetchAbi(addr),
        fetchRecentTxs(addr, 100)
      ])

      deployedAbi = abiResult.abi
      recentTxs = txResult

      if (!deployedAbi) {
        deployStatus.innerHTML = '<span class="error">Contract not verified</span>'
        return
      }

      // Compute selectors for each function
      const fns = deployedAbi.filter(e => e.type === 'function' && e.stateMutability !== 'view' && e.stateMutability !== 'pure')

      // Count txs per selector
      const txCounts = new Map()
      for (const tx of recentTxs) {
        if (!tx.input || tx.input.length < 10) continue
        txCounts.set(tx.input.slice(0, 10).toLowerCase(), (txCounts.get(tx.input.slice(0, 10).toLowerCase()) || 0) + 1)
      }

      fnSelect.innerHTML = '<option value="">-- select function --</option>'
      for (const fn of fns) {
        const sig = `${fn.name}(${(fn.inputs || []).map(i => i.type).join(',')})`
        let sel
        try { sel = toFunctionSelector(sig) } catch { continue }
        const count = txCounts.get(sel.toLowerCase()) || 0
        fnSelect.innerHTML += `<option value="${sel.toLowerCase()}" data-name="${esc(fn.name)}">${esc(fn.name)} (${count} txs)</option>`
      }

      deployStatus.innerHTML = `<span class="success">${esc(abiResult.contractName || 'Loaded')} &mdash; ${recentTxs.length} recent txs</span>`
      fnSection.classList.remove('hidden')
    } catch (e) {
      deployStatus.innerHTML = `<span class="error">${esc(e.message)}</span>`
    }
  }

  async function analyzeHistorical() {
    const sel = fnSelect.value
    const output = document.getElementById('gas-output')
    if (!sel) { output.innerHTML = ''; return }

    const matching = recentTxs.filter(tx => tx.input?.slice(0, 10).toLowerCase() === sel)
    if (matching.length === 0) {
      output.innerHTML = '<div class="result-card text-dim">No recent transactions for this function.</div>'
      return
    }

    const gasValues = matching.map(tx => parseInt(tx.gasUsed)).filter(g => g > 0).sort((a, b) => a - b)
    if (gasValues.length === 0) { output.innerHTML = '<div class="result-card text-dim">No gas data.</div>'; return }

    const min = gasValues[0]
    const max = gasValues[gasValues.length - 1]
    const median = gasValues[Math.floor(gasValues.length / 2)]
    const avg = Math.round(gasValues.reduce((a, b) => a + b, 0) / gasValues.length)

    let prices
    try { prices = await getPriceData() } catch { prices = { gasPrice: 10000000000n, ethPrice: 0 } }
    const gweiPrice = Number(prices.gasPrice) / 1e9
    const ethPrice = prices.ethPrice

    function costRow(gas, label) {
      const costEth = (gas * Number(prices.gasPrice)) / 1e18
      const costUsd = costEth * ethPrice
      return `<tr><td>${label}</td><td class="mono">${gas.toLocaleString()}</td><td class="mono">${costEth.toFixed(6)} ETH</td><td class="mono">${costUsd > 0.01 ? '$' + costUsd.toFixed(2) : '< $0.01'}</td></tr>`
    }

    output.innerHTML = `<div class="result-card">
      <div class="text-dim">${gasValues.length} transactions sampled</div>
      <table class="params-table" style="margin-top:8px">
        <thead><tr><th>Stat</th><th>Gas</th><th>Cost (ETH)</th><th>Cost (USD)</th></tr></thead>
        <tbody>
          ${costRow(min, 'Min')}
          ${costRow(median, 'Median')}
          ${costRow(avg, 'Average')}
          ${costRow(max, 'Max')}
        </tbody>
      </table>
      <div style="margin-top:12px"><span class="text-dim">Gas price: ${gweiPrice.toFixed(2)} gwei &middot; ETH: $${ethPrice.toLocaleString()}</span></div>
      <div style="margin-top:8px"><span class="text-dim">Cost at different gas prices:</span></div>
      <table class="params-table" style="margin-top:4px">
        <thead><tr><th>Gas Price</th><th>Cost (ETH)</th><th>Cost (USD)</th></tr></thead>
        <tbody>${[10, 25, 50, 100].map(g => {
          const cEth = (median * g * 1e9) / 1e18
          const cUsd = cEth * ethPrice
          return `<tr><td>${g} gwei</td><td class="mono">${cEth.toFixed(6)} ETH</td><td class="mono">${cUsd > 0.01 ? '$' + cUsd.toFixed(2) : '< $0.01'}</td></tr>`
        }).join('')}</tbody>
      </table>
    </div>`
  }

  // ── Local contract: TEVM eth_estimateGas ──
  const artifactInput = document.getElementById('gas-artifact')
  const localStatus = document.getElementById('gas-local-status')
  const localFnSection = document.getElementById('gas-local-fn-section')
  const localFnSelect = document.getElementById('gas-local-fn')
  const localParams = document.getElementById('gas-local-params')
  const localRunBtn = document.getElementById('gas-local-run')

  // Check for artifact from IDE — auto-load if found
  try {
    const fromIde = localStorage.getItem('anywei_compiled')
    if (fromIde) {
      const all = JSON.parse(fromIde)
      const first = Object.values(all)[0]
      if (first) {
        artifactInput.value = JSON.stringify(first, null, 2)
        // Trigger load after event listeners are bound
        setTimeout(loadLocal, 0)
      }
    }
  } catch {}

  const localRandomBtn = document.getElementById('gas-local-random')

  artifactInput.addEventListener('change', loadLocal)
  artifactInput.addEventListener('paste', () => setTimeout(loadLocal, 50))
  localFnSelect.addEventListener('change', buildLocalParams)
  localRunBtn.addEventListener('click', estimateLocal)
  localRandomBtn.addEventListener('click', fillRandom)
  document.getElementById('gas-local-deploy').addEventListener('click', estimateDeployCost)

  function loadLocal() {
    try {
      const raw = artifactInput.value.trim()
      const parsed = JSON.parse(raw)
      localArtifact = {
        abi: parsed.abi || (Array.isArray(parsed) ? parsed : null),
        deployedBytecode: parsed.deployedBytecode || (parsed.bytecode?.object ? '0x' + parsed.bytecode.object : parsed.bytecode) || null,
        creationBytecode: (parsed.bytecode?.object && typeof parsed.bytecode === 'object') ? '0x' + parsed.bytecode.object
          : (typeof parsed.bytecode === 'string' ? (parsed.bytecode.startsWith('0x') ? parsed.bytecode : '0x' + parsed.bytecode) : null),
      }
      if (!localArtifact.abi) throw new Error('No ABI found')
      if (!localArtifact.deployedBytecode || localArtifact.deployedBytecode === '0x') throw new Error('No bytecode found')

      const fns = localArtifact.abi.filter(e => e.type === 'function')
      localFnSelect.innerHTML = fns.map((fn, i) =>
        `<option value="${i}">${esc(fn.name)}(${(fn.inputs || []).map(p => p.type).join(', ')})</option>`
      ).join('')
      localStatus.innerHTML = '<span class="success">Artifact loaded</span>'
      localFnSection.classList.remove('hidden')
      localClient = null // reset client
      buildLocalParams()
    } catch (e) {
      localStatus.innerHTML = `<span class="error">${esc(e.message)}</span>`
      localFnSection.classList.add('hidden')
    }
  }

  function buildLocalParams() {
    const fns = localArtifact.abi.filter(e => e.type === 'function')
    const fn = fns[parseInt(localFnSelect.value)]
    if (!fn) { localParams.innerHTML = ''; return }
    const inputs = fn.inputs || []
    localParams.innerHTML = inputs.map((inp, i) => `
      <div class="input-group">
        <label><span class="text-purple">${esc(inp.name || `arg${i}`)}</span> <span class="text-dim">${esc(inp.type)}</span></label>
        <input type="text" class="mono-input local-param" data-idx="${i}" placeholder="${esc(inp.type)}" spellcheck="false">
      </div>
    `).join('') + (fn.stateMutability === 'payable' ? `
      <div class="input-group">
        <label>ETH value <span class="text-dim">(wei)</span></label>
        <input type="text" class="mono-input" id="gas-local-value" placeholder="0" spellcheck="false">
      </div>` : '')
  }

  function fillRandom() {
    const fns = localArtifact.abi.filter(e => e.type === 'function')
    const fn = fns[parseInt(localFnSelect.value)]
    if (!fn) return
    const inputs = fn.inputs || []
    const paramEls = localParams.querySelectorAll('.local-param')
    for (let i = 0; i < inputs.length && i < paramEls.length; i++) {
      paramEls[i].value = randomValue(inputs[i].type)
    }
  }

  async function estimateLocal() {
    const fns = localArtifact.abi.filter(e => e.type === 'function')
    const fn = fns[parseInt(localFnSelect.value)]
    if (!fn) return

    const output = document.getElementById('gas-output')
    localRunBtn.disabled = true
    localRunBtn.textContent = 'Estimating...'
    output.innerHTML = '<div class="loading">Deploying contract locally...</div>'

    try {
      // Create fresh local EVM
      if (!localClient) {
        localClient = await createLocalEVM()
        await localClient.setup({ contractCode: localArtifact.deployedBytecode, contractAddress: DEPLOY_ADDR, callerAddress: CALLER })
      }

      // Collect params
      const inputs = fn.inputs || []
      const paramEls = localParams.querySelectorAll('.local-param')
      const args = inputs.map((inp, i) => coerceParam(paramEls[i]?.value?.trim() || '', inp.type))
      const data = encodeFunctionData({ abi: localArtifact.abi, functionName: fn.name, args })

      const valueInput = document.getElementById('gas-local-value')
      const value = valueInput?.value.trim() ? BigInt(valueInput.value.trim()) : 0n

      output.innerHTML = '<div class="loading">Estimating gas on local EVM...</div>'

      const gasEstimate = Number(await localClient.estimateGas({ from: CALLER, to: DEPLOY_ADDR, data, value }))

      let prices
      try { prices = await getPriceData() } catch { prices = { gasPrice: 10000000000n, ethPrice: 0 } }
      const gweiPrice = Number(prices.gasPrice) / 1e9
      const ethPrice = prices.ethPrice
      const costEth = (gasEstimate * Number(prices.gasPrice)) / 1e18
      const costUsd = costEth * ethPrice
      const execGas = gasEstimate > 21000 ? gasEstimate - 21000 : 0

      output.innerHTML = `<div class="result-card">
        <div style="margin-bottom:8px"><span class="success" style="font-weight:700">SUCCESS</span> <span class="text-dim">(local EVM)</span></div>
        <table class="params-table">
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Total gas</td><td class="mono">${gasEstimate.toLocaleString()}</td></tr>
            <tr><td>Intrinsic</td><td class="mono">21,000</td></tr>
            <tr><td>Execution</td><td class="mono">${execGas.toLocaleString()}</td></tr>
            <tr><td>Cost (ETH)</td><td class="mono">${costEth.toFixed(6)} ETH</td></tr>
            <tr><td>Cost (USD)</td><td class="mono">${costUsd > 0.01 ? '$' + costUsd.toFixed(2) : '< $0.01'}</td></tr>
          </tbody>
        </table>
        <div style="margin-top:12px"><span class="text-dim">Gas price: ${gweiPrice.toFixed(2)} gwei &middot; ETH: $${ethPrice.toLocaleString()}</span></div>
        <div style="margin-top:8px"><span class="text-dim">Cost at different gas prices:</span></div>
        <table class="params-table" style="margin-top:4px">
          <thead><tr><th>Gas Price</th><th>Cost (ETH)</th><th>Cost (USD)</th></tr></thead>
          <tbody>${[10, 25, 50, 100].map(g => {
            const cEth = (gasEstimate * g * 1e9) / 1e18
            const cUsd = cEth * ethPrice
            return `<tr><td>${g} gwei</td><td class="mono">${cEth.toFixed(6)} ETH</td><td class="mono">${cUsd > 0.01 ? '$' + cUsd.toFixed(2) : '< $0.01'}</td></tr>`
          }).join('')}</tbody>
        </table>
      </div>`
    } catch (e) {
      output.innerHTML = `<div class="result-card error">
        <div style="font-weight:700;margin-bottom:8px">FAILED</div>
        <div class="mono" style="font-size:12px;word-break:break-all">${esc(e.message || String(e))}</div>
      </div>`
    }

    localRunBtn.disabled = false
    localRunBtn.textContent = 'Estimate Gas'
  }

  async function estimateDeployCost() {
    const output = document.getElementById('gas-output')
    if (!localArtifact?.creationBytecode) {
      output.innerHTML = '<div class="result-card error">Artifact has no creation bytecode — paste a Hardhat/Foundry artifact or use an IDE-compiled contract.</div>'
      return
    }
    output.innerHTML = '<div class="loading">Running constructor on local EVM...</div>'
    try {
      // Fresh EVM — don't share with estimateLocal's persistent client
      const evm = await createLocalEVM()

      // Calldata gas: 4 per zero byte, 16 per non-zero byte
      const codeHex = localArtifact.creationBytecode.startsWith('0x') ? localArtifact.creationBytecode.slice(2) : localArtifact.creationBytecode
      let calldataGas = 0
      for (let i = 0; i < codeHex.length; i += 2) {
        calldataGas += parseInt(codeHex.slice(i, i + 2), 16) === 0 ? 4 : 16
      }
      const codeBytes = codeHex.length / 2

      // Constructor execution gas via actual deploy
      const deployResult = await evm.deploy({ from: CALLER, bytecode: localArtifact.creationBytecode })
      const execGas = Number(deployResult.gasUsed)
      const deployedBytes = (deployResult.deployedBytecode.length - 2) / 2

      // Fees
      const txBaseGas = 21000
      const createGas = 32000 // G_txcreate
      const totalGas = txBaseGas + createGas + calldataGas + execGas

      let prices
      try { prices = await getPriceData() } catch { prices = { gasPrice: 10000000000n, ethPrice: 0 } }
      const gweiPrice = Number(prices.gasPrice) / 1e9
      const ethPrice = prices.ethPrice
      const costEth = (totalGas * Number(prices.gasPrice)) / 1e18
      const costUsd = costEth * ethPrice

      output.innerHTML = `<div class="result-card">
        <div style="margin-bottom:8px"><span class="success" style="font-weight:700">DEPLOY COST</span> <span class="text-dim">(local EVM)</span></div>
        <table class="params-table">
          <thead><tr><th>Component</th><th>Gas</th><th class="text-dim">Note</th></tr></thead>
          <tbody>
            <tr><td>Intrinsic (tx)</td><td class="mono">${txBaseGas.toLocaleString()}</td><td class="text-dim">base transaction</td></tr>
            <tr><td>Create</td><td class="mono">${createGas.toLocaleString()}</td><td class="text-dim">G_txcreate</td></tr>
            <tr><td>Calldata</td><td class="mono">${calldataGas.toLocaleString()}</td><td class="text-dim">${codeBytes.toLocaleString()} bytes of creation code</td></tr>
            <tr><td>Constructor</td><td class="mono">${execGas.toLocaleString()}</td><td class="text-dim">includes ${deployedBytes.toLocaleString()}B code storage</td></tr>
            <tr style="border-top:1px solid var(--border)"><td><strong>Total</strong></td><td class="mono"><strong>${totalGas.toLocaleString()}</strong></td><td></td></tr>
          </tbody>
        </table>
        <div style="margin-top:12px"><span class="text-dim">Gas price: ${gweiPrice.toFixed(2)} gwei &middot; ETH: $${ethPrice.toLocaleString()}</span></div>
        <div style="margin-top:8px"><strong>${costEth.toFixed(6)} ETH</strong> &middot; <strong>${costUsd > 0.01 ? '$' + costUsd.toFixed(2) : '< $0.01'}</strong></div>
        <table class="params-table" style="margin-top:8px">
          <thead><tr><th>Gas Price</th><th>Cost (ETH)</th><th>Cost (USD)</th></tr></thead>
          <tbody>${[10, 25, 50, 100].map(g => {
            const cEth = (totalGas * g * 1e9) / 1e18
            const cUsd = cEth * ethPrice
            return `<tr><td>${g} gwei</td><td class="mono">${cEth.toFixed(6)} ETH</td><td class="mono">${cUsd > 0.01 ? '$' + cUsd.toFixed(2) : '< $0.01'}</td></tr>`
          }).join('')}</tbody>
        </table>
      </div>`
    } catch (e) {
      output.innerHTML = `<div class="result-card error"><div style="font-weight:700;margin-bottom:8px">DEPLOY FAILED</div><div class="mono" style="font-size:12px;word-break:break-all">${esc(e.message || String(e))}</div></div>`
    }
  }
}

function randomValue(type) {
  const t = type.replace(/\s/g, '')
  if (t === 'bool') return Math.random() > 0.5 ? 'true' : 'false'
  if (t === 'address') return '0x' + [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  if (t === 'string') {
    const words = ['hello', 'test', 'world', 'solidity', 'anywei', 'foobar', 'data']
    return words[Math.floor(Math.random() * words.length)]
  }
  if (t === 'bytes32') return '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  if (t.startsWith('bytes') && !t.endsWith('[]')) {
    const n = parseInt(t.slice(5)) || Math.floor(Math.random() * 32) + 1
    return '0x' + [...Array(n * 2)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  }
  if (t.startsWith('uint')) {
    const bits = parseInt(t.slice(4)) || 256
    // Bias toward reasonable values, not max
    const r = Math.random()
    if (r < 0.2) return '0'
    if (r < 0.4) return '1'
    if (r < 0.6) return String(Math.floor(Math.random() * 10000))
    if (r < 0.8) return String(BigInt(Math.floor(Math.random() * 1e15)))
    return String(2n ** BigInt(Math.floor(Math.random() * bits)) - 1n)
  }
  if (t.startsWith('int')) {
    const bits = parseInt(t.slice(3)) || 256
    const magnitude = BigInt(Math.floor(Math.random() * 1e12))
    return Math.random() > 0.5 ? String(magnitude) : String(-magnitude)
  }
  if (t.endsWith('[]')) {
    const base = t.slice(0, -2)
    const len = Math.floor(Math.random() * 3) + 1
    return JSON.stringify([...Array(len)].map(() => {
      const v = randomValue(base)
      // For numeric types, return as number in the JSON array
      if (base.startsWith('uint') || base.startsWith('int')) return v
      return v
    }))
  }
  return '0'
}

function coerceParam(raw, type) {
  if (!raw && type !== 'string' && type !== 'bytes') {
    if (type === 'bool') return false
    if (type === 'address') return '0x0000000000000000000000000000000000000000'
    if (type.startsWith('uint') || type.startsWith('int')) return 0n
    if (type.startsWith('bytes')) return '0x'
    if (type.endsWith('[]')) return []
    return ''
  }
  if (type === 'bool') return raw === 'true' || raw === '1'
  if (type === 'address') return raw
  if (type.startsWith('uint') || type.startsWith('int')) return BigInt(raw.replace(/,/g, ''))
  if (type.startsWith('bytes')) return ensure0x(raw)
  if (type.endsWith('[]')) {
    try { return JSON.parse(raw) } catch { return raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean) }
  }
  return raw
}
