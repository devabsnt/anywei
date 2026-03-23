import { keccak256, toBytes, toHex, getAddress, pad, encodeAbiParameters, parseAbiParameters } from 'viem'
import { esc, ensure0x, strip0x, copyBtn } from '../shared/formatters.js'
import { getPriceData } from '../shared/etherscan.js'

export function render(container, queryParams = {}) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Unit Converter</h2>
      <p class="tool-desc">Universal converter for all Solidity values. Everything updates as you type.</p>
    </div>
    <div class="tool-body converter-grid">

      <div class="converter-card">
        <h3>ETH Units</h3>
        <div class="input-group"><label>Wei</label><input type="text" id="cv-wei" class="mono-input" placeholder="0" spellcheck="false"></div>
        <div class="input-group"><label>Gwei</label><input type="text" id="cv-gwei" class="mono-input" placeholder="0" spellcheck="false"></div>
        <div class="input-group"><label>Ether</label><input type="text" id="cv-ether" class="mono-input" placeholder="0" spellcheck="false"></div>
        <div id="cv-usd" class="text-dim" style="font-size:11px"></div>
      </div>

      <div class="converter-card">
        <h3>Number Formats</h3>
        <div class="input-group"><label>Decimal</label><input type="text" id="cv-dec" class="mono-input" placeholder="0" spellcheck="false"></div>
        <div class="input-group"><label>Hex</label><input type="text" id="cv-hex" class="mono-input" placeholder="0x0" spellcheck="false"></div>
        <div class="input-group"><label>Binary</label><input type="text" id="cv-bin" class="mono-input" placeholder="0" spellcheck="false"></div>
      </div>

      <div class="converter-card">
        <h3>Keccak256 Hash</h3>
        <div class="input-group"><label>Input (text or hex)</label><input type="text" id="cv-hash-in" class="mono-input" placeholder="Type text or 0x hex bytes..." spellcheck="false"></div>
        <div class="input-group"><label>Hash</label><input type="text" id="cv-hash-out" class="mono-input" readonly></div>
        <div class="text-dim" style="font-size:11px">Hashes as UTF-8 string. Prefix with 0x to hash raw bytes.</div>
      </div>

      <div class="converter-card">
        <h3>Address Tools</h3>
        <div class="input-group"><label>Address</label><input type="text" id="cv-addr" class="mono-input" placeholder="0x..." spellcheck="false"></div>
        <div class="input-group"><label>Checksummed</label><input type="text" id="cv-addr-cs" class="mono-input" readonly></div>
        <div class="input-group"><label>As bytes32</label><input type="text" id="cv-addr-b32" class="mono-input" readonly></div>
        <div id="cv-addr-status" class="status-line"></div>
      </div>

      <div class="converter-card">
        <h3>Timestamp</h3>
        <div class="input-group"><label>Unix timestamp</label><input type="text" id="cv-ts" class="mono-input" placeholder="${Math.floor(Date.now() / 1000)}" spellcheck="false"></div>
        <div class="input-group"><label>Date (UTC)</label><input type="text" id="cv-date" class="mono-input" readonly></div>
        <div class="text-dim" style="font-size:11px">Now: ${Math.floor(Date.now() / 1000)} &middot; Avg block time: ~12s</div>
      </div>

      <div class="converter-card" style="grid-column: 1 / -1">
        <h3>ABI Encode</h3>
        <div class="input-group"><label>Types <span class="text-dim">(comma-separated: address,uint256,bool)</span></label><input type="text" id="cv-enc-types" class="mono-input" placeholder="address, uint256" spellcheck="false"></div>
        <div class="input-group"><label>Values <span class="text-dim">(comma-separated)</span></label><input type="text" id="cv-enc-values" class="mono-input" placeholder="0x1234..., 1000000" spellcheck="false"></div>
        <div class="input-row" style="gap:8px">
          <div class="input-group flex-1">
            <label>abi.encode</label>
            <textarea id="cv-enc-out" class="mono-input" rows="2" readonly></textarea>
          </div>
          <div class="input-group flex-1">
            <label>abi.encodePacked</label>
            <textarea id="cv-enc-packed" class="mono-input" rows="2" readonly></textarea>
          </div>
        </div>
      </div>

    </div>
  `

  // ── ETH units ──
  const wei = document.getElementById('cv-wei')
  const gwei = document.getElementById('cv-gwei')
  const ether = document.getElementById('cv-ether')
  const usdEl = document.getElementById('cv-usd')

  let ethPrice = 0
  getPriceData().then(p => { ethPrice = p.ethPrice; updateEthUsd() }).catch(() => {})

  function updateEthUsd() {
    try {
      const w = BigInt(wei.value.replace(/,/g, '') || '0')
      const ethVal = Number(w) / 1e18
      if (ethPrice > 0 && ethVal > 0) {
        usdEl.textContent = `${ethVal.toFixed(6)} ETH = $${(ethVal * ethPrice).toFixed(2)} (ETH @ $${ethPrice.toLocaleString()})`
      } else {
        usdEl.textContent = ethPrice > 0 ? `ETH price: $${ethPrice.toLocaleString()}` : ''
      }
    } catch { usdEl.textContent = '' }
  }

  function updateEth(source) {
    try {
      let w
      if (source === 'wei') w = BigInt(wei.value.replace(/,/g, '') || '0')
      else if (source === 'gwei') w = BigInt(Math.round(parseFloat(gwei.value || '0') * 1e9))
      else w = BigInt(Math.round(parseFloat(ether.value || '0') * 1e18))
      if (source !== 'wei') wei.value = w.toString()
      if (source !== 'gwei') gwei.value = (Number(w) / 1e9).toString()
      if (source !== 'ether') ether.value = (Number(w) / 1e18).toString()
      updateEthUsd()
    } catch {}
  }

  wei.addEventListener('input', () => updateEth('wei'))
  gwei.addEventListener('input', () => updateEth('gwei'))
  ether.addEventListener('input', () => updateEth('ether'))

  // ── Number formats ──
  const dec = document.getElementById('cv-dec')
  const hex = document.getElementById('cv-hex')
  const bin = document.getElementById('cv-bin')

  function updateNum(source) {
    try {
      let n
      if (source === 'dec') n = BigInt(dec.value.replace(/,/g, '') || '0')
      else if (source === 'hex') n = BigInt(ensure0x(hex.value || '0'))
      else n = BigInt('0b' + (bin.value || '0'))
      if (source !== 'dec') dec.value = n.toString()
      if (source !== 'hex') hex.value = '0x' + n.toString(16)
      if (source !== 'bin') bin.value = n.toString(2)
    } catch {}
  }

  dec.addEventListener('input', () => updateNum('dec'))
  hex.addEventListener('input', () => updateNum('hex'))
  bin.addEventListener('input', () => updateNum('bin'))

  // ── Keccak256 ──
  const hashIn = document.getElementById('cv-hash-in')
  const hashOut = document.getElementById('cv-hash-out')

  hashIn.addEventListener('input', () => {
    const raw = hashIn.value
    if (!raw) { hashOut.value = ''; return }
    try {
      hashOut.value = raw.startsWith('0x') ? keccak256(raw) : keccak256(toBytes(raw))
    } catch (e) { hashOut.value = 'Error: ' + e.message }
  })

  // ── Address tools ──
  const addr = document.getElementById('cv-addr')
  const addrCs = document.getElementById('cv-addr-cs')
  const addrB32 = document.getElementById('cv-addr-b32')
  const addrStatus = document.getElementById('cv-addr-status')

  addr.addEventListener('input', () => {
    const raw = addr.value.trim()
    if (!raw || raw.length !== 42) { addrCs.value = ''; addrB32.value = ''; addrStatus.textContent = ''; return }
    try {
      const checksummed = getAddress(raw)
      addrCs.value = checksummed
      addrB32.value = pad(checksummed, { size: 32 }).toLowerCase()
      addrStatus.innerHTML = raw === checksummed
        ? '<span class="success">Valid checksum</span>'
        : '<span class="warning">Invalid checksum (corrected above)</span>'
    } catch (e) {
      addrStatus.innerHTML = `<span class="error">${esc(e.message)}</span>`
    }
  })

  // ── Timestamp ──
  const ts = document.getElementById('cv-ts')
  const dateOut = document.getElementById('cv-date')

  ts.addEventListener('input', () => {
    const val = parseInt(ts.value)
    if (isNaN(val)) { dateOut.value = ''; return }
    dateOut.value = new Date(val * 1000).toUTCString()
  })

  // ── ABI Encode ──
  const encTypes = document.getElementById('cv-enc-types')
  const encValues = document.getElementById('cv-enc-values')
  const encOut = document.getElementById('cv-enc-out')
  const encPacked = document.getElementById('cv-enc-packed')

  function doEncode() {
    const typesRaw = encTypes.value.trim()
    const valuesRaw = encValues.value.trim()
    if (!typesRaw || !valuesRaw) { encOut.value = ''; encPacked.value = ''; return }

    try {
      const types = typesRaw.split(',').map(t => t.trim()).filter(Boolean)
      const rawVals = splitValues(valuesRaw, types.length)
      const args = types.map((t, i) => coerceValue(rawVals[i]?.trim() || '', t))

      // abi.encode
      try {
        const params = parseAbiParameters(types.join(', '))
        encOut.value = encodeAbiParameters(params, args)
      } catch (e) { encOut.value = 'Error: ' + e.message }

      // abi.encodePacked — manual concatenation
      try {
        let packed = '0x'
        for (let i = 0; i < types.length; i++) {
          packed += encodePacked(types[i], args[i])
        }
        encPacked.value = packed
      } catch (e) { encPacked.value = 'Error: ' + e.message }
    } catch (e) {
      encOut.value = 'Error: ' + e.message
      encPacked.value = ''
    }
  }

  encTypes.addEventListener('input', doEncode)
  encValues.addEventListener('input', doEncode)
}

function splitValues(raw, expectedCount) {
  // Smart split: respect strings with commas inside quotes
  const values = []
  let current = ''
  let depth = 0
  for (const ch of raw) {
    if (ch === '[' || ch === '(') depth++
    if (ch === ']' || ch === ')') depth--
    if (ch === ',' && depth === 0) { values.push(current); current = ''; continue }
    current += ch
  }
  values.push(current)
  return values
}

function coerceValue(raw, type) {
  if (type === 'bool') return raw === 'true' || raw === '1'
  if (type === 'address') return raw
  if (type.startsWith('uint') || type.startsWith('int')) return BigInt(raw.replace(/,/g, ''))
  if (type.startsWith('bytes')) return ensure0x(raw)
  return raw
}

function encodePacked(type, value) {
  if (type === 'address') return strip0x(String(value)).toLowerCase().padStart(40, '0')
  if (type === 'bool') return value ? '01' : '00'
  if (type.startsWith('uint')) {
    const bits = parseInt(type.slice(4)) || 256
    return BigInt(value).toString(16).padStart(bits / 4, '0')
  }
  if (type.startsWith('int')) {
    const bits = parseInt(type.slice(3)) || 256
    let n = BigInt(value)
    if (n < 0n) n = (1n << BigInt(bits)) + n
    return n.toString(16).padStart(bits / 4, '0')
  }
  if (type.startsWith('bytes') && type !== 'bytes') {
    const size = parseInt(type.slice(5))
    return strip0x(String(value)).padEnd(size * 2, '0').slice(0, size * 2)
  }
  if (type === 'bytes') return strip0x(String(value))
  if (type === 'string') return [...String(value)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return strip0x(String(value))
}
