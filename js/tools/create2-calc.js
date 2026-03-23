import { keccak256, encodePacked, getAddress, concat, pad, toBytes, bytesToHex } from 'viem'
import { esc, copyBtn, ensure0x, strip0x } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>CREATE2 Address Calculator</h2>
      <p class="tool-desc">Compute deterministic deployment addresses from deployer, salt, and init code.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Deployer (factory) address</label>
        <input type="text" id="c2-deployer" class="mono-input" placeholder="0x..." spellcheck="false">
      </div>
      <div class="input-group">
        <label>Salt (bytes32)</label>
        <input type="text" id="c2-salt" class="mono-input" placeholder="0x0000...0001 or a number" spellcheck="false">
      </div>
      <div class="mode-tabs" style="margin-top:8px">
        <button class="mode-btn active" data-mode="hash">Init code hash (bytes32)</button>
        <button class="mode-btn" data-mode="bytecode">Init code (bytecode)</button>
      </div>
      <div class="input-group">
        <textarea id="c2-initcode" class="mono-input" rows="3" placeholder="0x..." spellcheck="false"></textarea>
      </div>
      <div id="c2-output" class="output-area"></div>
    </div>
  `

  let mode = 'hash'
  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      mode = btn.dataset.mode
      document.getElementById('c2-initcode').placeholder = mode === 'hash' ? 'Init code hash (bytes32)' : 'Full init code / creation bytecode'
      compute()
    })
  })

  const deployerInput = document.getElementById('c2-deployer')
  const saltInput = document.getElementById('c2-salt')
  const initInput = document.getElementById('c2-initcode')
  const output = document.getElementById('c2-output')

  for (const el of [deployerInput, saltInput, initInput]) {
    el.addEventListener('input', compute)
  }

  function compute() {
    const deployer = deployerInput.value.trim()
    const saltRaw = saltInput.value.trim()
    const initRaw = initInput.value.trim()

    if (!deployer || !saltRaw || !initRaw) { output.innerHTML = ''; return }

    try {
      // Normalize salt to bytes32
      let salt
      if (saltRaw.startsWith('0x') && saltRaw.length === 66) {
        salt = saltRaw
      } else {
        salt = pad(toBytes(BigInt(saltRaw)), { size: 32 })
        salt = bytesToHex(salt)
      }

      // Get init code hash
      let initCodeHash
      if (mode === 'hash') {
        initCodeHash = ensure0x(initRaw)
      } else {
        initCodeHash = keccak256(ensure0x(initRaw))
      }

      // CREATE2: keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))[12:]
      const packed = encodePacked(
        ['bytes1', 'address', 'bytes32', 'bytes32'],
        ['0xff', getAddress(deployer), salt, initCodeHash]
      )
      const hash = keccak256(packed)
      const address = getAddress('0x' + hash.slice(26))

      output.innerHTML = `<div class="result-card">
        <div class="text-dim">Predicted address:</div>
        <div class="mono text-blue" style="font-size:14px" id="c2-result">${esc(address)}</div>
        <table class="params-table" style="margin-top:12px">
          <tbody>
            <tr><td class="text-dim">Deployer</td><td class="mono">${esc(deployer)}</td></tr>
            <tr><td class="text-dim">Salt</td><td class="mono" style="word-break:break-all">${esc(salt)}</td></tr>
            <tr><td class="text-dim">Init code hash</td><td class="mono" style="word-break:break-all">${esc(initCodeHash)}</td></tr>
            <tr><td class="text-dim">Full hash</td><td class="mono" style="word-break:break-all">${esc(hash)}</td></tr>
          </tbody>
        </table>
      </div>`

      document.getElementById('c2-result').appendChild(copyBtn(address))
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }
}
