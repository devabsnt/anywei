import { keccak256, encodePacked, getAddress, isAddress } from 'viem'
import { esc, copyBtn } from '../shared/formatters.js'

function hashLeaf(address, amount) {
  return keccak256(encodePacked(['address', 'uint256'], [getAddress(address), BigInt(amount)]))
}

function hashPair(a, b) {
  // Sort to ensure deterministic ordering
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return keccak256(encodePacked(['bytes32', 'bytes32'], [lo, hi]))
}

function buildTree(leaves) {
  if (leaves.length === 0) return { root: '0x' + '0'.repeat(64), layers: [] }
  let layer = [...leaves]
  const layers = [layer]

  while (layer.length > 1) {
    const next = []
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]))
      } else {
        next.push(layer[i]) // odd one out passes through
      }
    }
    layers.push(next)
    layer = next
  }

  return { root: layer[0], layers }
}

function getProof(layers, leafIndex) {
  const proof = []
  let idx = leafIndex
  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i]
    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1
    if (pairIdx < layer.length) {
      proof.push(layer[pairIdx])
    }
    idx = Math.floor(idx / 2)
  }
  return proof
}

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Merkle Tree Generator</h2>
      <p class="tool-desc">Generate a Merkle root and proofs for airdrops and allowlists.</p>
    </div>
    <div class="tool-body">
      <div class="input-group">
        <label>Entries <span class="text-dim">(one per line: address,amount)</span></label>
        <textarea id="mk-input" class="mono-input" rows="10" placeholder="0x1234...5678,1000000000000000000\n0xabcd...ef01,2000000000000000000" spellcheck="false"></textarea>
      </div>
      <div class="input-row" style="gap:8px">
        <button id="mk-generate" class="btn btn-primary">Generate Tree</button>
        <label class="ide-checkbox"><input type="checkbox" id="mk-address-only"> Address-only (no amounts)</label>
      </div>
      <div id="mk-output" class="output-area"></div>
    </div>
  `

  document.getElementById('mk-generate').addEventListener('click', generate)

  function generate() {
    const raw = document.getElementById('mk-input').value.trim()
    const addressOnly = document.getElementById('mk-address-only').checked
    const output = document.getElementById('mk-output')
    if (!raw) return

    try {
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
      const entries = []
      const leaves = []

      for (const line of lines) {
        if (addressOnly) {
          const addr = line.split(',')[0].trim()
          if (!isAddress(addr)) throw new Error(`Invalid address: ${addr}`)
          entries.push({ address: getAddress(addr), amount: 0n })
          leaves.push(keccak256(encodePacked(['address'], [getAddress(addr)])))
        } else {
          const [addrRaw, amtRaw] = line.split(',').map(s => s.trim())
          if (!isAddress(addrRaw)) throw new Error(`Invalid address: ${addrRaw}`)
          const addr = getAddress(addrRaw)
          const amount = BigInt(amtRaw || '0')
          entries.push({ address: addr, amount })
          leaves.push(hashLeaf(addr, amount))
        }
      }

      const { root, layers } = buildTree(leaves)

      let html = `<div class="result-card">
        <div class="text-dim">Merkle Root:</div>
        <div class="mono text-blue" style="font-size:13px;word-break:break-all" id="mk-root">${esc(root)}</div>
        <div style="margin-top:4px"><span class="text-dim">${entries.length} leaves, ${layers.length} layers</span></div>
      </div>`

      // Individual proofs
      html += '<div class="result-card"><div class="fn-signature">Proofs</div>'
      for (let i = 0; i < entries.length; i++) {
        const proof = getProof(layers, i)
        const e = entries[i]
        html += `<details class="mk-proof">
          <summary class="mono" style="font-size:11px;cursor:pointer">
            <span class="text-blue">${e.address.slice(0, 10)}...</span>
            ${!addressOnly ? `<span class="text-dim">${e.amount.toString()}</span>` : ''}
          </summary>
          <div class="mono text-dim" style="font-size:11px;padding:4px 0;word-break:break-all">
            Leaf: ${esc(leaves[i])}<br>
            Proof: [${proof.map(p => `"${p}"`).join(', ')}]
          </div>
        </details>`
      }
      html += '</div>'

      // Export
      const exportData = {
        root,
        entries: entries.map((e, i) => ({
          address: e.address,
          amount: e.amount.toString(),
          leaf: leaves[i],
          proof: getProof(layers, i)
        }))
      }
      html += `<div style="margin-top:8px"><button class="btn" id="mk-export">Export JSON</button></div>`

      output.innerHTML = html

      document.getElementById('mk-root').appendChild(copyBtn(root))
      document.getElementById('mk-export').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'merkle-tree.json'
        a.click()
      })
    } catch (e) {
      output.innerHTML = `<div class="result-card error">${esc(e.message)}</div>`
    }
  }
}
