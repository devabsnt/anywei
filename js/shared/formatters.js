// Copy text to clipboard and flash the button
export function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (btn) {
      const orig = btn.textContent
      btn.textContent = 'Copied!'
      btn.classList.add('copied')
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied') }, 1200)
    }
  })
}

// Create a copy button element
export function copyBtn(text, label = 'Copy') {
  const btn = document.createElement('button')
  btn.className = 'btn-copy'
  btn.textContent = label
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    copyToClipboard(text, btn)
  })
  return btn
}

// Escape HTML
export function esc(str) {
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

// Truncate an address for display
export function truncAddr(addr) {
  if (!addr || addr.length < 12) return addr
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

// Format a BigInt/number with commas
export function fmtNum(n) {
  return BigInt(n).toLocaleString()
}

// Etherscan link for address
export function etherscanLink(addr) {
  return `https://etherscan.io/address/${addr}`
}

// Create an element with innerHTML
export function el(tag, className, html) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (html) e.innerHTML = html
  return e
}

// Hex with 0x prefix
export function ensure0x(hex) {
  if (!hex) return '0x'
  return hex.startsWith('0x') ? hex : '0x' + hex
}

// Remove 0x prefix
export function strip0x(hex) {
  if (!hex) return ''
  return hex.startsWith('0x') ? hex.slice(2) : hex
}

// Save tool state to sessionStorage
export function saveState(toolId, data) {
  try { sessionStorage.setItem(`anywei_${toolId}`, JSON.stringify(data)) } catch {}
}

// Load tool state from sessionStorage
export function loadState(toolId) {
  try {
    const raw = sessionStorage.getItem(`anywei_${toolId}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
