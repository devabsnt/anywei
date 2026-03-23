import { hashTypedData, recoverTypedDataAddress, verifyTypedData, getAddress } from 'viem'
import * as walletMod from '../shared/wallet.js'
import { esc, copyBtn } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>EIP-712 Signer / Verifier</h2>
      <p class="tool-desc">Build typed data, sign it with a connected wallet, or verify existing signatures.</p>
    </div>
    <div class="tool-body">
      <div class="mode-tabs">
        <button class="mode-btn active" data-mode="sign">Sign</button>
        <button class="mode-btn" data-mode="verify">Verify</button>
        <button class="mode-btn" data-mode="hash">Hash Only</button>
      </div>
      <div id="eip-inputs"></div>
      <div id="eip-output" class="output-area"></div>
    </div>
  `

  let mode = 'sign'
  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      mode = btn.dataset.mode
      renderInputs()
    })
  })
  renderInputs()

  function renderInputs() {
    const div = document.getElementById('eip-inputs')
    document.getElementById('eip-output').innerHTML = ''

    if (mode === 'sign' || mode === 'hash') {
      div.innerHTML = `
        <div class="input-group">
          <label>Domain <span class="text-dim">(JSON: {name, version, chainId, verifyingContract})</span></label>
          <textarea id="eip-domain" class="mono-input" rows="3" placeholder='{"name":"MyApp","version":"1","chainId":1,"verifyingContract":"0x..."}'spellcheck="false"></textarea>
        </div>
        <div class="input-group">
          <label>Types <span class="text-dim">(JSON: {TypeName: [{name, type}]})</span></label>
          <textarea id="eip-types" class="mono-input" rows="3" placeholder='{"Permit":[{"name":"owner","type":"address"},{"name":"spender","type":"address"},{"name":"value","type":"uint256"},{"name":"nonce","type":"uint256"},{"name":"deadline","type":"uint256"}]}' spellcheck="false"></textarea>
        </div>
        <div class="input-group">
          <label>Primary type</label>
          <input type="text" id="eip-primary" class="mono-input" placeholder="Permit" spellcheck="false">
        </div>
        <div class="input-group">
          <label>Message <span class="text-dim">(JSON)</span></label>
          <textarea id="eip-message" class="mono-input" rows="3" placeholder='{"owner":"0x...","spender":"0x...","value":"1000000","nonce":"0","deadline":"1999999999"}' spellcheck="false"></textarea>
        </div>
        <button id="eip-run" class="btn btn-primary">${mode === 'sign' ? 'Sign with Wallet' : 'Compute Hash'}</button>
      `
      document.getElementById('eip-run').addEventListener('click', mode === 'sign' ? doSign : doHash)
    } else {
      div.innerHTML = `
        <div class="input-group">
          <label>Typed data JSON <span class="text-dim">(full EIP-712 object with domain, types, primaryType, message)</span></label>
          <textarea id="eip-fulldata" class="mono-input" rows="6" placeholder='{"domain":{...},"types":{...},"primaryType":"...","message":{...}}' spellcheck="false"></textarea>
        </div>
        <div class="input-group">
          <label>Signature (hex)</label>
          <input type="text" id="eip-sig" class="mono-input" placeholder="0x..." spellcheck="false">
        </div>
        <div class="input-group">
          <label>Expected signer address <span class="text-dim">(optional)</span></label>
          <input type="text" id="eip-signer" class="mono-input" placeholder="0x..." spellcheck="false">
        </div>
        <button id="eip-verify" class="btn btn-primary">Verify</button>
      `
      document.getElementById('eip-verify').addEventListener('click', doVerify)
    }
  }

  function parseInputs() {
    const domain = JSON.parse(document.getElementById('eip-domain').value)
    if (domain.chainId) domain.chainId = Number(domain.chainId)
    const types = JSON.parse(document.getElementById('eip-types').value)
    const primaryType = document.getElementById('eip-primary').value.trim()
    const message = JSON.parse(document.getElementById('eip-message').value)
    // Convert string numbers to BigInt for uint types
    return { domain, types, primaryType, message }
  }

  async function doSign() {
    const output = document.getElementById('eip-output')
    try {
      const { domain, types, primaryType, message } = parseInputs()
      const state = walletMod.getState()
      if (!state.connected || !state.walletClient) throw new Error('Connect wallet first')

      output.innerHTML = '<div class="loading">Requesting signature...</div>'
      const signature = await state.walletClient.signTypedData({ domain, types, primaryType, message })
      const hash = hashTypedData({ domain, types, primaryType, message })

      output.innerHTML = `<div class="result-card">
        <div class="text-dim">Signature:</div>
        <div class="mono" style="word-break:break-all;font-size:12px" id="eip-sig-result">${esc(signature)}</div>
        <div style="margin-top:8px"><span class="text-dim">Struct hash:</span></div>
        <div class="mono text-dim" style="word-break:break-all;font-size:11px">${esc(hash)}</div>
        <div style="margin-top:8px"><span class="text-dim">Signer:</span> <span class="mono text-blue">${esc(state.account)}</span></div>
      </div>`
      document.getElementById('eip-sig-result').appendChild(copyBtn(signature))
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }

  function doHash() {
    const output = document.getElementById('eip-output')
    try {
      const { domain, types, primaryType, message } = parseInputs()
      const hash = hashTypedData({ domain, types, primaryType, message })

      output.innerHTML = `<div class="result-card">
        <div class="text-dim">EIP-712 hash:</div>
        <div class="mono text-blue" style="font-size:13px" id="eip-hash-result">${esc(hash)}</div>
      </div>`
      document.getElementById('eip-hash-result').appendChild(copyBtn(hash))
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }

  async function doVerify() {
    const output = document.getElementById('eip-output')
    try {
      const fullData = JSON.parse(document.getElementById('eip-fulldata').value)
      if (fullData.domain?.chainId) fullData.domain.chainId = Number(fullData.domain.chainId)
      const signature = document.getElementById('eip-sig').value.trim()
      const expectedSigner = document.getElementById('eip-signer').value.trim()

      const recovered = await recoverTypedDataAddress({
        domain: fullData.domain,
        types: fullData.types,
        primaryType: fullData.primaryType,
        message: fullData.message,
        signature
      })

      let valid = true
      let matchMsg = ''
      if (expectedSigner) {
        valid = getAddress(recovered) === getAddress(expectedSigner)
        matchMsg = valid
          ? '<span class="success">Signature matches expected signer</span>'
          : '<span class="error">Signature does NOT match expected signer</span>'
      }

      output.innerHTML = `<div class="result-card">
        <div class="text-dim">Recovered signer:</div>
        <div class="mono text-blue">${esc(recovered)}</div>
        ${matchMsg ? `<div style="margin-top:8px">${matchMsg}</div>` : ''}
      </div>`
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }
}
