import { esc, saveState, loadState } from '../shared/formatters.js'
import { analyzeSource, analyzeGasOptimizations } from '../shared/solidity-analyzer.js'
import * as wallet from '../shared/wallet.js'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { solidity } from '@replit/codemirror-lang-solidity'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import { linter } from '@codemirror/lint'

const SOLC_BASE = 'https://binaries.soliditylang.org/bin'
const FILES_KEY = 'anywei_ide_files'
const ACTIVE_FILE_KEY = 'anywei_ide_active'
const DEFAULT_CODE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Example {
    uint256 public value;

    function setValue(uint256 _value) external {
        value = _value;
    }

    function getValue() external view returns (uint256) {
        return value;
    }
}
`

let worker = null
let compilerReady = false
let currentVersion = null

function createWorker() {
  const code = `
    var NPM_MAPPINGS = {
      '@openzeppelin/contracts': 'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts@5.3.0',
      '@openzeppelin/contracts-upgradeable': 'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts-upgradeable@5.3.0'
    };

    // Map import key -> resolved URL (so relative imports from fetched files resolve correctly)
    var keyToUrl = {};

    function toUrl(importPath) {
      if (importPath.startsWith('http://') || importPath.startsWith('https://')) return importPath;
      for (var prefix in NPM_MAPPINGS) {
        if (importPath.startsWith(prefix)) return NPM_MAPPINGS[prefix] + importPath.slice(prefix.length);
      }
      return null;
    }

    function resolveRelative(relativePath, baseUrl) {
      if (!baseUrl) return null;
      var base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
      var combined = base + relativePath;
      // Normalize .. and .
      var parts = combined.split('/');
      var resolved = [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === '..') { if (resolved.length > 0 && resolved[resolved.length-1] !== '') resolved.pop(); }
        else if (parts[i] !== '.') resolved.push(parts[i]);
      }
      return resolved.join('/');
    }

    function resolveImportPath(imp, parentKey) {
      // Absolute URL
      if (imp.startsWith('http://') || imp.startsWith('https://')) return imp;

      // npm-style import
      var directUrl = toUrl(imp);
      if (directUrl) return directUrl;

      // Relative import — resolve against the ACTUAL URL of the parent file
      if (imp.startsWith('./') || imp.startsWith('../')) {
        // First try resolving against the parent's URL
        var parentUrl = keyToUrl[parentKey] || toUrl(parentKey) || parentKey;
        if (parentUrl.startsWith('http')) {
          return resolveRelative(imp, parentUrl);
        }
        // For local files (Contract.sol), try npm-style resolution of the relative path
        // This handles case where a local file does relative imports (unlikely but safe)
        return null;
      }

      return null;
    }

    // Reverse-map a URL back to the @openzeppelin/... style key for solc source registration
    function urlToKey(url) {
      for (var prefix in NPM_MAPPINGS) {
        var base = NPM_MAPPINGS[prefix];
        if (url.startsWith(base)) return prefix + url.slice(base.length);
      }
      return url;
    }

    async function fetchImport(url) {
      try { var res = await fetch(url); if (!res.ok) return null; return await res.text(); }
      catch { return null; }
    }

    async function resolveImports(sources, visited) {
      visited = visited || new Set();
      var pending = []; // { key: solc source key, url: actual fetch URL }

      for (var fileKey in sources) {
        var content = sources[fileKey].content;
        var regex = /import\\s+(?:\\{[^}]*\\}\\s+from\\s+)?["']([^"']+)["']/g;
        var match;
        while ((match = regex.exec(content)) !== null) {
          var imp = match[1];
          if (sources[imp] || visited.has(imp)) continue;

          var url = resolveImportPath(imp, fileKey);
          if (!url || visited.has(url)) continue;

          // Compute the solc key — use @openzeppelin/... style if possible
          var solcKey = urlToKey(url);
          if (sources[solcKey] || visited.has(solcKey)) continue;

          visited.add(imp);
          visited.add(url);
          visited.add(solcKey);
          pending.push({ key: solcKey, url: url });
        }
      }

      if (pending.length === 0) return sources;

      self.postMessage({ type: 'status', message: 'Fetching ' + pending.length + ' import(s)...' });
      var results = await Promise.all(pending.map(function(p) { return fetchImport(p.url); }));

      for (var i = 0; i < pending.length; i++) {
        if (results[i]) {
          var key = pending[i].key;
          var url = pending[i].url;
          sources[key] = { content: results[i] };
          keyToUrl[key] = url;
          // Also register under the raw import string if different
          if (key !== url) {
            sources[url] = { content: results[i] };
            keyToUrl[url] = url;
          }
        }
      }

      // Recurse for nested imports
      return resolveImports(sources, visited);
    }
    self.onmessage = async function(e) {
      if (e.data.type === 'load') {
        try { importScripts(e.data.url); solc = Module; self.postMessage({ type: 'loaded' }); }
        catch(err) { self.postMessage({ type: 'error', error: 'Failed to load compiler: ' + err.message }); }
      }
      if (e.data.type === 'compile') {
        if (!solc) { self.postMessage({ type: 'error', error: 'Compiler not loaded' }); return; }
        try {
          self.postMessage({ type: 'status', message: 'Resolving imports...' });
          var input = e.data.input;
          input.sources = await resolveImports(Object.assign({}, input.sources));
          self.postMessage({ type: 'status', message: 'Compiling...' });
          var compile = solc.cwrap('solidity_compile', 'string', ['string', 'number']);
          var result = compile(JSON.stringify(input), 0);
          self.postMessage({ type: 'result', output: JSON.parse(result) });
        } catch(err) { self.postMessage({ type: 'error', error: 'Compilation failed: ' + err.message }); }
      }
    };
  `
  return new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
}

// ── File manager helpers ────────────────────────────────────

function loadFiles() {
  try {
    const raw = localStorage.getItem(FILES_KEY)
    return raw ? JSON.parse(raw) : { 'Contract.sol': { content: DEFAULT_CODE, modified: Date.now() } }
  } catch { return { 'Contract.sol': { content: DEFAULT_CODE, modified: Date.now() } } }
}

function saveFiles(files) {
  try { localStorage.setItem(FILES_KEY, JSON.stringify(files)) } catch {}
}

function getActiveFile() {
  return localStorage.getItem(ACTIVE_FILE_KEY) || Object.keys(loadFiles())[0] || 'Contract.sol'
}

function setActiveFile(name) {
  localStorage.setItem(ACTIVE_FILE_KEY, name)
}

// ── Render ──────────────────────────────────────────────────

export function render(container, queryParams = {}) {
  container.classList.add('ide-fullwidth')

  container.innerHTML = `
    <div class="ide-layout">
      <div class="ide-toolbar">
        <div class="ide-toolbar-left">
          <select id="ide-version" class="ide-toolbar-select"><option value="">Loading...</option></select>
          <label class="ide-checkbox"><input type="checkbox" id="ide-optimize" checked> Optimizer</label>
          <label class="ide-checkbox"><input type="checkbox" id="ide-analyze" checked> Security</label>
        </div>
        <div class="ide-toolbar-right">
          <button id="ide-flatten" class="ide-find-btn" title="Flatten all imports into single file">Flatten</button>
          <button id="ide-share" class="ide-find-btn" title="Copy shareable link">Share</button>
          <button id="ide-format" class="ide-find-btn" title="Format code">Format</button>
          <button id="ide-compile" class="btn btn-primary" disabled>Compile (Ctrl+Enter)</button>
          <div class="ide-wallet-section" id="ide-wallet-mount"></div>
        </div>
      </div>

      <div class="ide-main">
        <div class="ide-editor-wrap">
          <div id="ide-editor-mount" class="ide-cm-mount"></div>
        </div>

        <!-- File manager panel -->
        <div class="ide-files-pane" id="ide-files-pane">
          <div class="ide-files-header">
            <span>Files</span>
            <div style="display:flex;gap:4px">
              <button class="ide-find-btn" id="ide-file-template" title="New from template">&#9776;</button>
              <button class="ide-find-btn" id="ide-file-new" title="New empty file">+</button>
            </div>
          </div>
          <div id="ide-file-list" class="ide-file-list"></div>
          <div class="ide-files-divider"></div>
          <div class="ide-files-header"><span>Deploy / Interact</span></div>
          <div id="ide-deploy-section" class="ide-deploy-section">
            <div class="ide-artifact-empty" id="ide-deploy-placeholder">Compile &amp; connect wallet to deploy</div>
          </div>
          <div class="ide-files-divider"></div>
          <div class="ide-files-header"><span>Artifacts</span></div>
          <div id="ide-artifact-list" class="ide-artifact-list"></div>
        </div>
      </div>

      <div class="ide-resize-handle" id="ide-resize"></div>

      <div class="ide-terminal-pane" id="ide-terminal-pane">
        <div class="ide-terminal-tabs">
          <button class="ide-term-tab active" data-tab="problems" id="ide-tab-problems">Problems</button>
          <button class="ide-term-tab" data-tab="output">Output</button>
          <button class="ide-term-tab" data-tab="artifacts">Artifacts</button>
        </div>
        <div class="ide-terminal" id="ide-terminal">
          <div class="term-line term-dim">Ready. Press Ctrl+Enter to compile.</div>
        </div>
      </div>
    </div>
  `

  const versionSelect = document.getElementById('ide-version')
  const compileBtn = document.getElementById('ide-compile')
  const optimizeCheck = document.getElementById('ide-optimize')
  const analyzeCheck = document.getElementById('ide-analyze')
  const terminal = document.getElementById('ide-terminal')
  const terminalPane = document.getElementById('ide-terminal-pane')
  const resizeHandle = document.getElementById('ide-resize')
  const problemsTab = document.getElementById('ide-tab-problems')

  let activeTab = 'problems'
  let tabContent = { problems: '', output: '', artifacts: '' }
  let lastArtifacts = null
  let files = loadFiles()
  let activeFileName = getActiveFile()
  let problemCount = 0

  // ── CodeMirror editor ───────────────────────────────────
  const compileKeymap = keymap.of([{
    key: 'Ctrl-Enter',
    mac: 'Cmd-Enter',
    run: () => { compile(); return true }
  }])

  // Live linter — underlines gas optimizations and security issues as you type
  // Helper: get the range of actual code on a line (skip leading whitespace)
  function getCodeRange(doc, lineNum) {
    const line = doc.line(lineNum)
    const text = line.text
    const indent = text.length - text.trimStart().length
    return { from: line.from + indent, to: line.to }
  }

  const solidityLinter = linter((view) => {
    const source = view.state.doc.toString()
    const diagnostics = []

    // Gas optimization tips — underline from the specific column if available
    try {
      const gasTips = analyzeGasOptimizations(source)
      for (const tip of gasTips) {
        const line = view.state.doc.line(tip.line)
        const text = line.text
        const indent = text.length - text.trimStart().length
        // Use the specific column if provided, otherwise start after indentation
        const from = tip.col != null ? line.from + Math.max(tip.col, indent) : line.from + indent
        const to = Math.min(from + 20, line.to)
        if (from >= to) continue
        diagnostics.push({ from, to, severity: 'info', message: `Gas: ${tip.message}`, source: 'anywei' })
      }
    } catch {}

    // Security findings (critical and high only)
    try {
      const findings = analyzeSource(source)
      for (const f of findings) {
        if (f.severity !== 'critical' && f.severity !== 'high') continue
        if (!f.line || f.line < 1) continue
        try {
          const { from, to } = getCodeRange(view.state.doc, f.line)
          if (from >= to) continue
          diagnostics.push({
            from, to,
            severity: f.severity === 'critical' ? 'error' : 'warning',
            message: `${f.title}: ${f.message}`,
            source: 'anywei'
          })
        } catch {}
      }
    } catch {}

    return diagnostics
  }, { delay: 800 })

  let editorView = new EditorView({
    state: EditorState.create({
      doc: files[activeFileName]?.content || DEFAULT_CODE,
      extensions: [
        basicSetup,
        solidity,
        oneDark,
        compileKeymap,
        solidityLinter,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            files[activeFileName] = { content: update.state.doc.toString(), modified: Date.now() }
            saveFiles(files)
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: "'Consolas', 'Courier New', monospace", lineHeight: '1.5' },
          '.cm-content': { padding: '10px 0' },
          '.cm-gutters': { minWidth: '48px' },
          // Gas tips: green wavy underline
          '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline wavy #4ade80', textUnderlineOffset: '3px' },
          // Security warnings: yellow underline
          '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #f59e0b', textUnderlineOffset: '3px' },
          // Security critical: red underline
          '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #ef4444', textUnderlineOffset: '3px' },
        }),
      ]
    }),
    parent: document.getElementById('ide-editor-mount')
  })

  function getSource() { return editorView.state.doc.toString() }
  function setSource(text) {
    editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: text } })
  }

  // ── File Manager ────────────────────────────────────────

  function renderFileList() {
    const list = document.getElementById('ide-file-list')
    list.innerHTML = ''
    for (const name of Object.keys(files).sort()) {
      const item = document.createElement('div')
      item.className = 'ide-file-item' + (name === activeFileName ? ' active' : '')
      item.dataset.filename = name
      item.tabIndex = 0
      item.innerHTML = `<span class="ide-file-name">${esc(name)}</span>`
      item.addEventListener('click', () => { switchFile(name) })
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e, name) })
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); showDeleteConfirm(name) }
        if (e.key === 'F2') { e.preventDefault(); startRename(name) }
        if (e.key === 'ArrowDown') { e.preventDefault(); const next = item.nextElementSibling; if (next) { next.focus(); next.click() } }
        if (e.key === 'ArrowUp') { e.preventDefault(); const prev = item.previousElementSibling; if (prev) { prev.focus(); prev.click() } }
      })
      list.appendChild(item)
    }
    // Focus the active file item so keyboard shortcuts work immediately
    const activeItem = list.querySelector('.ide-file-item.active')
    if (activeItem) activeItem.focus()
  }

  // ── Context Menu ──────────────────────────────────────

  function showContextMenu(e, fileName) {
    closeContextMenu()
    const menu = document.createElement('div')
    menu.className = 'ide-context-menu'
    menu.style.left = e.clientX + 'px'
    menu.style.top = e.clientY + 'px'
    menu.innerHTML = `
      <div class="ide-ctx-item" data-action="rename">Rename <span class="ide-ctx-hint">F2</span></div>
      <div class="ide-ctx-item" data-action="duplicate">Duplicate</div>
      <div class="ide-ctx-divider"></div>
      <div class="ide-ctx-item ide-ctx-danger" data-action="delete">Delete <span class="ide-ctx-hint">Del</span></div>
    `
    menu.addEventListener('click', (ev) => {
      const action = ev.target.closest('.ide-ctx-item')?.dataset.action
      closeContextMenu()
      if (action === 'rename') startRename(fileName)
      else if (action === 'duplicate') duplicateFile(fileName)
      else if (action === 'delete') showDeleteConfirm(fileName)
    })
    document.body.appendChild(menu)

    // Close on any click outside
    const closeHandler = (ev) => { if (!menu.contains(ev.target)) { closeContextMenu(); document.removeEventListener('mousedown', closeHandler) } }
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0)
  }

  function closeContextMenu() {
    document.querySelectorAll('.ide-context-menu').forEach(m => m.remove())
  }

  // ── Rename ────────────────────────────────────────────

  function startRename(fileName) {
    const list = document.getElementById('ide-file-list')
    const item = list.querySelector(`[data-filename="${fileName}"]`)
    if (!item) return
    const nameSpan = item.querySelector('.ide-file-name')
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'ide-file-rename-input'
    input.value = fileName.replace(/\.sol$/, '')
    input.spellcheck = false
    nameSpan.replaceWith(input)
    input.focus()
    input.select()

    function commit() {
      let newName = input.value.trim()
      if (!newName) { renderFileList(); return }
      if (!newName.endsWith('.sol')) newName += '.sol'
      if (newName !== fileName && files[newName]) {
        input.classList.add('ide-rename-error')
        setTimeout(() => input.classList.remove('ide-rename-error'), 600)
        return
      }
      if (newName !== fileName) {
        files[newName] = files[fileName]
        delete files[fileName]
        if (activeFileName === fileName) { activeFileName = newName; setActiveFile(newName) }
        saveFiles(files)
      }
      renderFileList()
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit() }
      if (e.key === 'Escape') renderFileList()
    })
    input.addEventListener('blur', () => setTimeout(() => { if (input.parentNode) commit() }, 100))
  }

  // ── Duplicate ─────────────────────────────────────────

  function duplicateFile(fileName) {
    let base = fileName.replace(/\.sol$/, '')
    let newName = base + '_copy.sol'
    let i = 2
    while (files[newName]) { newName = `${base}_copy${i++}.sol` }
    files[newName] = { content: files[fileName].content, modified: Date.now() }
    saveFiles(files)
    switchFile(newName)
  }

  // ── Delete Confirmation Popup ─────────────────────────

  function showDeleteConfirm(fileName) {
    if (Object.keys(files).length <= 1) return
    closeDeleteConfirm()

    const overlay = document.createElement('div')
    overlay.className = 'ide-confirm-overlay'
    overlay.innerHTML = `
      <div class="ide-confirm-popup">
        <div class="ide-confirm-title">Delete file</div>
        <div class="ide-confirm-message">Are you sure you want to delete <strong>${esc(fileName)}</strong>? This cannot be undone.</div>
        <div class="ide-confirm-actions">
          <button class="btn ide-confirm-cancel">Cancel</button>
          <button class="btn ide-confirm-delete">Delete</button>
        </div>
      </div>
    `
    overlay.querySelector('.ide-confirm-cancel').addEventListener('click', closeDeleteConfirm)
    overlay.querySelector('.ide-confirm-delete').addEventListener('click', () => {
      delete files[fileName]
      saveFiles(files)
      if (activeFileName === fileName) {
        activeFileName = Object.keys(files)[0]
        setActiveFile(activeFileName)
        setSource(files[activeFileName]?.content || '')
      }
      closeDeleteConfirm()
      renderFileList()
    })
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDeleteConfirm() })
    // Escape to cancel
    const escHandler = (e) => { if (e.key === 'Escape') { closeDeleteConfirm(); document.removeEventListener('keydown', escHandler) } }
    document.addEventListener('keydown', escHandler)

    container.appendChild(overlay)
    overlay.querySelector('.ide-confirm-cancel').focus()
  }

  function closeDeleteConfirm() {
    container.querySelectorAll('.ide-confirm-overlay').forEach(el => el.remove())
  }

  function renderArtifactList() {
    const list = document.getElementById('ide-artifact-list')
    if (!lastArtifacts || Object.keys(lastArtifacts).length === 0) {
      list.innerHTML = '<div class="ide-artifact-empty">Compile to see artifacts</div>'
      return
    }
    list.innerHTML = ''
    for (const name of Object.keys(lastArtifacts)) {
      const a = lastArtifacts[name]
      const fns = a.abi.filter(e => e.type === 'function').length
      const evts = a.abi.filter(e => e.type === 'event').length
      const errs = a.abi.filter(e => e.type === 'error').length
      const bcSize = a.deployedBytecode ? (a.deployedBytecode.length - 2) / 2 : 0

      const card = document.createElement('div')
      card.className = 'ide-artifact-card'
      card.innerHTML = `
        <div class="ide-artifact-name">${esc(name)}</div>
        <div class="ide-artifact-stats">${fns} fn &middot; ${evts} evt${errs ? ' &middot; ' + errs + ' err' : ''} &middot; ${bcSize.toLocaleString()}B</div>
        <div class="ide-artifact-actions">
          <button class="ide-art-btn" data-action="artifact" data-name="${esc(name)}" title="Copy full artifact JSON">JSON</button>
          <button class="ide-art-btn" data-action="abi" data-name="${esc(name)}" title="Copy ABI">ABI</button>
          <button class="ide-art-btn" data-action="bytecode" data-name="${esc(name)}" title="Copy bytecode">Byte</button>
          <button class="ide-art-btn" data-action="test" data-name="${esc(name)}" title="Open in Quick Test">Test</button>
        </div>
      `
      list.appendChild(card)
    }
    // Event delegation for artifact buttons
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.ide-art-btn')
      if (!btn) return
      const name = btn.dataset.name
      const a = lastArtifacts[name]
      if (!a) return
      const action = btn.dataset.action
      if (action === 'artifact') { navigator.clipboard.writeText(JSON.stringify(a, null, 2)); flash(btn) }
      else if (action === 'abi') { navigator.clipboard.writeText(JSON.stringify(a.abi, null, 2)); flash(btn) }
      else if (action === 'bytecode') { navigator.clipboard.writeText(a.deployedBytecode || a.bytecode); flash(btn) }
      else if (action === 'test') {
        sessionStorage.setItem('anywei_test_artifact', JSON.stringify(a))
        window.history.pushState(null, '', '/test'); window.dispatchEvent(new PopStateEvent('popstate'))
      }
    })
    function flash(btn) { const t = btn.textContent; btn.textContent = '\u2713'; setTimeout(() => btn.textContent = t, 800) }
  }

  function switchFile(name) {
    // Save current file
    files[activeFileName] = { content: getSource(), modified: Date.now() }
    saveFiles(files)
    // Switch
    activeFileName = name
    setActiveFile(name)
    setSource(files[name]?.content || '')
    renderFileList()
  }

  document.getElementById('ide-file-new').addEventListener('click', () => {
    // Create inline editable entry in the file list
    const list = document.getElementById('ide-file-list')
    const item = document.createElement('div')
    item.className = 'ide-file-item active'
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'ide-file-rename-input'
    input.value = 'NewContract'
    input.spellcheck = false
    item.appendChild(input)
    list.appendChild(item)
    input.focus()
    input.select()

    function commitName() {
      let name = input.value.trim()
      if (!name) { item.remove(); return }
      if (!name.endsWith('.sol')) name += '.sol'
      if (files[name]) {
        // Flash error
        input.classList.add('ide-rename-error')
        setTimeout(() => input.classList.remove('ide-rename-error'), 600)
        return
      }
      files[name] = { content: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\n', modified: Date.now() }
      saveFiles(files)
      switchFile(name)
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitName() }
      if (e.key === 'Escape') { item.remove() }
    })
    input.addEventListener('blur', () => {
      // Small delay so Enter handler fires first
      setTimeout(() => { if (item.parentNode) commitName() }, 100)
    })
  })

  // ── Contract Templates ─────────────────────────────────

  const TEMPLATES = {
    'ERC20 Token': {
      name: 'MyToken.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, Ownable {
    constructor() ERC20("MyToken", "MTK") Ownable(msg.sender) {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
`
    },
    'ERC721 NFT': {
      name: 'MyNFT.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyNFT is ERC721, Ownable {
    uint256 private _nextTokenId;

    constructor() ERC721("MyNFT", "MNFT") Ownable(msg.sender) {}

    function mint(address to) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _mint(to, tokenId);
        return tokenId;
    }
}
`
    },
    'ERC1155 Multi-Token': {
      name: 'MyMultiToken.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyMultiToken is ERC1155, Ownable {
    constructor() ERC1155("https://myapi.com/token/{id}.json") Ownable(msg.sender) {}

    function mint(address to, uint256 id, uint256 amount) external onlyOwner {
        _mint(to, id, amount, "");
    }

    function mintBatch(address to, uint256[] calldata ids, uint256[] calldata amounts) external onlyOwner {
        _mintBatch(to, ids, amounts, "");
    }
}
`
    },
    'Upgradeable (UUPS)': {
      name: 'MyUpgradeable.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract MyUpgradeable is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    uint256 public value;

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function setValue(uint256 _value) external onlyOwner {
        value = _value;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
`
    },
    'Simple Vault': {
      name: 'Vault.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Vault {
    mapping(address => uint256) public balances;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdraw(msg.sender, amount);
    }

    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }
}
`
    },
    'Blank Contract': {
      name: 'Contract.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MyContract {

}
`
    }
  }

  document.getElementById('ide-file-template').addEventListener('click', (e) => {
    e.stopPropagation()
    closeContextMenu()
    const btn = document.getElementById('ide-file-template')
    const rect = btn.getBoundingClientRect()
    const menu = document.createElement('div')
    menu.className = 'ide-context-menu'
    menu.style.left = rect.left + 'px'
    menu.style.top = (rect.bottom + 4) + 'px'

    for (const [label, tmpl] of Object.entries(TEMPLATES)) {
      const item = document.createElement('div')
      item.className = 'ide-ctx-item'
      item.textContent = label
      item.addEventListener('click', () => {
        let name = tmpl.name
        let i = 2
        while (files[name]) { name = tmpl.name.replace('.sol', `${i++}.sol`) }
        files[name] = { content: tmpl.content, modified: Date.now() }
        saveFiles(files)
        switchFile(name)
        closeContextMenu()
      })
      menu.appendChild(item)
    }
    document.body.appendChild(menu)
    const closeHandler = (ev) => { if (!menu.contains(ev.target)) { closeContextMenu(); document.removeEventListener('mousedown', closeHandler) } }
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0)
  })

  renderFileList()
  renderArtifactList()

  // ── Tab switching ───────────────────────────────────────

  container.querySelectorAll('.ide-term-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.ide-term-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      activeTab = tab.dataset.tab
      terminal.innerHTML = tabContent[activeTab] || ''
      terminal.scrollTop = terminal.scrollHeight
    })
  })

  function switchTab(tab) {
    activeTab = tab
    container.querySelectorAll('.ide-term-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab))
    terminal.innerHTML = tabContent[tab] || ''
    terminal.scrollTop = terminal.scrollHeight
  }

  function setTerminal(tab, html) {
    tabContent[tab] = html
    if (activeTab === tab) { terminal.innerHTML = html; terminal.scrollTop = terminal.scrollHeight }
  }

  function appendTerminal(tab, html) {
    tabContent[tab] = (tabContent[tab] || '') + html
    if (activeTab === tab) { terminal.innerHTML = tabContent[tab]; terminal.scrollTop = terminal.scrollHeight }
  }

  function updateProblemsCount(count) {
    problemCount = count
    problemsTab.textContent = count > 0 ? `Problems (${count})` : 'Problems'
  }

  // ── Artifact button delegation ──────────────────────────

  terminal.addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn || !lastArtifacts) return
    const name = btn.dataset.name
    const a = lastArtifacts[name]
    if (!a) return
    if (btn.classList.contains('ide-copy-artifact')) {
      navigator.clipboard.writeText(JSON.stringify(a, null, 2))
      btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy Artifact', 1200)
    } else if (btn.classList.contains('ide-copy-abi')) {
      navigator.clipboard.writeText(JSON.stringify(a.abi, null, 2))
      btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy ABI', 1200)
    } else if (btn.classList.contains('ide-copy-bytecode')) {
      navigator.clipboard.writeText(a.deployedBytecode || a.bytecode)
      btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy Bytecode', 1200)
    } else if (btn.classList.contains('ide-to-test')) {
      sessionStorage.setItem('anywei_test_artifact', JSON.stringify(a))
      window.history.pushState(null, '', '/test'); window.dispatchEvent(new PopStateEvent('popstate'))
    } else if (btn.classList.contains('ide-to-gas')) {
      sessionStorage.setItem('anywei_test_artifact', JSON.stringify(a))
      window.history.pushState(null, '', '/gas'); window.dispatchEvent(new PopStateEvent('popstate'))
    }
  })

  // ── Resize handle ───────────────────────────────────────

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = terminalPane.offsetHeight
    const onMove = (ev) => { terminalPane.style.height = Math.max(80, startH + (startY - ev.clientY)) + 'px' }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })

  compileBtn.addEventListener('click', compile)

  // ── Wallet Connection (RainbowKit) ───────────────────────

  let deployedContracts = []
  try { deployedContracts = JSON.parse(localStorage.getItem('anywei_deployed')) || [] } catch {}

  // Mount RainbowKit into the toolbar
  wallet.mountWallet(document.getElementById('ide-wallet-mount'))

  wallet.onWalletChange(({ account, chainId, chainName }) => {
    if (account) {
      const short = account.slice(0, 6) + '...' + account.slice(-4)
      appendTerminal('output', `<div class="term-line term-success">Wallet: ${short} on ${chainName || 'Chain ' + chainId}</div>`)
    }
    renderDeploySection()
  })

  // ── Deploy Section ──────────────────────────────────────

  function renderDeploySection() {
    const section = document.getElementById('ide-deploy-section')
    const connected = wallet.getState().connected

    const { chainName, chainId } = wallet.getState()

    if (!connected || !lastArtifacts || Object.keys(lastArtifacts).length === 0) {
      section.innerHTML = `<div class="ide-artifact-empty">${!connected ? 'Connect wallet to deploy' : 'Compile first'}</div>`
      // Show deployed contracts even without new compilation
      if (deployedContracts.length > 0) renderDeployedList(section)
      return
    }

    let html = `<div class="ide-deploy-chain">Deploying to: <strong>${esc(chainName || 'Chain ' + chainId)}</strong>${chainId ? ` (${chainId})` : ''}</div>`
    for (const [name, a] of Object.entries(lastArtifacts)) {
      const hasConstructor = a.abi.some(e => e.type === 'constructor' && e.inputs?.length > 0)
      html += `<div class="ide-deploy-card">
        <div class="ide-artifact-name">${esc(name)}</div>
        ${hasConstructor ? `<div class="ide-deploy-constructor" id="ide-ctor-${esc(name)}"></div>` : ''}
        <button class="ide-art-btn ide-deploy-btn" data-name="${esc(name)}" style="margin-top:4px;width:100%">Deploy ${esc(name)}</button>
      </div>`
    }
    section.innerHTML = html

    // Render constructor param inputs
    for (const [name, a] of Object.entries(lastArtifacts)) {
      const ctor = a.abi.find(e => e.type === 'constructor')
      if (ctor?.inputs?.length > 0) {
        const ctorDiv = document.getElementById(`ide-ctor-${name}`)
        if (ctorDiv) {
          ctorDiv.innerHTML = ctor.inputs.map((inp, i) => `
            <input type="text" class="ide-file-rename-input ide-ctor-param" data-contract="${esc(name)}" data-idx="${i}"
              placeholder="${esc(inp.name || 'arg' + i)} (${esc(inp.type)})" spellcheck="false" style="margin:2px 0">
          `).join('')
        }
      }
    }

    // Deploy button handlers
    section.querySelectorAll('.ide-deploy-btn').forEach(btn => {
      btn.addEventListener('click', () => deployContract(btn.dataset.name))
    })

    if (deployedContracts.length > 0) renderDeployedList(section)
  }

  function renderDeployedList(section) {
    let html = '<div class="ide-files-divider" style="margin:6px 0"></div>'
    for (const dc of deployedContracts) {
      html += `<div class="ide-deployed-card">
        <div class="ide-artifact-name" style="font-size:11px">${esc(dc.name)}</div>
        <div class="ide-artifact-stats" style="cursor:pointer" title="Click to copy" onclick="navigator.clipboard.writeText('${dc.address}')">${dc.address.slice(0, 8)}...${dc.address.slice(-6)}</div>
        <button class="ide-art-btn ide-interact-btn" data-addr="${dc.address}" data-name="${esc(dc.name)}" style="width:100%">Interact</button>
      </div>`
    }
    section.insertAdjacentHTML('beforeend', html)

    section.querySelectorAll('.ide-interact-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dc = deployedContracts.find(c => c.address === btn.dataset.addr)
        if (dc) openInteractPanel(dc)
      })
    })
  }

  async function deployContract(name) {
    const a = lastArtifacts[name]
    if (!a) return
    if (!wallet.getState().connected) { appendTerminal('output', '<div class="term-line term-error">Connect wallet first</div>'); return }

    const btn = document.querySelector(`.ide-deploy-btn[data-name="${name}"]`)
    if (btn) { btn.disabled = true; btn.textContent = 'Deploying...' }
    switchTab('output')

    try {
      // Collect constructor args
      const ctor = a.abi.find(e => e.type === 'constructor')
      const args = []
      if (ctor?.inputs?.length) {
        const paramEls = document.querySelectorAll(`.ide-ctor-param[data-contract="${name}"]`)
        for (let i = 0; i < ctor.inputs.length; i++) {
          const raw = paramEls[i]?.value?.trim() || ''
          args.push(coerceParam(raw, ctor.inputs[i].type))
        }
      }

      appendTerminal('output', `<div class="term-line term-info">Deploying ${esc(name)}...</div>`)
      const result = await wallet.deployContract({ bytecode: a.bytecode, abi: a.abi, constructorArgs: args })

      deployedContracts.push({ name, address: result.address, abi: a.abi })
      try { localStorage.setItem('anywei_deployed', JSON.stringify(deployedContracts)) } catch {}
      appendTerminal('output', `<div class="term-line term-success">Deployed ${esc(name)} at ${result.address}</div>`)
      appendTerminal('output', `<div class="term-line term-dim">Tx: ${result.hash} | Gas: ${result.gasUsed.toString()}</div>`)
      renderDeploySection()
    } catch (e) {
      appendTerminal('output', `<div class="term-line term-error">Deploy failed: ${esc(e.message)}</div>`)
    }

    if (btn) { btn.disabled = false; btn.textContent = `Deploy ${name}` }
  }

  // ── Interact Panel ──────────────────────────────────────

  function openInteractPanel(dc) {
    switchTab('output')
    const fns = dc.abi.filter(e => e.type === 'function')

    let interactHtml = `<div class="term-line term-bright">${esc(dc.name)} at ${dc.address.slice(0, 10)}...</div>`
    interactHtml += '<div class="ide-interact-panel">'

    for (const fn of fns) {
      const isView = fn.stateMutability === 'view' || fn.stateMutability === 'pure'
      const inputs = fn.inputs || []
      interactHtml += `<div class="ide-interact-fn">
        <div class="ide-interact-fn-header">
          <span class="text-purple">${esc(fn.name)}</span>
          <span class="text-dim">(${inputs.map(i => i.type).join(', ')})</span>
          ${isView ? '<span class="badge view-badge">view</span>' : '<span class="badge payable-badge">write</span>'}
        </div>
        ${inputs.map((inp, i) => `<input type="text" class="ide-file-rename-input ide-interact-param" data-fn="${esc(fn.name)}" data-idx="${i}" placeholder="${esc(inp.name || 'arg' + i)} (${esc(inp.type)})" spellcheck="false" style="margin:2px 0">`).join('')}
        ${fn.stateMutability === 'payable' ? `<input type="text" class="ide-file-rename-input ide-interact-value" data-fn="${esc(fn.name)}" placeholder="ETH value (wei)" spellcheck="false" style="margin:2px 0">` : ''}
        <button class="ide-art-btn ide-call-btn" data-fn="${esc(fn.name)}" data-addr="${dc.address}" style="margin-top:2px">${isView ? 'Call' : 'Send Tx'}</button>
        <div class="ide-interact-result" id="ide-result-${esc(fn.name)}"></div>
      </div>`
    }

    interactHtml += '</div>'
    setTerminal('output', interactHtml)

    // Bind call buttons
    terminal.querySelectorAll('.ide-call-btn').forEach(btn => {
      btn.addEventListener('click', () => callFunction(dc, btn.dataset.fn, btn))
    })
  }

  async function callFunction(dc, fnName, btn) {
    const fnAbi = dc.abi.find(e => e.type === 'function' && e.name === fnName)
    if (!fnAbi) return
    const resultDiv = document.getElementById(`ide-result-${fnName}`)

    const inputs = fnAbi.inputs || []
    const args = []
    const paramEls = terminal.querySelectorAll(`.ide-interact-param[data-fn="${fnName}"]`)
    for (let i = 0; i < inputs.length; i++) {
      args.push(coerceParam(paramEls[i]?.value?.trim() || '', inputs[i].type))
    }

    const valueEl = terminal.querySelector(`.ide-interact-value[data-fn="${fnName}"]`)
    const value = valueEl?.value.trim() ? BigInt(valueEl.value.trim()) : 0n

    btn.disabled = true
    btn.textContent = '...'
    resultDiv.innerHTML = '<span class="loading">Running...</span>'

    try {
      const result = await wallet.callContract({ address: dc.address, abi: dc.abi, functionName: fnName, args, value })

      if (result.result !== null && result.result !== undefined) {
        const display = typeof result.result === 'bigint' ? result.result.toString() : JSON.stringify(result.result, (_, v) => typeof v === 'bigint' ? v.toString() : v)
        resultDiv.innerHTML = `<span class="term-success">${esc(display)}</span>`
      } else if (result.hash) {
        resultDiv.innerHTML = `<span class="term-success">Tx: ${result.hash.slice(0, 14)}... | Gas: ${result.receipt?.gasUsed?.toString() || '?'}</span>`
      }
    } catch (e) {
      resultDiv.innerHTML = `<span class="term-error">${esc(e.message?.slice(0, 100) || String(e))}</span>`
    }

    const isView = fnAbi.stateMutability === 'view' || fnAbi.stateMutability === 'pure'
    btn.disabled = false
    btn.textContent = isView ? 'Call' : 'Send Tx'
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
    if (type.startsWith('bytes')) return raw.startsWith('0x') ? raw : '0x' + raw
    if (type.endsWith('[]')) { try { return JSON.parse(raw) } catch { return raw.split(',').map(s => s.trim()) } }
    return raw
  }

  // Share via compressed URL
  document.getElementById('ide-share').addEventListener('click', () => {
    const source = getSource()
    try {
      const compressed = btoa(unescape(encodeURIComponent(source)))
      const url = `${window.location.origin}/ide?code=${encodeURIComponent(compressed)}`
      navigator.clipboard.writeText(url)
      const btn = document.getElementById('ide-share')
      btn.textContent = 'Copied!'
      setTimeout(() => btn.textContent = 'Share', 1200)
    } catch (e) {
      appendTerminal('output', `<div class="term-line term-error">Share failed: ${esc(e.message)}</div>`)
    }
  })

  // Load shared code from URL
  if (queryParams.code) {
    try {
      const decoded = decodeURIComponent(escape(atob(queryParams.code)))
      files[activeFileName] = { content: decoded, modified: Date.now() }
      saveFiles(files)
      setSource(decoded)
    } catch {}
  }

  // Basic code formatter (normalize indentation)
  document.getElementById('ide-format').addEventListener('click', () => {
    const source = getSource()
    const lines = source.split('\n')
    let indent = 0
    const formatted = lines.map(line => {
      const trimmed = line.trim()
      if (!trimmed) return ''
      // Decrease indent for closing braces
      if (trimmed.startsWith('}') || trimmed.startsWith(')')) indent = Math.max(0, indent - 1)
      const result = '    '.repeat(indent) + trimmed
      // Increase indent for opening braces
      if (trimmed.endsWith('{') || trimmed.endsWith('(')) indent++
      // Adjust for single-line open+close like "} else {"
      if (trimmed.startsWith('}') && trimmed.endsWith('{')) { /* indent stays same, already decremented+incremented */ }
      return result
    }).join('\n')
    setSource(formatted)
  })

  // Contract flattener — resolve all imports and concatenate into single file
  document.getElementById('ide-flatten').addEventListener('click', async () => {
    const btn = document.getElementById('ide-flatten')
    const source = getSource()
    btn.textContent = 'Flattening...'
    btn.disabled = true

    try {
      // Use the same import resolution the compiler uses, but just concatenate sources
      const importRegex = /import\s+(?:\{[^}]*\}\s+from\s+)?["']([^"']+)["']/g
      const resolved = new Map()
      resolved.set(activeFileName, source)

      async function resolveFile(content, parentKey) {
        let match
        const regex = new RegExp(importRegex.source, 'g')
        while ((match = regex.exec(content)) !== null) {
          const imp = match[1]
          if (resolved.has(imp)) continue

          let url = null
          const npmMappings = { '@openzeppelin/contracts': 'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts@5.3.0', '@openzeppelin/contracts-upgradeable': 'https://cdn.jsdelivr.net/npm/@openzeppelin/contracts-upgradeable@5.3.0' }

          // Resolve to URL
          if (imp.startsWith('http')) url = imp
          else {
            for (const [prefix, base] of Object.entries(npmMappings)) {
              if (imp.startsWith(prefix)) { url = base + imp.slice(prefix.length); break }
            }
          }
          if (!url && (imp.startsWith('./') || imp.startsWith('../')) && parentKey) {
            const parentUrl = Object.entries(npmMappings).reduce((u, [p, b]) => parentKey.startsWith(p) ? b + parentKey.slice(p.length) : u, parentKey)
            if (parentUrl.startsWith('http')) {
              const base = parentUrl.substring(0, parentUrl.lastIndexOf('/') + 1)
              const parts = (base + imp).split('/')
              const norm = []
              for (const p of parts) { if (p === '..') norm.pop(); else if (p !== '.') norm.push(p) }
              url = norm.join('/')
            }
          }

          if (!url) continue
          try {
            const res = await fetch(url)
            if (!res.ok) continue
            const text = await res.text()
            // Store under the import path
            resolved.set(imp, text)
            // Recursively resolve nested imports
            await resolveFile(text, imp)
          } catch {}
        }
      }

      appendTerminal('output', '<div class="term-line term-info">Resolving imports for flattening...</div>')
      await resolveFile(source, activeFileName)

      // Build flattened output
      const seen = new Set()
      let flat = ''
      let mainPragma = ''
      let mainLicense = ''

      // Extract pragma and license from main file
      for (const line of source.split('\n')) {
        if (line.trim().startsWith('pragma ')) mainPragma = line.trim()
        if (line.trim().startsWith('// SPDX-License-Identifier:')) mainLicense = line.trim()
      }

      if (mainLicense) flat += mainLicense + '\n'
      if (mainPragma) flat += mainPragma + '\n\n'

      // Add all resolved dependencies first (skip pragma/license/import lines)
      for (const [key, content] of resolved) {
        if (key === activeFileName) continue
        flat += `// ---- ${key} ----\n`
        for (const line of content.split('\n')) {
          const t = line.trim()
          if (t.startsWith('pragma ')) continue
          if (t.startsWith('// SPDX-License-Identifier:')) continue
          if (t.match(/^import\s/)) continue
          flat += line + '\n'
        }
        flat += '\n'
      }

      // Add main file (skip pragma/license/import lines)
      flat += `// ---- ${activeFileName} ----\n`
      for (const line of source.split('\n')) {
        const t = line.trim()
        if (t.startsWith('pragma ')) continue
        if (t.startsWith('// SPDX-License-Identifier:')) continue
        if (t.match(/^import\s/)) continue
        flat += line + '\n'
      }

      // Create a new file with the flattened source
      const flatName = activeFileName.replace('.sol', '.flat.sol')
      files[flatName] = { content: flat, modified: Date.now() }
      saveFiles(files)
      switchFile(flatName)
      appendTerminal('output', `<div class="term-line term-success">Flattened ${resolved.size} files into ${flatName}</div>`)
    } catch (e) {
      appendTerminal('output', `<div class="term-line term-error">Flatten failed: ${esc(e.message)}</div>`)
    }

    btn.textContent = 'Flatten'
    btn.disabled = false
  })

  loadVersions()

  // ── Compiler ────────────────────────────────────────────

  async function loadVersions() {
    try {
      const res = await fetch(`${SOLC_BASE}/list.json`)
      const data = await res.json()
      const releases = data.releases || {}
      const versions = Object.keys(releases).sort((a, b) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
        for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pb[i] - pa[i] }
        return 0
      }).slice(0, 30)
      versionSelect.innerHTML = versions.map((v, i) =>
        `<option value="${releases[v]}" ${i === 0 ? 'selected' : ''}>${v}${i === 0 ? ' (latest)' : ''}</option>`
      ).join('')
      compileBtn.disabled = false
    } catch (e) {
      versionSelect.innerHTML = '<option value="">Failed</option>'
    }
  }

  function loadCompiler(url) {
    return new Promise((resolve, reject) => {
      if (worker) worker.terminate()
      worker = createWorker()
      worker.onmessage = (e) => {
        if (e.data.type === 'loaded') { compilerReady = true; resolve() }
        else if (e.data.type === 'status') appendTerminal('output', `<div class="term-line term-dim">${esc(e.data.message)}</div>`)
        else if (e.data.type === 'error') reject(new Error(e.data.error))
      }
      worker.onerror = (e) => reject(new Error(e.message))
      worker.postMessage({ type: 'load', url })
    })
  }

  function doCompile(input) {
    return new Promise((resolve, reject) => {
      const handler = (e) => {
        if (e.data.type === 'result') { worker.removeEventListener('message', handler); resolve(e.data.output) }
        else if (e.data.type === 'error') { worker.removeEventListener('message', handler); reject(new Error(e.data.error)) }
        else if (e.data.type === 'status') appendTerminal('output', `<div class="term-line term-dim">${esc(e.data.message)}</div>`)
      }
      worker.addEventListener('message', handler)
      worker.postMessage({ type: 'compile', input })
    })
  }

  async function compile() {
    // Save current file first
    files[activeFileName] = { content: getSource(), modified: Date.now() }
    saveFiles(files)

    const source = getSource()
    const versionFile = versionSelect.value
    if (!source.trim() || !versionFile) return

    compileBtn.disabled = true
    compileBtn.textContent = 'Compiling...'
    setTerminal('problems', '')
    setTerminal('output', '')
    setTerminal('artifacts', '')
    switchTab('output')
    updateProblemsCount(0)

    if (!compilerReady || !worker || currentVersion !== versionFile) {
      appendTerminal('output', '<div class="term-line term-info">Loading compiler (~8MB, cached after first load)...</div>')
      try {
        await loadCompiler(`${SOLC_BASE}/${versionFile}`)
        currentVersion = versionFile
        appendTerminal('output', '<div class="term-line term-success">Compiler loaded.</div>')
      } catch (e) {
        appendTerminal('output', `<div class="term-line term-error">Error: ${esc(e.message)}</div>`)
        compileBtn.disabled = false; compileBtn.textContent = 'Compile (Ctrl+Enter)'; return
      }
    }

    appendTerminal('output', '<div class="term-line term-info">Compiling...</div>')

    const input = {
      language: 'Solidity',
      sources: { [activeFileName]: { content: source } },
      settings: {
        optimizer: { enabled: optimizeCheck.checked, runs: 200 },
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
      }
    }

    try {
      const result = await doCompile(input)
      renderResult(result, source)
    } catch (e) {
      appendTerminal('output', `<div class="term-line term-error">${esc(e.message)}</div>`)
    }

    compileBtn.disabled = false
    compileBtn.textContent = 'Compile (Ctrl+Enter)'
  }

  function renderResult(result, source) {
    const errors = result.errors || []
    const fatalErrors = errors.filter(e => e.severity === 'error')
    const warnings = errors.filter(e => e.severity === 'warning')

    let problemsHtml = ''
    let totalProblems = fatalErrors.length + warnings.length

    if (fatalErrors.length) {
      for (const err of fatalErrors) problemsHtml += `<div class="term-line term-error">${esc(err.formattedMessage || err.message)}</div>`
    }
    if (warnings.length) {
      for (const w of warnings) problemsHtml += `<div class="term-line term-warning">${esc(w.formattedMessage || w.message)}</div>`
    }

    // Security analysis — group duplicate findings
    if (analyzeCheck.checked && !fatalErrors.length) {
      const findings = analyzeSource(source)
      if (findings.length > 0) {
        totalProblems += findings.length
        problemsHtml += '<div class="term-line term-dim" style="margin-top:8px;border-bottom:1px solid #3c3c3c;padding-bottom:4px">SECURITY ANALYSIS</div>'

        // Group by title
        const groups = new Map()
        for (const f of findings) {
          const key = f.title
          if (!groups.has(key)) groups.set(key, { severity: f.severity, title: f.title, message: f.message, items: [] })
          groups.get(key).items.push(f)
        }

        for (const [, group] of groups) {
          const cls = group.severity === 'critical' ? 'term-error' : group.severity === 'high' ? 'term-warning' : group.severity === 'medium' ? 'term-warn-dim' : 'term-info'
          const count = group.items.length

          if (count === 1) {
            const f = group.items[0]
            problemsHtml += `<div class="term-line ${cls}"><span class="term-severity">[${f.severity.toUpperCase()}]</span> ${esc(f.title)}${f.line ? ` <span class="term-dim">(line ${f.line})</span>` : ''}</div><div class="term-line term-dim" style="padding-left:16px;font-size:11px">${esc(f.message)}</div>`
          } else {
            // Collapsible group
            problemsHtml += `<details class="term-group"><summary class="term-line ${cls}"><span class="term-severity">[${group.severity.toUpperCase()}]</span> ${esc(group.title)} <span class="term-group-count">&times;${count}</span></summary>`
            problemsHtml += `<div class="term-line term-dim" style="padding-left:16px;font-size:11px">${esc(group.message)}</div>`
            for (const f of group.items) {
              problemsHtml += `<div class="term-line term-dim" style="padding-left:16px;font-size:11px">&bull; line ${f.line || '?'}</div>`
            }
            problemsHtml += '</details>'
          }
        }
      } else {
        problemsHtml += '<div class="term-line term-success" style="margin-top:8px">No security issues detected.</div>'
      }
    }

    if (!problemsHtml) problemsHtml = '<div class="term-line term-success">No errors or warnings.</div>'
    setTerminal('problems', problemsHtml)
    updateProblemsCount(totalProblems)

    if (fatalErrors.length) {
      appendTerminal('output', `<div class="term-line term-error">Compilation failed with ${fatalErrors.length} error(s).</div>`)
      switchTab('problems')
      return
    }

    appendTerminal('output', `<div class="term-line term-success">Compiled successfully.${warnings.length ? ` ${warnings.length} warning(s).` : ''}</div>`)

    // Artifacts
    const allContracts = result.contracts || {}
    const artifacts = {}
    let artHtml = ''

    for (const [fileName, fileContracts] of Object.entries(allContracts)) {
      for (const [name, contract] of Object.entries(fileContracts)) {
        const abi = contract.abi || []
        const bytecode = contract.evm?.bytecode?.object || ''
        const deployedBytecode = contract.evm?.deployedBytecode?.object || ''
        if (!bytecode && !abi.length) continue
        // Skip interfaces and abstract contracts (no bytecode = can't deploy)
        if (!bytecode || bytecode.length < 4) continue
        artifacts[name] = { contractName: name, abi, bytecode: '0x' + bytecode, deployedBytecode: '0x' + deployedBytecode }

        // Contract size monitor
        const deployedSize = deployedBytecode ? deployedBytecode.length / 2 : 0
        const sizeLimit = 24576 // 24KB EIP-170 limit
        const sizePct = Math.min(100, (deployedSize / sizeLimit) * 100)
        const sizeClass = sizePct > 90 ? 'term-error' : sizePct > 75 ? 'term-warning' : 'term-success'
        const sizeBar = `<div class="size-bar"><div class="size-bar-fill ${sizeClass}" style="width:${sizePct}%"></div></div>`

        appendTerminal('output', `<div class="term-line term-bright" style="margin-top:6px">${esc(name)}</div>`)
        appendTerminal('output', `<div class="term-line">${sizeBar}<span class="text-dim" style="font-size:10px">${deployedSize.toLocaleString()} / ${sizeLimit.toLocaleString()} bytes (${sizePct.toFixed(1)}%)</span> <span class="${sizeClass}" style="font-size:10px">${sizePct > 90 ? 'NEAR LIMIT!' : sizePct > 75 ? 'Watch size' : 'OK'}</span></div>`)
        artHtml += `<div class="term-artifact">
          <div class="term-line term-bright">${esc(name)}</div>
          <div class="term-line term-dim">${abi.filter(e => e.type === 'function').length} functions &middot; ${abi.filter(e => e.type === 'event').length} events &middot; ${(bytecode.length / 2).toLocaleString()} bytes</div>
          <div class="term-actions">
            <button class="btn-copy ide-copy-artifact" data-name="${esc(name)}">Copy Artifact</button>
            <button class="btn-copy ide-copy-abi" data-name="${esc(name)}">Copy ABI</button>
            <button class="btn-copy ide-copy-bytecode" data-name="${esc(name)}">Copy Bytecode</button>
            <button class="btn-copy ide-to-test" data-name="${esc(name)}">Quick Test</button>
            <button class="btn-copy ide-to-gas" data-name="${esc(name)}">Gas</button>
          </div>
        </div>`
      }
    }

    lastArtifacts = artifacts
    setTerminal('artifacts', artHtml || '<div class="term-line term-dim">No artifacts.</div>')
    try { localStorage.setItem('anywei_compiled', JSON.stringify(artifacts, (_, v) => typeof v === 'bigint' ? v.toString() : v)) } catch {}

    switchTab(totalProblems > 0 ? 'problems' : 'artifacts')
    renderArtifactList()
    renderDeploySection()
  }
}
