import { parse, visit } from '@solidity-parser/parser'

// Severity levels
const CRITICAL = 'critical'
const HIGH = 'high'
const MEDIUM = 'medium'
const INFO = 'info'

// ─── Public API ─────────────────────────────────────────────

/**
 * Analyze Solidity source for security issues.
 *
 * @param {string} source - The Solidity source.
 * @param {object} [options]
 * @param {Array<{severity,message,formattedMessage,sourceLocation}>} [options.solcWarnings]
 *        solc compiler warnings to merge into findings.
 * @param {boolean} [options.magicNumbers=false] - include magic-number hints (noisy).
 * @param {Object<string,string>} [options.severityOverrides]
 *        Map of finding title → new severity. E.g. {"Magic number":"info"}.
 * @param {string[]} [options.excludeTitles] - finding titles to suppress.
 * @returns {Array<{severity,line,title,message}>}
 */
// Cache the last (source, options) → findings. Live linter re-runs on every
// edit after a debounce — skipping the parse for unchanged input is cheap.
let _cacheSrc = null
let _cacheOptsKey = null
let _cacheFindings = null

export function analyzeSource(source, options = {}) {
  const {
    solcWarnings = [],
    magicNumbers = false,
    severityOverrides = null,
    excludeTitles = null,
  } = options

  // Cache: identical source + identical options → return last result
  const optsKey = JSON.stringify([solcWarnings.length, magicNumbers, severityOverrides, excludeTitles])
  if (source === _cacheSrc && optsKey === _cacheOptsKey && _cacheFindings) {
    return _cacheFindings
  }

  // Parse AST
  let ast
  try {
    ast = parse(source, { loc: true, range: true, tolerant: true })
  } catch (e) {
    const out = [{ severity: INFO, line: 0, title: 'Parse error', message: `Could not parse source for analysis: ${e.message}` }]
    _cacheSrc = source
    _cacheOptsKey = optsKey
    _cacheFindings = out
    return out
  }

  const ctx = buildContext(ast, source)
  const findings = []

  // Run all detectors
  detectFloatingPragma(ctx, findings)
  detectTxOrigin(ctx, findings)
  detectSelfdestruct(ctx, findings)
  detectReentrancy(ctx, findings)
  detectUncheckedCall(ctx, findings)
  detectMissingAccessControl(ctx, findings)
  detectUnboundedLoop(ctx, findings)
  detectEthInLoop(ctx, findings)
  detectMissingZeroCheck(ctx, findings)
  detectMissingEvents(ctx, findings)
  detectBlockTimestamp(ctx, findings)
  detectUnsafeERC20(ctx, findings)
  detectUncheckedMath(ctx, findings)
  // Tier 1 detectors
  detectArbitraryFrom(ctx, findings)
  detectEcrecoverNoZero(ctx, findings)
  detectPredictableRandomness(ctx, findings)
  detectEncodePackedCollision(ctx, findings)
  detectDivBeforeMul(ctx, findings)
  detectApproveRace(ctx, findings)
  detectHardcodedGas(ctx, findings)
  detectShadowedState(ctx, findings)
  detectReturnBomb(ctx, findings)
  // Tier 2 detectors
  detectDangerousUnchecked(ctx, findings)
  detectUpgradeablePatterns(ctx, findings)
  detectTransferDeprecated(ctx, findings)
  // Style detectors
  detectModifierOrdering(ctx, findings)
  detectUnusedStateVars(ctx, findings)
  detectUnusedFunctions(ctx, findings)
  if (magicNumbers) detectMagicNumbers(ctx, findings)

  if (solcWarnings.length) mergeSolcWarnings(solcWarnings, findings)

  // Severity overrides
  if (severityOverrides) {
    for (const f of findings) {
      if (severityOverrides[f.title]) f.severity = severityOverrides[f.title]
    }
  }

  // Exclude titles
  let out = findings
  if (excludeTitles?.length) {
    const skip = new Set(excludeTitles)
    out = findings.filter(f => !skip.has(f.title))
  }

  // Sort by severity then line
  const order = { critical: 0, high: 1, medium: 2, info: 3 }
  out.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.line - b.line))

  _cacheSrc = source
  _cacheOptsKey = optsKey
  _cacheFindings = out
  return out
}

// ─── Context / symbol table ─────────────────────────────────

/**
 * Build a per-contract symbol table for the whole AST. Called once per
 * analyzeSource() invocation; every detector reads from it.
 *
 * ctx.contracts: Map<name, ContractInfo>
 *   ContractInfo: { name, node, kind, stateVars, functions, events, errors,
 *                   modifiers, structs, enums, baseContracts, isInterface }
 *   FunctionInfo: { name, contract, visibility, stateMutability, modifiers,
 *                   parameters, returnParameters, locals, body, node }
 */
function buildContext(ast, source) {
  const contracts = new Map()

  visit(ast, {
    ContractDefinition(node) {
      const info = {
        name: node.name,
        node,
        kind: node.kind, // 'contract' | 'interface' | 'library' | 'abstract'
        isInterface: node.kind === 'interface',
        stateVars: new Map(),
        functions: [],
        events: new Map(),
        errors: new Map(),
        modifiers: new Map(),
        structs: new Map(),
        enums: new Map(),
        baseContracts: (node.baseContracts || []).map(b => b.baseName?.namePath).filter(Boolean),
      }

      for (const sub of (node.subNodes || [])) {
        if (sub.type === 'StateVariableDeclaration') {
          for (const v of (sub.variables || [])) {
            if (!v?.name) continue
            info.stateVars.set(v.name, {
              name: v.name,
              typeName: v.typeName,
              visibility: v.visibility,
              isDeclaredConst: v.isDeclaredConst,
              isImmutable: v.isImmutable,
              node: v,
            })
          }
        } else if (sub.type === 'FunctionDefinition') {
          info.functions.push(buildFunctionInfo(sub, info))
        } else if (sub.type === 'EventDefinition') {
          info.events.set(sub.name, sub)
        } else if (sub.type === 'CustomErrorDefinition') {
          info.errors.set(sub.name, sub)
        } else if (sub.type === 'ModifierDefinition') {
          info.modifiers.set(sub.name, sub)
        } else if (sub.type === 'StructDefinition') {
          info.structs.set(sub.name, sub)
        } else if (sub.type === 'EnumDefinition') {
          info.enums.set(sub.name, sub)
        }
      }

      contracts.set(node.name, info)
    },
  })

  return { ast, source, contracts }
}

function buildFunctionInfo(node, contract) {
  const parameters = (node.parameters || []).map(p => ({ name: p.name, typeName: p.typeName, node: p }))
  const returnParameters = (node.returnParameters || []).map(p => ({ name: p.name, typeName: p.typeName, node: p }))
  const locals = new Set()
  for (const p of parameters) if (p.name) locals.add(p.name)
  for (const r of returnParameters) if (r.name) locals.add(r.name)
  if (node.body) {
    visit(node.body, {
      VariableDeclarationStatement(n) {
        for (const v of (n.variables || [])) { if (v?.name) locals.add(v.name) }
      },
      VariableDeclaration(v) {
        if (v?.name) locals.add(v.name)
      },
    })
  }
  return {
    name: node.name, // null for constructor/fallback/receive
    contract,
    visibility: node.visibility,
    stateMutability: node.stateMutability,
    isConstructor: node.isConstructor,
    isReceiveEther: node.isReceiveEther,
    isFallback: node.isFallback,
    modifiers: (node.modifiers || []).map(m => m.name).filter(Boolean),
    parameters,
    returnParameters,
    locals,
    body: node.body,
    node,
  }
}

// ─── Shared AST helpers ─────────────────────────────────────

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='])

// Built-in methods on value types / arrays / bytes / strings
const NON_EXTERNAL_METHODS = new Set(['push', 'pop', 'length', 'concat'])

// Built-in top-level identifiers that aren't user variables
const BUILTIN_NAMESPACES = new Set(['this', 'super', 'msg', 'block', 'tx', 'abi', 'type', 'address', 'super'])

// Walk an LHS/subject expression down to its base identifier.
// E.g. balances[msg.sender].x → "balances".
function baseIdentifierName(target) {
  let base = target
  while (base) {
    if (base.type === 'Identifier') return base.name
    if (base.type === 'IndexAccess') { base = base.base; continue }
    if (base.type === 'MemberAccess') { base = base.expression; continue }
    return null
  }
  return null
}

// Unwrap NameValueExpression: solc parser wraps .call{value: x}() like this.
function unwrapCallExpr(expr) {
  if (expr?.type === 'NameValueExpression') return expr.expression
  return expr
}

function isAssignmentStmt(stmt) {
  if (stmt?.type !== 'ExpressionStatement') return false
  const e = stmt.expression
  if (!e) return false
  if (e.type === 'BinaryOperation' && ASSIGN_OPS.has(e.operator)) return true
  if (e.type === 'UnaryOperation' && (e.operator === '++' || e.operator === '--')) return true
  return false
}

function assignmentTarget(stmt) {
  const e = stmt?.expression
  if (!e) return null
  if (e.type === 'BinaryOperation' && ASSIGN_OPS.has(e.operator)) return e.left
  if (e.type === 'UnaryOperation') return e.subExpression
  return null
}

// Identify a member chain, e.g. msg.sender → ["msg","sender"], block.timestamp
function memberChain(node) {
  const parts = []
  let n = node
  while (n) {
    if (n.type === 'MemberAccess') { parts.unshift(n.memberName); n = n.expression; continue }
    if (n.type === 'Identifier') { parts.unshift(n.name); return parts }
    return null
  }
  return null
}

// Classify a function call on an expression.
//   { kind: 'low-level', method: 'call'|'delegatecall'|'staticcall'|'transfer'|'send', baseExpr }
//   { kind: 'external', memberName, baseName }   — contract.method() where base is a contract-typed var
//   { kind: 'array-builtin', method: 'push'|'pop', baseName }
//   { kind: 'internal' }                          — this.f(), f()
//   { kind: 'other' }
function classifyCall(node, contract) {
  let expr = unwrapCallExpr(node.expression)
  if (!expr) return { kind: 'other' }

  const method = expr.memberName
  if (method === 'call' || method === 'delegatecall' || method === 'staticcall' ||
      method === 'transfer' || method === 'send') {
    return { kind: 'low-level', method, baseExpr: expr.expression }
  }
  if (expr.type === 'MemberAccess') {
    const base = expr.expression
    // array.push(), array.pop()
    if (NON_EXTERNAL_METHODS.has(method)) {
      const bn = baseIdentifierName(base)
      return { kind: 'array-builtin', method, baseName: bn }
    }
    if (base?.type === 'Identifier') {
      const name = base.name
      if (BUILTIN_NAMESPACES.has(name)) return { kind: 'other' }
      if (name === 'this') return { kind: 'internal' }
      return { kind: 'external', memberName: method, baseName: name }
    }
  }
  if (expr.type === 'Identifier') return { kind: 'internal' }
  return { kind: 'other' }
}

// Check whether a function body (or any node) contains a state write,
// where "state" = any variable not in the `locals` set.
function containsStateWrite(node, locals) {
  let found = false
  try {
    visit(node, {
      ExpressionStatement(n) {
        if (found) return
        if (!isAssignmentStmt(n)) return
        const target = assignmentTarget(n)
        const name = baseIdentifierName(target)
        if (name && !(locals && locals.has(name))) found = true
      },
    })
  } catch {}
  return found
}

// Check whether a function body contains an external call.
function containsExternalCall(node, contract) {
  let found = false
  try {
    visit(node, {
      FunctionCall(n) {
        if (found) return
        const c = classifyCall(n, contract)
        if (c.kind === 'low-level' || c.kind === 'external') found = true
      },
    })
  } catch {}
  return found
}

// Walk all statements in a function body linearly (top-level only).
function topLevelStatements(fn) {
  return fn.body?.statements || []
}

// A function is treated as having access control if msg.sender is referenced
// ANYWHERE in its body OUTSIDE of emit statements. This covers:
//   - require(msg.sender == owner)                 [explicit gate]
//   - balances[msg.sender] -= amount               [self-action on mapping]
//   - msg.sender.call{value: x}("")                [self-action on caller]
//   - _checkOwner() / _checkRole() (we also match these by name)
// Uses inside EmitStatement arguments don't count — logging msg.sender as
// event data isn't a gate.
function hasMsgSenderAuth(fn) {
  if (!fn.body) return false
  let emitDepth = 0
  let found = false
  try {
    visit(fn.body, {
      EmitStatement: () => { emitDepth++ },
      'EmitStatement:exit': () => { emitDepth-- },
      MemberAccess(node) {
        if (found || emitDepth > 0) return
        if (node.memberName === 'sender' && node.expression?.name === 'msg') found = true
      },
      FunctionCall(node) {
        if (found) return
        const n = node.expression?.name
        if (n === '_checkOwner' || n === '_checkRole') found = true
      },
    })
  } catch {}
  return found
}

// Merge solc compiler warnings into findings using their own sourceLocation.
function mergeSolcWarnings(warnings, findings, source) {
  for (const w of warnings) {
    const line = solcLine(w, source) || 0
    findings.push({
      severity: w.severity === 'error' ? CRITICAL : INFO,
      line,
      title: w.errorCode ? `solc warning (${w.errorCode})` : 'solc warning',
      message: (w.message || w.formattedMessage || '').trim(),
    })
  }
}

function solcLine(w) {
  // solc returns sourceLocation.start (byte offset) — we only have it as a number.
  // Caller can pre-resolve if they want accurate line; otherwise fall back to 0.
  return w.line || 0
}

// ─── Detectors ──────────────────────────────────────────────

function detectFloatingPragma(ctx, findings) {
  visit(ctx.ast, {
    PragmaDirective(node) {
      if (node.value && node.value.includes('^')) {
        findings.push({
          severity: MEDIUM,
          line: node.loc?.start?.line || 0,
          title: 'Floating pragma',
          message: `Lock the compiler version (e.g., "pragma solidity 0.8.20;") instead of using "^". Floating pragmas risk compiling with an untested compiler version.`
        })
      }
    }
  })
}

function detectTxOrigin(ctx, findings) {
  visit(ctx.ast, {
    MemberAccess(node) {
      if (node.memberName === 'origin' && node.expression?.name === 'tx') {
        findings.push({
          severity: CRITICAL,
          line: node.loc?.start?.line || 0,
          title: 'tx.origin used for authorization',
          message: `tx.origin can be spoofed by a malicious contract calling your contract. Use msg.sender for authentication instead.`
        })
      }
    }
  })
}

function detectSelfdestruct(ctx, findings) {
  visit(ctx.ast, {
    FunctionCall(node) {
      const name = node.expression?.name
      if (name !== 'selfdestruct' && name !== 'suicide') return
      // If target is a function parameter, elevate the message.
      const fn = findEnclosingFunction(ctx, node)
      const targetExpr = node.arguments?.[0]
      const baseName = baseIdentifierName(unwrapPayableCast(targetExpr))
      const isTainted = fn && baseName && fn.parameters.some(p => p.name === baseName)
      findings.push({
        severity: CRITICAL,
        line: node.loc?.start?.line || 0,
        title: isTainted ? 'selfdestruct with user-controlled target' : 'selfdestruct present',
        message: isTainted
          ? `selfdestruct's recipient is a function parameter. An attacker calling this function can drain the contract's ETH to any address they choose.`
          : `selfdestruct destroys the contract and sends all ETH to the target. Ensure it has strict access control. Note: selfdestruct is deprecated in newer EVM versions.`,
      })
    }
  })
}

// Unwrap payable(x) / address(x) casts to see the underlying identifier.
function unwrapPayableCast(expr) {
  if (!expr) return expr
  if (expr.type === 'FunctionCall') {
    const t = expr.expression
    if (t?.type === 'Identifier' && (t.name === 'payable' || t.name === 'address')) {
      return unwrapPayableCast(expr.arguments?.[0])
    }
    if (t?.type === 'ElementaryTypeName' && (t.name === 'address')) {
      return unwrapPayableCast(expr.arguments?.[0])
    }
  }
  return expr
}

function detectReentrancy(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body?.statements) continue

      // Skip if a known reentrancy guard is present
      const hasGuard = fn.modifiers.some(m =>
        m === 'nonReentrant' || m === 'noReentrant' || m === 'lock' || m === 'mutex'
      )
      if (hasGuard) continue

      let foundCall = false
      let callLine = 0
      for (const stmt of topLevelStatements(fn)) {
        if (containsExternalCall(stmt, contract)) {
          foundCall = true
          callLine = stmt.loc?.start?.line || 0
        }
        if (foundCall && containsStateWrite(stmt, fn.locals)) {
          findings.push({
            severity: CRITICAL,
            line: callLine,
            title: 'Potential reentrancy',
            message: `State variable is modified after an external call in "${fn.name || 'unnamed'}()". Follow the Checks-Effects-Interactions pattern: update state BEFORE making external calls. Consider adding a reentrancy guard.`
          })
          break
        }
      }
    }
  }
}

function detectUncheckedCall(ctx, findings) {
  // A .call()/.delegatecall()/.staticcall() whose returned (bool success, ...)
  // is not captured by an assignment, or whose single bool result is thrown away.
  visit(ctx.ast, {
    FunctionCall(node) {
      const expr = unwrapCallExpr(node.expression)
      const m = expr?.memberName
      if (m !== 'call' && m !== 'delegatecall' && m !== 'staticcall') return

      // If parent is a VariableDeclarationStatement ((bool ok, ) = x.call(...)) → captured.
      // If parent is a BinaryOperation with '=' where RHS is this call → captured.
      // If parent is a FunctionCall for `require(ok, ...)` → captured via variable.
      // We detect "uncaptured" by checking if this FunctionCall is the top expression
      // of an ExpressionStatement (i.e. discarded).
      const parent = nodeParent(ctx, node)
      if (parent?.type === 'ExpressionStatement') {
        findings.push({
          severity: CRITICAL,
          line: node.loc?.start?.line || 0,
          title: 'Unchecked call return value',
          message: `The return value of .${m}() is not checked. Always check the bool return: (bool success, ) = addr.${m}{...}(...); require(success);`
        })
      }
    }
  })

  // Unsafe delegatecall to a user-controlled target
  visit(ctx.ast, {
    FunctionCall(node) {
      const expr = unwrapCallExpr(node.expression)
      if (expr?.memberName !== 'delegatecall') return
      const target = expr.expression
      if (!target) return
      // Flag if target is a function parameter (taint)
      const fn = findEnclosingFunction(ctx, node)
      if (!fn) return
      const baseName = baseIdentifierName(target)
      const isParam = fn.parameters.some(p => p.name === baseName)
      if (isParam) {
        findings.push({
          severity: CRITICAL,
          line: node.loc?.start?.line || 0,
          title: 'Unsafe delegatecall',
          message: `delegatecall to a user-controlled address can allow an attacker to execute arbitrary code in your contract's context.`
        })
      }
    }
  })
}

function detectMissingAccessControl(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    if (contract.isInterface || contract.kind === 'library') continue
    for (const fn of contract.functions) {
      if (!fn.name) continue // constructor/fallback/receive
      if (fn.visibility !== 'public' && fn.visibility !== 'external') continue
      if (fn.stateMutability === 'view' || fn.stateMutability === 'pure') continue
      if (!fn.body?.statements?.length) continue

      // Modifier-based auth detection — generous but targeted names
      const hasAuthModifier = fn.modifiers.some(m => {
        const s = m.toLowerCase()
        return s.includes('only') || s.includes('auth') || s.includes('role') ||
               s.includes('admin') || s.includes('owner') || s.includes('guard') ||
               s.includes('restricted') || s.includes('nonreentrant')
      })
      if (hasAuthModifier) continue

      // Body-level auth check (require(msg.sender == X), etc.)
      if (hasMsgSenderAuth(fn)) continue

      findings.push({
        severity: HIGH,
        line: fn.node.loc?.start?.line || 0,
        title: 'Missing access control',
        message: `"${fn.name}()" is ${fn.visibility} and modifies state but has no access control modifier. Anyone can call this function. Add onlyOwner, onlyRole, or similar if this is intentional, ignore this warning.`
      })
    }
  }
}

function detectUnboundedLoop(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      visit(fn.body, {
        ForStatement(node) {
          const cond = node.conditionExpression
          if (cond?.type !== 'BinaryOperation') return
          const right = cond.right
          if (right?.type !== 'MemberAccess' || right.memberName !== 'length') return

          // Determine whether the array is storage-backed (state var) or
          // caller-controlled (calldata/memory param). Calldata is bounded
          // per-tx so it's a much lower-risk warning.
          const baseName = baseIdentifierName(right.expression)
          const isState = baseName && contract.stateVars.has(baseName)
          const isLocal = baseName && fn.locals.has(baseName)
          // Calldata/memory array params fall into locals, and are lower risk.
          if (!isState && isLocal) return

          findings.push({
            severity: HIGH,
            line: node.loc?.start?.line || 0,
            title: 'Potentially unbounded loop',
            message: `Loop iterates over an array length that may grow without bound. An attacker could add entries until the function exceeds the block gas limit (DoS). Consider pagination or a maximum iteration count.`
          })
        }
      })
    }
  }
}

function detectEthInLoop(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      // Track loop nesting as we visit
      let depth = 0
      visit(fn.body, {
        ForStatement: () => { depth++ },
        'ForStatement:exit': () => { depth-- },
        WhileStatement: () => { depth++ },
        'WhileStatement:exit': () => { depth-- },
        DoWhileStatement: () => { depth++ },
        'DoWhileStatement:exit': () => { depth-- },
        FunctionCall(node) {
          if (depth === 0) return
          const c = classifyCall(node, contract)
          if (c.kind !== 'low-level') return
          const m = c.method
          if (m === 'transfer' || m === 'send') {
            findings.push({
              severity: MEDIUM,
              line: node.loc?.start?.line || 0,
              title: 'ETH transfer in loop',
              message: `Sending ETH inside a loop is risky. If one transfer fails (e.g., to a contract that reverts), the entire transaction fails. Use the pull-over-push pattern: let recipients withdraw their funds.`
            })
          } else if (m === 'call') {
            // Flag only if this is a value-bearing call (.call{value: x}())
            const outer = node.expression // may be NameValueExpression
            if (outer?.type === 'NameValueExpression') {
              const names = outer.arguments?.names || []
              if (names.includes('value')) {
                findings.push({
                  severity: MEDIUM,
                  line: node.loc?.start?.line || 0,
                  title: 'ETH transfer in loop',
                  message: `Sending ETH inside a loop is risky. If one transfer fails (e.g., to a contract that reverts), the entire transaction fails. Use the pull-over-push pattern: let recipients withdraw their funds.`
                })
              }
            }
          }
        }
      })
    }
  }
}

function detectMissingZeroCheck(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    if (contract.isInterface) continue
    for (const fn of contract.functions) {
      if (!fn.body) continue
      // view/pure functions don't write state, so passing address(0) can't
      // lock funds. Skip them to avoid noise on getters.
      if (fn.stateMutability === 'view' || fn.stateMutability === 'pure') continue
      const addrParams = fn.parameters.filter(p => isAddressType(p.typeName))
      if (addrParams.length === 0) continue

      for (const p of addrParams) {
        if (!p.name) continue
        if (paramHasZeroCheck(fn.body, p.name)) continue
        findings.push({
          severity: MEDIUM,
          line: fn.node.loc?.start?.line || 0,
          title: 'Missing zero-address check',
          message: `Parameter "${p.name}" in "${fn.name || 'unnamed'}()" is not validated against address(0). Accidentally passing the zero address could lock funds permanently.`
        })
      }
    }
  }
}

function isAddressType(typeName) {
  if (!typeName) return false
  if (typeName.type === 'ElementaryTypeName') return typeName.name === 'address'
  if (typeName.type === 'UserDefinedTypeName') return false
  return false
}

// AST-based check: `require(param != address(0))`, `if (param == address(0)) revert`,
// or any BinaryOperation comparing param identifier to address(0).
function paramHasZeroCheck(body, paramName) {
  let found = false
  try {
    visit(body, {
      BinaryOperation(n) {
        if (found) return
        if (n.operator !== '==' && n.operator !== '!=') return
        if (refersToZero(n.left) && refersToIdentifier(n.right, paramName)) found = true
        if (refersToZero(n.right) && refersToIdentifier(n.left, paramName)) found = true
      },
    })
  } catch {}
  return found
}

function refersToZero(expr) {
  if (!expr) return false
  // address(0) — parsed as FunctionCall where expression is Identifier "address"
  // (or ElementaryTypeName "address" on some parser versions).
  if (expr.type === 'FunctionCall') {
    const target = expr.expression
    const isAddrCast =
      (target?.type === 'Identifier' && target.name === 'address') ||
      (target?.type === 'ElementaryTypeName' && target.name === 'address')
    if (isAddrCast) {
      const arg = expr.arguments?.[0]
      if (arg?.type === 'NumberLiteral' && (arg.number === '0' || arg.number === '0x0')) return true
    }
  }
  return false
}

function refersToIdentifier(expr, name) {
  if (!expr) return false
  if (expr.type === 'Identifier' && expr.name === name) return true
  return false
}

function detectMissingEvents(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    if (contract.isInterface || contract.kind === 'library') continue
    for (const fn of contract.functions) {
      if (!fn.name) continue
      if (fn.visibility !== 'public' && fn.visibility !== 'external') continue
      if (fn.stateMutability === 'view' || fn.stateMutability === 'pure') continue
      if (!fn.body) continue

      // Does this function write state?
      if (!containsStateWrite(fn.body, fn.locals)) continue

      // Does it emit at least one event?
      if (bodyContainsEmit(fn.body)) continue

      findings.push({
        severity: MEDIUM,
        line: fn.node.loc?.start?.line || 0,
        title: 'State change without event',
        message: `"${fn.name}()" modifies state but doesn't emit an event. Events are important for off-chain monitoring, indexing, and debugging.`
      })
    }
  }
}

function bodyContainsEmit(body) {
  let found = false
  try {
    visit(body, {
      EmitStatement() { found = true },
    })
  } catch {}
  return found
}

function detectBlockTimestamp(ctx, findings) {
  const nodes = []
  visit(ctx.ast, {
    MemberAccess(node) {
      if (node.memberName === 'timestamp' && node.expression?.name === 'block') nodes.push(node)
    }
  })
  for (const node of nodes) {
    const ctxInfo = classifyTimestampContext(ctx, node)
    if (ctxInfo.severity === null) continue // pure read, we skip (nothing to say)
    findings.push({
      severity: ctxInfo.severity,
      line: node.loc?.start?.line || 0,
      title: ctxInfo.title,
      message: ctxInfo.message,
    })
  }
}

// Walk up from block.timestamp until we hit a classifying expression.
// Returns { severity, title, message }.
function classifyTimestampContext(ctx, node) {
  let cur = nodeParent(ctx, node)
  while (cur) {
    if (cur.type === 'FunctionDefinition' || cur.type === 'ContractDefinition') break
    if (cur.type === 'FunctionCall') {
      const n = cur.expression?.name
      if (n === 'keccak256' || n === 'sha256' || n === 'ripemd160' || n === 'sha3') {
        return {
          severity: CRITICAL,
          title: 'block.timestamp used for randomness',
          message: `block.timestamp is manipulable by validators within a ~12s window. Feeding it into keccak256/sha256 does NOT produce secure randomness. Use a commit-reveal scheme, Chainlink VRF, or on-chain randomness primitive.`,
        }
      }
    }
    if (cur.type === 'BinaryOperation') {
      if (cur.operator === '%' || cur.operator === '^') {
        return {
          severity: CRITICAL,
          title: 'block.timestamp used for randomness',
          message: `block.timestamp is used in a modulo/xor expression. Validators can grind the timestamp to bias the outcome. Use a dedicated randomness source.`,
        }
      }
      if (cur.operator === '>' || cur.operator === '<' || cur.operator === '>=' || cur.operator === '<=') {
        return {
          severity: MEDIUM,
          title: 'block.timestamp dependency',
          message: `block.timestamp used as a deadline. Validators can shift it by ~12 seconds; ensure your logic tolerates this drift.`,
        }
      }
      if (cur.operator === '+' || cur.operator === '-') {
        return {
          severity: INFO,
          title: 'block.timestamp dependency',
          message: `block.timestamp used to compute a future time point. This is the standard pattern for deadlines/expiry — just be aware of the ~12s manipulation window.`,
        }
      }
    }
    cur = nodeParent(ctx, cur)
  }
  return {
    severity: MEDIUM,
    title: 'block.timestamp dependency',
    message: `block.timestamp can be slightly manipulated by validators (~12s range). Don't use it for critical time-sensitive logic like randomness. For deadlines and expiry, it's generally acceptable.`,
  }
}

function detectUnsafeERC20(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      visit(fn.body, {
        FunctionCall(node) {
          const expr = unwrapCallExpr(node.expression)
          if (expr?.type !== 'MemberAccess') return
          const m = expr.memberName
          if (m !== 'transfer' && m !== 'transferFrom') return
          const base = expr.expression
          if (base?.type !== 'Identifier') return
          // Only flag if base is a state variable (likely a token instance).
          // Ignore `payable(x).transfer(...)` (ETH transfer) and local variables.
          if (!contract.stateVars.has(base.name)) return
          findings.push({
            severity: INFO,
            line: node.loc?.start?.line || 0,
            title: 'Potentially unsafe ERC20 transfer',
            message: `Some ERC20 tokens (like USDT) don't return a bool from transfer/transferFrom. Use OpenZeppelin's SafeERC20 library to handle these safely.`
          })
        }
      })
    }
  }
}

function detectUncheckedMath(ctx, findings) {
  visit(ctx.ast, {
    UncheckedStatement(node) {
      findings.push({
        severity: INFO,
        line: node.loc?.start?.line || 0,
        title: 'Unchecked arithmetic block',
        message: `Unchecked block disables overflow/underflow protection. Make sure this is intentional and inputs are validated beforehand.`
      })
    }
  })
}

// ═══ Tier 1 detectors ═══════════════════════════════════════

// Arbitrary `from` passed to transferFrom without `require(from == msg.sender)`
// or an explicit allowance check. Handles both direct calls and encoded
// abi.encodeWithSignature("transferFrom(...)") patterns.
function detectArbitraryFrom(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      const paramNames = new Set(fn.parameters.map(p => p.name).filter(Boolean))
      if (paramNames.size === 0) continue

      visit(fn.body, {
        FunctionCall(node) {
          const transferFromArgs = extractTransferFromArgs(node)
          if (!transferFromArgs) return
          const fromArg = transferFromArgs.from
          if (fromArg?.type !== 'Identifier') return
          if (!paramNames.has(fromArg.name)) return
          // Has this function validated the `from` param is msg.sender?
          if (paramComparedToMsgSender(fn.body, fromArg.name)) return
          findings.push({
            severity: CRITICAL,
            line: node.loc?.start?.line || 0,
            title: 'Arbitrary transferFrom source',
            message: `"${fn.name || 'unnamed'}()" calls transferFrom with a user-supplied "from" address and does not require from == msg.sender. Anyone who has tokens approved to this contract can be drained. Add require(from == msg.sender) or use msg.sender directly.`,
          })
        },
      })
    }
  }
}

// Returns { from, to, amount } if `node` is a transferFrom call (direct or encoded), else null.
function extractTransferFromArgs(node) {
  // Direct: x.transferFrom(from, to, amount)
  const expr = unwrapCallExpr(node.expression)
  if (expr?.type === 'MemberAccess' && expr.memberName === 'transferFrom') {
    const args = node.arguments || []
    if (args.length >= 3) return { from: args[0], to: args[1], amount: args[2] }
  }
  // Encoded: x.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount))
  if (expr?.memberName === 'call' || expr?.memberName === 'delegatecall' || expr?.memberName === 'staticcall') {
    const arg0 = node.arguments?.[0]
    const encoded = extractEncodedCall(arg0)
    if (encoded && /^transferFrom\b/.test(encoded.signature)) {
      return { from: encoded.args?.[0], to: encoded.args?.[1], amount: encoded.args?.[2] }
    }
  }
  return null
}

// Returns { signature, args } from an abi.encodeWithSignature("sig(...)", a, b, c) call, or null.
function extractEncodedCall(node) {
  if (!node || node.type !== 'FunctionCall') return null
  const e = node.expression
  if (e?.type !== 'MemberAccess' || e.expression?.name !== 'abi') return null
  const m = e.memberName
  if (m !== 'encodeWithSignature' && m !== 'encodeCall' && m !== 'encodeWithSelector') return null
  const args = node.arguments || []
  const sig = args[0]
  if (!sig || sig.type !== 'StringLiteral') return null
  return { signature: sig.value || '', args: args.slice(1) }
}

function paramComparedToMsgSender(body, paramName) {
  let found = false
  try {
    visit(body, {
      BinaryOperation(n) {
        if (found) return
        if (n.operator !== '==' && n.operator !== '!=') return
        const isParam = x => x?.type === 'Identifier' && x.name === paramName
        const isMs = x => x?.type === 'MemberAccess' && x.memberName === 'sender' && x.expression?.name === 'msg'
        if ((isParam(n.left) && isMs(n.right)) || (isParam(n.right) && isMs(n.left))) found = true
      },
    })
  } catch {}
  return found
}

// ecrecover() result not checked against address(0).
function detectEcrecoverNoZero(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      let ecrecoverCall = null
      visit(fn.body, {
        FunctionCall(n) {
          if (ecrecoverCall) return
          if (n.expression?.name === 'ecrecover') ecrecoverCall = n
        },
      })
      if (!ecrecoverCall) continue
      // Is there any !=/== address(0) comparison in the body?
      if (bodyHasAddressZeroCheck(fn.body)) continue
      findings.push({
        severity: CRITICAL,
        line: ecrecoverCall.loc?.start?.line || 0,
        title: 'ecrecover return not checked for zero',
        message: `ecrecover returns address(0) for malformed signatures. Without a zero-address check, a malformed signature can be accepted as a valid signature from address(0). Always check the recovered address is non-zero.`,
      })
    }
  }
}

function bodyHasAddressZeroCheck(body) {
  let found = false
  try {
    visit(body, {
      BinaryOperation(n) {
        if (found) return
        if (n.operator !== '==' && n.operator !== '!=') return
        if (refersToZero(n.left) || refersToZero(n.right)) found = true
      },
    })
  } catch {}
  return found
}

// Predictable-randomness sources: block.timestamp, block.prevrandao,
// block.difficulty, blockhash(). Flag CRITICAL in randomness contexts.
function detectPredictableRandomness(ctx, findings) {
  const sources = []
  visit(ctx.ast, {
    MemberAccess(node) {
      if (node.expression?.name !== 'block') return
      const m = node.memberName
      if (m === 'prevrandao' || m === 'difficulty') sources.push({ node, name: 'block.' + m })
    },
    FunctionCall(node) {
      if (node.expression?.name === 'blockhash') sources.push({ node, name: 'blockhash()' })
    },
  })
  for (const { node, name } of sources) {
    const inRand = isInRandomnessContext(ctx, node)
    if (inRand) {
      findings.push({
        severity: CRITICAL,
        line: node.loc?.start?.line || 0,
        title: 'Predictable randomness source',
        message: `${name} is used in a randomness-derivation context (hash/modulo). Validators can influence these values — the resulting "randomness" is game-able. Use Chainlink VRF or a commit-reveal scheme.`,
      })
    } else {
      findings.push({
        severity: HIGH,
        line: node.loc?.start?.line || 0,
        title: 'Predictable randomness source',
        message: `${name} does not provide secure randomness. Validators can influence or know it. If you're building an RNG, use Chainlink VRF or commit-reveal.`,
      })
    }
  }
}

function isInRandomnessContext(ctx, node) {
  let cur = nodeParent(ctx, node)
  while (cur) {
    if (cur.type === 'FunctionDefinition' || cur.type === 'ContractDefinition') break
    if (cur.type === 'FunctionCall') {
      const n = cur.expression?.name
      if (n === 'keccak256' || n === 'sha256' || n === 'ripemd160' || n === 'sha3') return true
    }
    if (cur.type === 'BinaryOperation' && (cur.operator === '%' || cur.operator === '^')) return true
    cur = nodeParent(ctx, cur)
  }
  return false
}

// abi.encodePacked(a, b, ...) with 2+ dynamic-typed arguments can produce hash collisions.
function detectEncodePackedCollision(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      // Build a local type lookup: param name → typeName
      const paramTypes = new Map()
      for (const p of fn.parameters) { if (p.name) paramTypes.set(p.name, p.typeName) }
      for (const sv of contract.stateVars.values()) paramTypes.set(sv.name, sv.typeName)

      visit(fn.body, {
        FunctionCall(node) {
          const e = node.expression
          if (e?.type !== 'MemberAccess') return
          if (e.memberName !== 'encodePacked' || e.expression?.name !== 'abi') return
          const args = node.arguments || []
          if (args.length < 2) return

          let dynamicCount = 0
          for (const a of args) {
            if (isDynamicArg(a, paramTypes)) dynamicCount++
            if (dynamicCount >= 2) break
          }
          if (dynamicCount >= 2) {
            findings.push({
              severity: HIGH,
              line: node.loc?.start?.line || 0,
              title: 'abi.encodePacked hash collision risk',
              message: `abi.encodePacked with two or more dynamic-typed arguments (string/bytes/array) can produce the same output for different inputs (e.g. ["a","bc"] and ["ab","c"]). Use abi.encode(...) instead when hashing.`,
            })
          }
        },
      })
    }
  }
}

function isDynamicArg(arg, typeMap) {
  if (!arg) return false
  if (arg.type === 'StringLiteral') return true // string is dynamic
  if (arg.type === 'HexLiteral') return false
  if (arg.type === 'NumberLiteral' || arg.type === 'BooleanLiteral') return false
  if (arg.type === 'Identifier') {
    const t = typeMap.get(arg.name)
    return isDynamicType(t)
  }
  return false
}

function isDynamicType(typeName) {
  if (!typeName) return false
  if (typeName.type === 'ArrayTypeName') return true
  if (typeName.type === 'ElementaryTypeName') {
    const n = typeName.name
    return n === 'string' || n === 'bytes'
  }
  return false
}

// Division before multiplication: (a / b) * c loses precision.
function detectDivBeforeMul(ctx, findings) {
  visit(ctx.ast, {
    BinaryOperation(node) {
      if (node.operator !== '*') return
      const left = unwrapTuple(node.left)
      if (left?.type === 'BinaryOperation' && left.operator === '/') {
        findings.push({
          severity: MEDIUM,
          line: node.loc?.start?.line || 0,
          title: 'Division before multiplication',
          message: `Performing division before multiplication loses precision in integer arithmetic. Reorder to (a * c) / b where possible.`,
        })
      }
    },
  })
}

// Parentheses produce single-element TupleExpressions — unwrap them.
function unwrapTuple(node) {
  while (node?.type === 'TupleExpression' && node.components?.length === 1) {
    node = node.components[0]
  }
  return node
}

// ERC20 approve race: approve(spender, X) with X != 0 without first reset to 0.
// Flag any approve(...) with non-literal-0 amount. Noisy but cheap.
function detectApproveRace(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      visit(fn.body, {
        FunctionCall(node) {
          const approveArgs = extractApproveArgs(node)
          if (!approveArgs) return
          const amount = approveArgs.amount
          if (amount?.type === 'NumberLiteral' && amount.number === '0') return
          findings.push({
            severity: INFO,
            line: node.loc?.start?.line || 0,
            title: 'ERC20 approve race',
            message: `Setting a non-zero allowance over an existing non-zero allowance creates a race (attacker spends old allowance, then new). Prefer increaseAllowance/decreaseAllowance, or reset to 0 first.`,
          })
        },
      })
    }
  }
}

function extractApproveArgs(node) {
  const expr = unwrapCallExpr(node.expression)
  if (expr?.type === 'MemberAccess' && expr.memberName === 'approve') {
    const args = node.arguments || []
    if (args.length >= 2) return { spender: args[0], amount: args[1] }
  }
  if (expr?.memberName === 'call' || expr?.memberName === 'delegatecall') {
    const enc = extractEncodedCall(node.arguments?.[0])
    if (enc && /^approve\b/.test(enc.signature)) {
      return { spender: enc.args?.[0], amount: enc.args?.[1] }
    }
  }
  return null
}

// Hardcoded gas in .call{gas: N}(...) — post-Istanbul gas assumptions can break.
function detectHardcodedGas(ctx, findings) {
  visit(ctx.ast, {
    FunctionCall(node) {
      const outer = node.expression
      if (outer?.type !== 'NameValueExpression') return
      const inner = outer.expression
      if (inner?.memberName !== 'call' && inner?.memberName !== 'delegatecall' && inner?.memberName !== 'staticcall') return
      const names = outer.arguments?.names || []
      const vals = outer.arguments?.arguments || []
      const idx = names.indexOf('gas')
      if (idx < 0) return
      const g = vals[idx]
      if (g?.type === 'NumberLiteral') {
        findings.push({
          severity: MEDIUM,
          line: node.loc?.start?.line || 0,
          title: 'Hardcoded gas in .call',
          message: `Hardcoding a gas value in .call() is brittle. Gas costs for opcodes change between hard forks (the 2300 stipend assumption broke post-Istanbul). Forward msg.gasleft() or let the default apply.`,
        })
      }
    },
  })
}

// Function parameter or local that shadows a state variable.
function detectShadowedState(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    const stateNames = new Set(contract.stateVars.keys())
    if (stateNames.size === 0) continue
    for (const fn of contract.functions) {
      for (const p of fn.parameters) {
        if (p.name && stateNames.has(p.name)) {
          findings.push({
            severity: HIGH,
            line: p.node?.loc?.start?.line || fn.node.loc?.start?.line || 0,
            title: 'Shadowed state variable',
            message: `Parameter "${p.name}" in "${fn.name || 'unnamed'}()" has the same name as a state variable. Reads/writes inside the function refer to the parameter, not the state variable — a common source of silent bugs.`,
          })
        }
      }
      // Local declarations
      if (fn.body) {
        visit(fn.body, {
          VariableDeclarationStatement(n) {
            for (const v of (n.variables || [])) {
              if (!v?.name) continue
              if (fn.parameters.some(p => p.name === v.name)) continue // already counted as param
              if (stateNames.has(v.name)) {
                findings.push({
                  severity: HIGH,
                  line: v.loc?.start?.line || 0,
                  title: 'Shadowed state variable',
                  message: `Local variable "${v.name}" in "${fn.name || 'unnamed'}()" has the same name as a state variable. This is a common source of silent bugs.`,
                })
              }
            }
          },
        })
      }
    }
  }
}

// Return bomb: external call whose bytes returndata is captured and returned unbounded.
function detectReturnBomb(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      visit(fn.body, {
        VariableDeclarationStatement(n) {
          // Pattern: (bool ok, bytes memory ret) = target.call(data);
          const init = n.initialValue
          if (init?.type !== 'FunctionCall') return
          const expr = unwrapCallExpr(init.expression)
          const m = expr?.memberName
          if (m !== 'call' && m !== 'delegatecall' && m !== 'staticcall') return
          // Find a captured bytes variable
          const byteVars = (n.variables || []).filter(v =>
            v?.typeName?.type === 'ElementaryTypeName' && v.typeName.name === 'bytes'
          )
          if (byteVars.length === 0) return
          // Is the bytes variable returned from this function?
          const names = byteVars.map(v => v.name).filter(Boolean)
          if (!names.length) return
          let returned = false
          try {
            visit(fn.body, {
              ReturnStatement(r) {
                if (returned) return
                if (!r.expression) return
                if (r.expression.type === 'Identifier' && names.includes(r.expression.name)) returned = true
                // Also handle tuple returns: return (ok, ret)
                if (r.expression.type === 'TupleExpression') {
                  for (const c of (r.expression.components || [])) {
                    if (c?.type === 'Identifier' && names.includes(c.name)) { returned = true; break }
                  }
                }
              },
            })
          } catch {}
          if (returned) {
            findings.push({
              severity: MEDIUM,
              line: init.loc?.start?.line || 0,
              title: 'Unbounded returndata (return bomb)',
              message: `External call's bytes returndata is returned directly. A malicious callee can return gigabytes of data to exhaust the caller's gas. Use an ExcessivelySafeCall-style bounded copy if the contract is user-facing.`,
            })
          }
        },
      })
    }
  }
}

// ═══ Tier 2 detectors ═══════════════════════════════════════

// Flag subtractions inside `unchecked {}` whose RHS involves a function
// parameter or other user-influenced value — classic underflow risk.
function detectDangerousUnchecked(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      const paramNames = new Set(fn.parameters.map(p => p.name).filter(Boolean))
      visit(fn.body, {
        UncheckedStatement(node) {
          visit(node, {
            BinaryOperation(b) {
              if (b.operator !== '-' && b.operator !== '-=') return
              // RHS is param or depends on param
              if (expressionInvolvesNames(b.right, paramNames)) {
                findings.push({
                  severity: HIGH,
                  line: b.loc?.start?.line || 0,
                  title: 'Unsafe subtraction in unchecked block',
                  message: `Subtraction of a user-influenced value inside unchecked{} can underflow silently. Either validate the subtrahend is <= the minuend before entering unchecked, or remove the unchecked wrapper.`,
                })
              }
            },
          })
        },
      })
    }
  }
}

function expressionInvolvesNames(node, names) {
  if (!node || !names.size) return false
  let found = false
  try {
    visit(node, {
      Identifier(n) {
        if (names.has(n.name)) found = true
      },
    })
  } catch {}
  return found
}

// Upgradeable-contract patterns:
//  (a) Contract inherits Initializable but has a constructor body that modifies state.
//  (b) initialize() function without the `initializer` modifier.
function detectUpgradeablePatterns(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    if (contract.isInterface || contract.kind === 'library') continue

    // Does this contract look upgradeable? Heuristic: inherits anything ending in
    // "Initializable" or "Upgradeable", or defines an initialize() function.
    const baseNames = contract.baseContracts.map(s => s.toLowerCase())
    const looksUpgradeable =
      baseNames.some(b => b.endsWith('initializable') || b.includes('upgradeable')) ||
      contract.functions.some(f => f.name === 'initialize')

    if (!looksUpgradeable) continue

    // (a) Non-empty constructor in upgradeable contract
    const ctor = contract.functions.find(f => f.isConstructor)
    if (ctor && containsStateWrite(ctor.body, ctor.locals)) {
      findings.push({
        severity: HIGH,
        line: ctor.node.loc?.start?.line || 0,
        title: 'Constructor in upgradeable contract',
        message: `Upgradeable contracts shouldn't initialize state in constructors — proxies don't run constructor code on the implementation. Move initialization into an initialize() function guarded by the initializer modifier.`,
      })
    }

    // (b) initialize() without initializer modifier
    for (const fn of contract.functions) {
      if (fn.name !== 'initialize' && fn.name !== '__init') continue
      const hasInit = fn.modifiers.some(m => m === 'initializer' || m === 'reinitializer' || m === 'onlyInitializing')
      if (!hasInit) {
        findings.push({
          severity: CRITICAL,
          line: fn.node.loc?.start?.line || 0,
          title: 'initialize() without initializer modifier',
          message: `"${fn.name}()" looks like an initializer but doesn't have the initializer/reinitializer modifier. Without it, the function can be called repeatedly and/or by any caller — frequent root cause of takeover bugs on upgradeable contracts.`,
        })
      }
    }
  }
}

// Flag .transfer() / .send() on raw addresses outside of loops (ETH-in-loop
// is handled separately). These use a fixed 2300 gas stipend that can break
// after hard forks (already broke post-Istanbul).
function detectTransferDeprecated(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (!fn.body) continue
      let depth = 0
      visit(fn.body, {
        ForStatement: () => { depth++ },
        'ForStatement:exit': () => { depth-- },
        WhileStatement: () => { depth++ },
        'WhileStatement:exit': () => { depth-- },
        DoWhileStatement: () => { depth++ },
        'DoWhileStatement:exit': () => { depth-- },
        FunctionCall(node) {
          if (depth > 0) return
          const expr = unwrapCallExpr(node.expression)
          if (expr?.type !== 'MemberAccess') return
          const m = expr.memberName
          if (m !== 'transfer' && m !== 'send') return
          // ETH transfer has exactly 1 argument (the amount). Token transfers
          // have 2 (to, amount) — those are handled by detectUnsafeERC20.
          if ((node.arguments?.length || 0) !== 1) return
          // Skip if base is a state variable (looks like a token instance).
          const base = baseIdentifierName(expr.expression)
          if (base && contract.stateVars.has(base)) return
          findings.push({
            severity: MEDIUM,
            line: node.loc?.start?.line || 0,
            title: '.transfer() / .send() deprecated gas stipend',
            message: `.${m}() uses a fixed 2300 gas stipend that can break after EVM hard forks (Istanbul already broke it for some patterns). Prefer (bool ok,) = addr.call{value: x}(""); require(ok, "…");`,
          })
        },
      })
    }
  }
}

// ═══ Style / hygiene detectors (Phase 5) ════════════════════

const REENTRANCY_GUARDS = new Set(['nonReentrant', 'noReentrant', 'lock', 'mutex'])

// nonReentrant should be the outermost modifier so the lock is taken before
// any other modifier (including ones that may themselves make external calls).
function detectModifierOrdering(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    for (const fn of contract.functions) {
      if (fn.modifiers.length < 2) continue
      const guardIdx = fn.modifiers.findIndex(m => REENTRANCY_GUARDS.has(m))
      if (guardIdx > 0) {
        findings.push({
          severity: INFO,
          line: fn.node.loc?.start?.line || 0,
          title: 'Reentrancy guard not outermost',
          message: `"${fn.name || 'unnamed'}()" lists ${fn.modifiers[guardIdx]} after other modifiers. Put the reentrancy guard first — the lock should be taken before any other modifier runs (OpenZeppelin convention).`,
        })
      }
    }
  }
}

// Build a set of all Identifier names referenced across a contract's code.
function collectReferencedNames(contract) {
  const used = new Set()
  const add = body => {
    if (!body) return
    visit(body, {
      Identifier(n) { used.add(n.name) },
    })
  }
  for (const fn of contract.functions) add(fn.body)
  for (const mod of contract.modifiers.values()) add(mod.body)
  return used
}

// State variable declared but never referenced in any function/modifier body.
function detectUnusedStateVars(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    if (contract.isInterface || contract.kind === 'library') continue
    const stateVarCount = contract.stateVars.size
    if (stateVarCount === 0) continue
    const used = collectReferencedNames(contract)
    for (const sv of contract.stateVars.values()) {
      if (sv.visibility === 'public' || sv.visibility === 'external') continue
      if (used.has(sv.name)) continue
      findings.push({
        severity: INFO,
        line: sv.node.loc?.start?.line || 0,
        title: 'Unused state variable',
        message: `State variable "${sv.name}" is declared but never referenced. Remove it to reduce deploy cost, or mark public/external if it should be exposed.`,
      })
    }
  }
}

// Internal/private function never called from within the contract.
// (External/public are exposed by the ABI, so we can't know if they're unused.)
function detectUnusedFunctions(ctx, findings) {
  for (const contract of ctx.contracts.values()) {
    if (contract.isInterface || contract.kind === 'library') continue
    const used = collectReferencedNames(contract)
    for (const fn of contract.functions) {
      if (!fn.name) continue // ctor/fallback/receive
      if (fn.visibility !== 'internal' && fn.visibility !== 'private') continue
      // virtual or override functions may be called by child contracts — skip those
      if (fn.node.isVirtual || (fn.node.override && fn.node.override.length > 0)) continue
      if (used.has(fn.name)) continue
      findings.push({
        severity: INFO,
        line: fn.node.loc?.start?.line || 0,
        title: 'Unused internal function',
        message: `"${fn.name}()" is ${fn.visibility} but never called from this contract. Remove it, or mark it virtual if it's meant to be called by child contracts.`,
      })
    }
  }
}

function detectMagicNumbers(ctx, findings) {
  visit(ctx.ast, {
    NumberLiteral(node) {
      const val = node.number
      if (!val) return
      const skip = ['0', '1', '2', '10', '18', '6', '8', '100', '1000', '10000', '256', '32']
      if (skip.includes(val)) return
      if (val.startsWith('0x')) return
      const num = parseInt(val)
      if (num > 1000 && num !== 10000 && num !== 100000) {
        findings.push({
          severity: INFO,
          line: node.loc?.start?.line || 0,
          title: 'Magic number',
          message: `Consider extracting ${val} into a named constant for readability and maintainability.`
        })
      }
    }
  })
}

// ─── Utilities: enclosing-function lookup / parent tracking ─

// Build a parent-map lazily the first time we need it.
function nodeParent(ctx, node) {
  if (!ctx._parentMap) ctx._parentMap = buildParentMap(ctx.ast)
  return ctx._parentMap.get(node) || null
}

function buildParentMap(ast) {
  const map = new Map()
  const walk = (n, parent) => {
    if (!n || typeof n !== 'object') return
    if (n.type) map.set(n, parent)
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'parent') continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach(c => walk(c, n))
      else if (v && typeof v === 'object') walk(v, n)
    }
  }
  walk(ast, null)
  return map
}

function findEnclosingFunction(ctx, node) {
  let cur = nodeParent(ctx, node)
  while (cur) {
    if (cur.type === 'FunctionDefinition') {
      // Match it back to ctx.contracts functions
      for (const c of ctx.contracts.values()) {
        const f = c.functions.find(fn => fn.node === cur)
        if (f) return f
      }
      return null
    }
    cur = nodeParent(ctx, cur)
  }
  return null
}

// ─── Gas Optimization Tips (unchanged) ──────────────────────

export function analyzeGasOptimizations(source) {
  const tips = []
  const lines = source.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    if (line.match(/>\s*0\b/) && !line.includes('int') && !line.includes('//')) {
      tips.push({ line: lineNum, col: line.indexOf('> 0'), message: 'Use "!= 0" instead of "> 0" for unsigned integers — saves ~6 gas per comparison' })
    }
    if (line.match(/for\s*\(/) && line.includes('.length')) {
      tips.push({ line: lineNum, col: line.indexOf('.length'), message: 'Cache array.length before the loop — reading .length from storage every iteration costs extra gas' })
    }
    if (line.match(/for\s*\(.*\bi\+\+/) && !line.includes('unchecked')) {
      tips.push({ line: lineNum, col: line.indexOf('i++'), message: 'Use "++i" instead of "i++" — saves ~5 gas per iteration (no temp copy needed)' })
    }
    const reqMatch = line.match(/require\s*\([^,]+,\s*"([^"]{20,})"/)
    if (reqMatch) {
      tips.push({ line: lineNum, col: line.indexOf(reqMatch[1]), message: `Long error string ("${reqMatch[1].slice(0, 20)}...") — consider a custom error to reduce deployment gas` })
    }
    if (line.match(/function\s+\w+\s*\([^)]*\)\s+(public)/) && !line.includes('override')) {
      const col = line.indexOf('public')
      tips.push({ line: lineNum, col, message: 'Use "external" instead of "public" if the function is not called internally — avoids copying calldata to memory' })
    }
    if (line.match(/^\s+bool\s+(public\s+)?[a-zA-Z]/) && !line.includes('//') && !line.includes('memory') && !line.includes('calldata')) {
      tips.push({ line: lineNum, col: line.indexOf('bool'), message: 'Bool storage variables use a full 256-bit slot — consider packing with adjacent small types or using uint8' })
    }
    if (line.match(/uint\d*\s+\w+\s*=\s*0\s*;/) && !line.includes('//')) {
      tips.push({ line: lineNum, col: line.indexOf('= 0'), message: 'Default initialization to 0 is unnecessary — Solidity defaults uint to 0, saves deployment gas' })
    }
    if (line.match(/function\s+\w+.*\bmemory\b.*\bexternal\b/) || line.match(/function\s+\w+.*\bexternal\b.*\bmemory\b/)) {
      if (line.includes('memory') && (line.includes('string') || line.includes('bytes') || line.includes('[]'))) {
        tips.push({ line: lineNum, col: line.indexOf('memory'), message: 'Use "calldata" instead of "memory" for read-only external function parameters — avoids copying' })
      }
    }
  }
  return tips
}
