import { esc, copyBtn } from '../shared/formatters.js'
import { showToast, removeToast } from '../shared/toasts.js'

// Global state so mining persists across tab switches
let globalWorker = null
let globalMatches = [] // { address, privateKey, checked, elapsed }
let globalRunning = false
let globalPattern = ''
let globalMode = 'starts'
let globalChecked = 0
let globalRate = 0

function createMinerWorker() {
  const code = `
    importScripts('https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js');

    let running = false;
    let checked = 0;
    let startTime = 0;

    self.onmessage = function(e) {
      if (e.data.type === 'start') {
        running = true;
        checked = 0;
        startTime = Date.now();
        const pattern = e.data.pattern.toLowerCase();
        const mode = e.data.mode; // 'starts', 'ends', 'contains'

        function mine() {
          if (!running) return;
          var batch = 500;
          for (var i = 0; i < batch; i++) {
            var wallet = ethers.Wallet.createRandom();
            var addr = wallet.address.toLowerCase();
            checked++;
            var match = false;
            if (mode === 'starts') match = addr.slice(2).startsWith(pattern);
            else if (mode === 'ends') match = addr.endsWith(pattern);
            else if (mode === 'contains') match = addr.slice(2).includes(pattern);

            if (match) {
              self.postMessage({
                type: 'match',
                address: wallet.address,
                privateKey: wallet.privateKey,
                checked: checked,
                elapsed: Date.now() - startTime
              });
            }
          }

          // Report progress every batch
          self.postMessage({
            type: 'progress',
            checked: checked,
            rate: Math.round(checked / ((Date.now() - startTime) / 1000)),
            elapsed: Date.now() - startTime
          });

          setTimeout(mine, 0);
        }
        mine();
      }

      if (e.data.type === 'stop') {
        running = false;
      }
    };
  `
  return new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
}

export function render(container) {
  container.innerHTML = `
    <div class="tool-header">
      <h2>Vanity Address Miner</h2>
      <p class="tool-desc">Generate Ethereum addresses matching a custom pattern. Runs entirely in your browser. Keys never leave your device.</p>
    </div>
    <div class="tool-body">
      <div class="input-row" style="gap:8px;align-items:flex-end">
        <div class="input-group" style="width:120px">
          <label>Match</label>
          <select id="va-mode" class="mono-input">
            <option value="starts">Starts with</option>
            <option value="ends">Ends with</option>
            <option value="contains">Contains</option>
          </select>
        </div>
        <div class="input-group" style="flex:1">
          <label>Pattern <span class="text-dim">(hex characters only, no 0x prefix)</span></label>
          <input type="text" id="va-pattern" class="mono-input" placeholder="dead" spellcheck="false" style="text-transform:lowercase">
        </div>
        <button id="va-start" class="btn btn-primary">Mine</button>
        <button id="va-stop" class="btn hidden">Stop</button>
      </div>
      <div id="va-difficulty" class="text-dim" style="font-size:11px;margin-top:4px"></div>
      <div id="va-progress" class="status-line" style="margin-top:8px"></div>
      <div class="result-card" style="margin-top:8px;padding:8px 12px;font-size:10px;color:#555;border-color:#1a1a1a">
        All keys are generated locally using ethers.js in a Web Worker. Nothing is transmitted. Treat any key you use with the same security as any other private key.
      </div>
      <div id="va-results" class="output-area"></div>
    </div>
  `

  const patternInput = document.getElementById('va-pattern')
  const modeSelect = document.getElementById('va-mode')
  const startBtn = document.getElementById('va-start')
  const stopBtn = document.getElementById('va-stop')
  const progress = document.getElementById('va-progress')
  const difficultyEl = document.getElementById('va-difficulty')
  const results = document.getElementById('va-results')

  // Restore state if mining was running
  if (globalRunning) {
    patternInput.value = globalPattern
    modeSelect.value = globalMode
    startBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    progress.innerHTML = `<span class="loading">${globalChecked.toLocaleString()} checked</span> <span class="text-dim">${globalRate.toLocaleString()} addr/s</span>`
    // Restore cached matches
    for (const m of globalMatches) renderMatch(m)
  }

  // Show estimated difficulty as user types
  patternInput.addEventListener('input', () => {
    const len = patternInput.value.replace(/[^0-9a-fA-F]/g, '').length
    if (len === 0) { difficultyEl.textContent = ''; return }
    const odds = Math.pow(16, len)
    const est = odds // average attempts needed
    difficultyEl.textContent = `Estimated difficulty: ~1 in ${odds.toLocaleString()} addresses (~${formatTime(est / 3000)} at ~3k addr/s)`
  })

  // Sanitize input to hex only
  patternInput.addEventListener('input', () => {
    patternInput.value = patternInput.value.replace(/[^0-9a-fA-F]/g, '')
  })

  startBtn.addEventListener('click', start)
  stopBtn.addEventListener('click', stop)

  function renderMatch(m) {
    const card = document.createElement('div')
    card.className = 'result-card va-match'
    card.innerHTML = `
      <div style="margin-bottom:6px"><span class="success" style="font-weight:600">Match found!</span> <span class="text-dim">(after ${m.checked.toLocaleString()} attempts, ${formatTime(m.elapsed / 1000)})</span></div>
      <div class="input-group">
        <label>Address</label>
        <div class="mono text-blue va-addr" style="font-size:13px;word-break:break-all">${highlightPattern(m.address, globalPattern, globalMode)}</div>
      </div>
      <div class="input-group" style="margin-top:6px">
        <label>Private Key <span class="text-dim">(click to reveal)</span></label>
        <div class="mono va-key" style="font-size:11px;word-break:break-all;cursor:pointer;color:#555;filter:blur(4px);transition:filter 0.2s" data-key="${esc(m.privateKey)}">Click to reveal</div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn-copy va-copy-addr" data-val="${esc(m.address)}">Copy Address</button>
        <button class="btn-copy va-copy-key" data-val="${esc(m.privateKey)}">Copy Key</button>
      </div>
    `
    results.prepend(card)
    card.querySelector('.va-key').addEventListener('click', function() { this.textContent = this.dataset.key; this.style.filter = 'none'; this.style.color = 'var(--text)'; this.style.cursor = 'default' })
    card.querySelector('.va-copy-addr').addEventListener('click', function() { navigator.clipboard.writeText(this.dataset.val); this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy Address', 1200) })
    card.querySelector('.va-copy-key').addEventListener('click', function() { navigator.clipboard.writeText(this.dataset.val); this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy Key', 1200) })
  }

  function start() {
    const pattern = patternInput.value.trim().toLowerCase()
    if (!pattern) return
    if (!/^[0-9a-f]+$/.test(pattern)) return

    if (pattern.length > 8) {
      progress.innerHTML = '<span class="warning">Patterns longer than 8 chars may take extremely long.</span>'
    }

    if (globalWorker) globalWorker.terminate()
    globalWorker = createMinerWorker()
    globalPattern = pattern
    globalMode = modeSelect.value
    globalMatches = []
    globalChecked = 0
    globalRunning = true
    results.innerHTML = ''
    startBtn.classList.add('hidden')
    stopBtn.classList.remove('hidden')
    showToast('vanity-miner', `Mining 0x${pattern}...`)

    globalWorker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        globalChecked = e.data.checked
        globalRate = e.data.rate
        const progressEl = document.getElementById('va-progress')
        if (progressEl) progressEl.innerHTML = `<span class="loading">${e.data.checked.toLocaleString()} checked</span> <span class="text-dim">${e.data.rate.toLocaleString()} addr/s &middot; ${formatTime(e.data.elapsed / 1000)} elapsed</span>`
        showToast('vanity-miner', `Mining: ${e.data.checked.toLocaleString()} checked (${e.data.rate}/s)`)
      }

      if (e.data.type === 'match') {
        const m = { address: e.data.address, privateKey: e.data.privateKey, checked: e.data.checked, elapsed: e.data.elapsed }
        globalMatches.unshift(m)
        renderMatch(m)
      }
    }

    globalWorker.postMessage({ type: 'start', pattern, mode: modeSelect.value })
  }

  function stop() {
    if (globalWorker) { globalWorker.postMessage({ type: 'stop' }); globalWorker.terminate(); globalWorker = null }
    globalRunning = false
    startBtn.classList.remove('hidden')
    stopBtn.classList.add('hidden')
    removeToast('vanity-miner')
    const progressEl = document.getElementById('va-progress')
    if (progressEl) progressEl.innerHTML = progressEl.innerHTML.replace('loading', 'text-dim') + ' <span class="text-dim">(stopped)</span>'
  }

  function highlightPattern(addr, pattern, mode) {
    const lower = addr.toLowerCase()
    const addrNoPrefix = lower.slice(2)
    let start, end

    if (mode === 'starts') {
      start = 2
      end = 2 + pattern.length
    } else if (mode === 'ends') {
      start = addr.length - pattern.length
      end = addr.length
    } else {
      start = 2 + addrNoPrefix.indexOf(pattern)
      end = start + pattern.length
    }

    return esc(addr.slice(0, start)) +
      `<span class="va-highlight">${esc(addr.slice(start, end))}</span>` +
      esc(addr.slice(end))
  }

  function formatTime(seconds) {
    if (seconds < 60) return Math.round(seconds) + 's'
    if (seconds < 3600) return Math.round(seconds / 60) + 'm'
    if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h'
    return (seconds / 86400).toFixed(1) + 'd'
  }
}
