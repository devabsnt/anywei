import { encodeFunctionData, decodeFunctionResult, parseAbi, getAddress } from 'viem'
import { fetchAbi } from '../shared/abi-cache.js'
import { esc, copyBtn, ensure0x } from '../shared/formatters.js'

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const MULTICALL3_ABI = parseAbi([
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])',
  'function aggregate3Value(tuple(address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])'
])

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Multicall Builder</h2>
      <p class="tool-desc">Batch multiple contract calls into a single Multicall3 transaction. Deployed on all major chains at <span class="mono text-blue">${MULTICALL3}</span>.</p>
    </div>
    <div class="tool-body">
      <div id="mc-calls"></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="mc-add" class="btn">+ Add Call</button>
        <button id="mc-encode" class="btn btn-primary">Encode Multicall</button>
      </div>
      <div id="mc-output" class="output-area"></div>
    </div>
  `

  let calls = [{ target: '', abi: null, fnName: '', args: [] }]

  renderCalls()

  document.getElementById('mc-add').addEventListener('click', () => {
    calls.push({ target: '', abi: null, fnName: '', args: [] })
    renderCalls()
  })
  document.getElementById('mc-encode').addEventListener('click', encode)

  function renderCalls() {
    const div = document.getElementById('mc-calls')
    div.innerHTML = ''

    calls.forEach((call, i) => {
      const card = document.createElement('div')
      card.className = 'result-card'
      card.style.marginBottom = '8px'
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span class="text-dim">Call ${i + 1}</span>
          <button class="ide-find-btn mc-remove" data-idx="${i}">&times;</button>
        </div>
        <div class="input-group">
          <label>Target address</label>
          <input type="text" class="mono-input mc-target" data-idx="${i}" value="${esc(call.target)}" placeholder="0x..." spellcheck="false">
        </div>
        <div class="input-group">
          <label>Function signature or ABI</label>
          <input type="text" class="mono-input mc-fn" data-idx="${i}" value="${esc(call.fnName)}" placeholder="balanceOf(address) or paste ABI" spellcheck="false">
        </div>
        <div class="input-group">
          <label>Arguments <span class="text-dim">(comma-separated)</span></label>
          <input type="text" class="mono-input mc-args" data-idx="${i}" value="${esc(call.args.join(', '))}" placeholder="0x1234..., 1000" spellcheck="false">
        </div>
      `
      div.appendChild(card)
    })

    // Bind remove buttons
    div.querySelectorAll('.mc-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        calls.splice(parseInt(btn.dataset.idx), 1)
        if (calls.length === 0) calls.push({ target: '', abi: null, fnName: '', args: [] })
        renderCalls()
      })
    })
  }

  function collectCalls() {
    const targets = document.querySelectorAll('.mc-target')
    const fns = document.querySelectorAll('.mc-fn')
    const args = document.querySelectorAll('.mc-args')
    return Array.from(targets).map((_, i) => ({
      target: targets[i].value.trim(),
      fnSig: fns[i].value.trim(),
      argsRaw: args[i].value.trim()
    }))
  }

  function encode() {
    const output = document.getElementById('mc-output')
    try {
      const rawCalls = collectCalls()
      const encodedCalls = []

      for (const call of rawCalls) {
        if (!call.target || !call.fnSig) continue

        let callData
        if (call.fnSig.includes('(')) {
          // Function signature
          const abi = parseAbi([`function ${call.fnSig}`])
          const fn = abi[0]
          const args = call.argsRaw ? call.argsRaw.split(',').map(s => {
            const v = s.trim()
            if (v.startsWith('0x')) return v
            try { return BigInt(v) } catch { return v }
          }) : []
          callData = encodeFunctionData({ abi, functionName: fn.name, args })
        } else {
          callData = ensure0x(call.fnSig) // Raw calldata
        }

        encodedCalls.push({
          target: getAddress(call.target),
          allowFailure: false,
          callData
        })
      }

      if (encodedCalls.length === 0) {
        output.innerHTML = '<div class="result-card error">Add at least one valid call</div>'
        return
      }

      const multicallData = encodeFunctionData({
        abi: MULTICALL3_ABI,
        functionName: 'aggregate3',
        args: [encodedCalls]
      })

      let html = `<div class="result-card">
        <div class="text-dim">Multicall3 calldata (${encodedCalls.length} calls):</div>
        <div class="mono" style="word-break:break-all;font-size:11px;margin-top:4px" id="mc-result">${esc(multicallData)}</div>
        <table class="params-table" style="margin-top:12px">
          <tbody>
            <tr><td class="text-dim">Target</td><td class="mono text-blue">${esc(MULTICALL3)}</td></tr>
            <tr><td class="text-dim">Calls</td><td>${encodedCalls.length}</td></tr>
            <tr><td class="text-dim">Data size</td><td>${((multicallData.length - 2) / 2).toLocaleString()} bytes</td></tr>
          </tbody>
        </table>
      </div>`

      // Individual call breakdown
      html += '<div class="result-card"><div class="fn-signature">Individual Calls</div>'
      for (let i = 0; i < encodedCalls.length; i++) {
        const c = encodedCalls[i]
        html += `<div style="padding:4px 0;border-bottom:1px solid #1a1a1a;font-size:11px">
          <span class="text-dim">${i + 1}.</span>
          <span class="mono text-blue">${c.target.slice(0, 10)}...</span>
          <span class="mono text-dim">${c.callData.slice(0, 10)}</span>
          <span class="text-dim">(${((c.callData.length - 2) / 2)} bytes)</span>
        </div>`
      }
      html += '</div>'

      output.innerHTML = html
      document.getElementById('mc-result').appendChild(copyBtn(multicallData))
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }
}
