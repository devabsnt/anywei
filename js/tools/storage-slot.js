import { keccak256, encodeAbiParameters, parseAbiParameters, pad, toHex, fromHex } from 'viem'
import { readStorageSlot } from '../shared/etherscan.js'
import { esc, copyBtn, ensure0x } from '../shared/formatters.js'

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Storage Slot Calculator</h2>
      <p class="tool-desc">Calculate storage slot positions for mappings, arrays, and structs.</p>
    </div>
    <div class="tool-body">
      <div class="mode-tabs">
        <button class="mode-btn active" data-mode="simple">Simple</button>
        <button class="mode-btn" data-mode="mapping">Mapping</button>
        <button class="mode-btn" data-mode="nested">Nested Mapping</button>
        <button class="mode-btn" data-mode="array">Array</button>
        <button class="mode-btn" data-mode="struct">Struct</button>
      </div>
      <div id="ss-inputs" class="tool-inputs"></div>
      <div id="ss-output" class="output-area"></div>
      <div class="input-row" style="margin-top:12px">
        <div class="input-group flex-1">
          <label>Read slot from chain <span class="text-dim">(optional)</span></label>
          <input type="text" id="ss-address" class="mono-input" placeholder="Contract address 0x..." spellcheck="false">
        </div>
        <button id="ss-read-btn" class="btn btn-primary" style="align-self:flex-end">Read</button>
      </div>
      <div id="ss-read-result" class="output-area"></div>
    </div>
  `

  let mode = 'simple'
  let lastSlot = null

  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      mode = btn.dataset.mode
      renderInputs()
    })
  })

  document.getElementById('ss-read-btn').addEventListener('click', readSlot)

  renderInputs()

  function renderInputs() {
    const div = document.getElementById('ss-inputs')
    document.getElementById('ss-output').innerHTML = ''

    if (mode === 'simple') {
      div.innerHTML = `<div class="input-group"><label>Slot number</label><input type="text" class="mono-input" id="ss-slot" placeholder="0" spellcheck="false"></div>`
    } else if (mode === 'mapping') {
      div.innerHTML = `
        <div class="input-group"><label>Base slot</label><input type="text" class="mono-input" id="ss-slot" placeholder="0" spellcheck="false"></div>
        <div class="input-group"><label>Key <span class="text-dim">(address or uint256)</span></label><input type="text" class="mono-input" id="ss-key" placeholder="0x..." spellcheck="false"></div>
        <div class="input-group"><label>Key type</label><select id="ss-keytype" class="mono-input"><option value="address">address</option><option value="uint256">uint256</option><option value="bytes32">bytes32</option></select></div>`
    } else if (mode === 'nested') {
      div.innerHTML = `
        <div class="input-group"><label>Base slot</label><input type="text" class="mono-input" id="ss-slot" placeholder="0" spellcheck="false"></div>
        <div class="input-group"><label>Key 1</label><input type="text" class="mono-input" id="ss-key" placeholder="0x..." spellcheck="false"></div>
        <div class="input-group"><label>Key 1 type</label><select id="ss-keytype" class="mono-input"><option value="address">address</option><option value="uint256">uint256</option><option value="bytes32">bytes32</option></select></div>
        <div class="input-group"><label>Key 2</label><input type="text" class="mono-input" id="ss-key2" placeholder="0x..." spellcheck="false"></div>
        <div class="input-group"><label>Key 2 type</label><select id="ss-key2type" class="mono-input"><option value="address">address</option><option value="uint256">uint256</option><option value="bytes32">bytes32</option></select></div>`
    } else if (mode === 'array') {
      div.innerHTML = `
        <div class="input-group"><label>Base slot</label><input type="text" class="mono-input" id="ss-slot" placeholder="0" spellcheck="false"></div>
        <div class="input-group"><label>Array index</label><input type="text" class="mono-input" id="ss-index" placeholder="0" spellcheck="false"></div>`
    } else if (mode === 'struct') {
      div.innerHTML = `
        <div class="input-group"><label>Base slot</label><input type="text" class="mono-input" id="ss-slot" placeholder="0" spellcheck="false"></div>
        <div class="input-group"><label>Member offset</label><input type="text" class="mono-input" id="ss-offset" placeholder="0" spellcheck="false"></div>`
    }

    div.querySelectorAll('input, select').forEach(el => el.addEventListener('input', compute))
  }

  function compute() {
    const out = document.getElementById('ss-output')
    try {
      const slotRaw = document.getElementById('ss-slot')?.value.trim() || '0'
      const baseSlot = BigInt(slotRaw)

      if (mode === 'simple') {
        lastSlot = pad(toHex(baseSlot), { size: 32 })
        out.innerHTML = renderResult(lastSlot, [`Slot ${slotRaw}`])
      } else if (mode === 'mapping') {
        const key = document.getElementById('ss-key').value.trim()
        const keyType = document.getElementById('ss-keytype').value
        if (!key) { out.innerHTML = ''; return }
        const encoded = encodeAbiParameters(parseAbiParameters(`${keyType}, uint256`), [coerceKey(key, keyType), baseSlot])
        lastSlot = keccak256(encoded)
        out.innerHTML = renderResult(lastSlot, [
          `keccak256(abi.encode(${key}, ${slotRaw}))`,
          `Encoded: ${encoded}`
        ])
      } else if (mode === 'nested') {
        const key1 = document.getElementById('ss-key').value.trim()
        const key1Type = document.getElementById('ss-keytype').value
        const key2 = document.getElementById('ss-key2').value.trim()
        const key2Type = document.getElementById('ss-key2type').value
        if (!key1 || !key2) { out.innerHTML = ''; return }
        const inner = keccak256(encodeAbiParameters(parseAbiParameters(`${key1Type}, uint256`), [coerceKey(key1, key1Type), baseSlot]))
        lastSlot = keccak256(encodeAbiParameters(parseAbiParameters(`${key2Type}, bytes32`), [coerceKey(key2, key2Type), inner]))
        out.innerHTML = renderResult(lastSlot, [
          `inner = keccak256(abi.encode(${key1}, ${slotRaw})) = ${inner}`,
          `slot = keccak256(abi.encode(${key2}, inner))`
        ])
      } else if (mode === 'array') {
        const idx = BigInt(document.getElementById('ss-index')?.value.trim() || '0')
        const arrayStart = keccak256(encodeAbiParameters(parseAbiParameters('uint256'), [baseSlot]))
        lastSlot = pad(toHex(BigInt(arrayStart) + idx), { size: 32 })
        out.innerHTML = renderResult(lastSlot, [
          `keccak256(${slotRaw}) = ${arrayStart}`,
          `slot = ${arrayStart} + ${idx}`
        ])
      } else if (mode === 'struct') {
        const offset = BigInt(document.getElementById('ss-offset')?.value.trim() || '0')
        lastSlot = pad(toHex(baseSlot + offset), { size: 32 })
        out.innerHTML = renderResult(lastSlot, [`${slotRaw} + ${offset}`])
      }
    } catch (e) {
      out.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }

  async function readSlot() {
    const addr = document.getElementById('ss-address').value.trim()
    const readResult = document.getElementById('ss-read-result')
    if (!addr || !lastSlot) { readResult.innerHTML = '<span class="text-dim">Enter a contract address and compute a slot first.</span>'; return }
    readResult.innerHTML = '<span class="loading">Reading...</span>'
    try {
      const val = await readStorageSlot(addr, lastSlot)
      readResult.innerHTML = `<div class="result-card"><span class="text-dim">Value at slot:</span><div class="mono copyable">${esc(val)}</div><div class="text-dim" style="margin-top:4px">As uint256: ${BigInt(val).toString()}</div></div>`
    } catch (e) {
      readResult.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }

  function renderResult(slot, steps) {
    return `<div class="result-card">
      <div class="text-dim">Computed slot:</div>
      <div class="mono text-blue copyable" style="font-size:13px;word-break:break-all">${esc(slot)}</div>
      <div style="margin-top:8px">${steps.map(s => `<div class="text-dim" style="font-size:11px;word-break:break-all">${esc(s)}</div>`).join('')}</div>
    </div>`
  }

  function coerceKey(val, type) {
    if (type === 'address') return val
    if (type === 'uint256') return BigInt(val)
    return val
  }
}
