import { parse, visit } from '@solidity-parser/parser'

// Severity levels
const CRITICAL = 'critical'
const HIGH = 'high'
const MEDIUM = 'medium'
const INFO = 'info'

export function analyzeSource(source) {
  const findings = []

  // Parse AST
  let ast
  try {
    ast = parse(source, { loc: true, range: true, tolerant: true })
  } catch (e) {
    return [{ severity: INFO, line: 0, title: 'Parse error', message: `Could not parse source for analysis: ${e.message}` }]
  }

  // Run all detectors
  detectFloatingPragma(source, ast, findings)
  detectTxOrigin(source, ast, findings)
  detectSelfdestruct(source, ast, findings)
  detectReentrancy(source, ast, findings)
  detectUncheckedCall(source, ast, findings)
  detectMissingAccessControl(source, ast, findings)
  detectUnboundedLoop(source, ast, findings)
  detectEthInLoop(source, ast, findings)
  detectMissingZeroCheck(source, ast, findings)
  detectMissingEvents(source, ast, findings)
  detectBlockTimestamp(source, ast, findings)
  detectUnsafeERC20(source, ast, findings)
  detectUncheckedMath(source, ast, findings)
  detectMagicNumbers(source, ast, findings)

  // Sort by severity then line
  const order = { critical: 0, high: 1, medium: 2, info: 3 }
  findings.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.line - b.line))

  return findings
}

// ── Detectors ───────────────────────────────────────────────

function detectFloatingPragma(source, ast, findings) {
  visit(ast, {
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

function detectTxOrigin(source, ast, findings) {
  visit(ast, {
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

function detectSelfdestruct(source, ast, findings) {
  visit(ast, {
    FunctionCall(node) {
      const name = node.expression?.name || node.expression?.memberName
      if (name === 'selfdestruct' || name === 'suicide') {
        // Check if inside a function with access control
        findings.push({
          severity: CRITICAL,
          line: node.loc?.start?.line || 0,
          title: 'selfdestruct present',
          message: `selfdestruct destroys the contract and sends all ETH to the target. Ensure it has strict access control. Note: selfdestruct is deprecated in newer EVM versions.`
        })
      }
    }
  })
}

function detectReentrancy(source, ast, findings) {
  visit(ast, {
    FunctionDefinition(node) {
      if (!node.body?.statements) return

      // Check for nonReentrant modifier
      const hasGuard = (node.modifiers || []).some(m =>
        m.name === 'nonReentrant' || m.name === 'noReentrant' || m.name === 'lock'
      )
      if (hasGuard) return

      // Collect local variable names (params, returns, and any declared locals)
      // so we can distinguish state writes from local-variable writes.
      const locals = new Set()
      for (const p of (node.parameters || [])) { if (p?.name) locals.add(p.name) }
      for (const r of (node.returnParameters || [])) { if (r?.name) locals.add(r.name) }
      visit(node.body, {
        VariableDeclarationStatement(n) {
          for (const v of (n.variables || [])) { if (v?.name) locals.add(v.name) }
        }
      })

      let foundExternalCall = false
      let externalCallLine = 0

      for (const stmt of node.body.statements) {
        // Check for external calls
        if (hasExternalCall(stmt)) {
          foundExternalCall = true
          externalCallLine = stmt.loc?.start?.line || 0
        }

        // Check for state writes AFTER external call
        if (foundExternalCall && hasStateWrite(stmt, locals)) {
          findings.push({
            severity: CRITICAL,
            line: externalCallLine,
            title: 'Potential reentrancy',
            message: `State variable is modified after an external call in "${node.name || 'unnamed'}()". Follow the Checks-Effects-Interactions pattern: update state BEFORE making external calls. Consider adding a reentrancy guard.`
          })
          return // one finding per function
        }
      }
    }
  })
}

function detectUncheckedCall(source, ast, findings) {
  visit(ast, {
    FunctionCall(node) {
      if (node.expression?.memberName === 'call' ||
          node.expression?.memberName === 'delegatecall' ||
          node.expression?.memberName === 'staticcall') {

        // Check if the call is inside an assignment or require
        // Simple heuristic: flag .call() that's not in a variable declaration or require
        const name = node.expression.memberName
        if (name === 'delegatecall') {
          // Check if target is a variable (not constant/immutable)
          const expr = node.expression.expression
          if (expr && expr.type !== 'Identifier') { // complex expression = potentially user-controlled
            findings.push({
              severity: CRITICAL,
              line: node.loc?.start?.line || 0,
              title: 'Unsafe delegatecall',
              message: `delegatecall to a potentially user-controlled address can allow an attacker to execute arbitrary code in your contract's context.`
            })
          }
        }
      }
    }
  })

  // Text-based check for unchecked .call return
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('.call{') || line.includes('.call(')) {
      // Check if the bool return is captured
      if (!line.includes('(bool') && !line.includes('success') && !line.includes('ok') &&
          !lines[Math.max(0, i - 1)].includes('(bool') && !lines[Math.max(0, i - 1)].includes('require')) {
        findings.push({
          severity: CRITICAL,
          line: i + 1,
          title: 'Unchecked call return value',
          message: `The return value of .call() is not checked. Always check the bool return: (bool success, ) = addr.call{...}(...); require(success);`
        })
      }
    }
  }
}

function detectMissingAccessControl(source, ast, findings) {
  visit(ast, {
    FunctionDefinition(node) {
      if (!node.name) return // constructor, fallback, receive
      if (node.visibility !== 'public' && node.visibility !== 'external') return
      if (node.stateMutability === 'view' || node.stateMutability === 'pure') return

      const modifiers = (node.modifiers || []).map(m => m.name?.toLowerCase() || '')
      const hasAuth = modifiers.some(m =>
        m.includes('only') || m.includes('auth') || m.includes('role') ||
        m.includes('admin') || m.includes('owner') || m.includes('guard') ||
        m.includes('restricted') || m.includes('nonreentrant')
      )

      if (!hasAuth && node.body?.statements) {
        // Check if function body has require(msg.sender == ...)
        const bodyText = source.slice(node.body.range?.[0] || 0, node.body.range?.[1] || 0)
        if (!bodyText.includes('msg.sender') && !bodyText.includes('_checkOwner') && !bodyText.includes('_checkRole')) {
          findings.push({
            severity: HIGH,
            line: node.loc?.start?.line || 0,
            title: 'Missing access control',
            message: `"${node.name}()" is ${node.visibility} and modifies state but has no access control modifier. Anyone can call this function. Add onlyOwner, onlyRole, or similar if this is intentional, ignore this warning.`
          })
        }
      }
    }
  })
}

function detectUnboundedLoop(source, ast, findings) {
  visit(ast, {
    ForStatement(node) {
      // Check if the loop bound is a state variable or function call (not a local/constant)
      const cond = node.conditionExpression
      if (cond?.type === 'BinaryOperation') {
        const right = cond.right
        if (right?.type === 'MemberAccess' && right.memberName === 'length') {
          // array.length — check if it's a state variable
          findings.push({
            severity: HIGH,
            line: node.loc?.start?.line || 0,
            title: 'Potentially unbounded loop',
            message: `Loop iterates over an array length that may grow without bound. An attacker could add entries until the function exceeds the block gas limit (DoS). Consider pagination or a maximum iteration count.`
          })
        }
      }
    }
  })
}

function detectEthInLoop(source, ast, findings) {
  const lines = source.split('\n')
  let inLoop = false
  let loopDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('for') || line.startsWith('while')) { inLoop = true; loopDepth++ }
    if (inLoop) {
      if (line.includes('{')) loopDepth++
      if (line.includes('}')) { loopDepth--; if (loopDepth <= 0) { inLoop = false; loopDepth = 0 } }

      if (line.includes('.transfer(') || line.includes('.send(') ||
          (line.includes('.call{') && line.includes('value'))) {
        findings.push({
          severity: MEDIUM,
          line: i + 1,
          title: 'ETH transfer in loop',
          message: `Sending ETH inside a loop is risky. If one transfer fails (e.g., to a contract that reverts), the entire transaction fails. Use the pull-over-push pattern: let recipients withdraw their funds.`
        })
      }
    }
  }
}

function detectMissingZeroCheck(source, ast, findings) {
  visit(ast, {
    FunctionDefinition(node) {
      if (!node.parameters) return
      const addrParams = node.parameters.filter(p =>
        p.typeName?.name === 'address' || p.typeName?.namePath === 'address'
      )
      if (addrParams.length === 0) return

      const bodyText = node.body ? source.slice(node.body.range?.[0] || 0, node.body.range?.[1] || 0) : ''

      for (const param of addrParams) {
        const name = param.name
        if (!name) continue
        // Check if there's a zero-address check for this param
        if (!bodyText.includes(`${name} != address(0)`) &&
            !bodyText.includes(`${name} != address(0x0)`) &&
            !bodyText.includes(`${name} == address(0)`) &&
            !bodyText.includes(`_checkNonZero`) &&
            !bodyText.includes(`require(${name}`)) {
          findings.push({
            severity: MEDIUM,
            line: node.loc?.start?.line || 0,
            title: 'Missing zero-address check',
            message: `Parameter "${name}" in "${node.name || 'unnamed'}()" is not validated against address(0). Accidentally passing the zero address could lock funds permanently.`
          })
        }
      }
    }
  })
}

function detectMissingEvents(source, ast, findings) {
  visit(ast, {
    FunctionDefinition(node) {
      if (!node.name || !node.body?.statements) return
      if (node.visibility !== 'public' && node.visibility !== 'external') return
      if (node.stateMutability === 'view' || node.stateMutability === 'pure') return

      const bodyText = node.body ? source.slice(node.body.range?.[0] || 0, node.body.range?.[1] || 0) : ''
      const hasStateWrite = bodyText.includes('=') && !bodyText.includes('==') && !bodyText.includes('!=')
      const hasEmit = bodyText.includes('emit ')

      if (hasStateWrite && !hasEmit) {
        findings.push({
          severity: MEDIUM,
          line: node.loc?.start?.line || 0,
          title: 'State change without event',
          message: `"${node.name}()" modifies state but doesn't emit an event. Events are important for off-chain monitoring, indexing, and debugging.`
        })
      }
    }
  })
}

function detectBlockTimestamp(source, ast, findings) {
  visit(ast, {
    MemberAccess(node) {
      if (node.memberName === 'timestamp' && node.expression?.name === 'block') {
        findings.push({
          severity: MEDIUM,
          line: node.loc?.start?.line || 0,
          title: 'block.timestamp dependency',
          message: `block.timestamp can be slightly manipulated by miners/validators (~12s range). Don't use it for critical time-sensitive logic like randomness. For deadlines and expiry, it's generally acceptable.`
        })
      }
    }
  })
}

function detectUnsafeERC20(source, ast, findings) {
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Direct .transfer() or .transferFrom() on a token (not address.transfer which is ETH)
    if ((line.includes('.transfer(') || line.includes('.transferFrom(')) &&
        !line.includes('payable') && !line.includes('safeTransfer') &&
        !line.includes('IERC20') && line.includes('token') || line.includes('Token')) {
      // Very heuristic — only flag if it looks like a token interaction
      if (line.match(/\w+\.(transfer|transferFrom)\s*\(/)) {
        findings.push({
          severity: INFO,
          line: i + 1,
          title: 'Potentially unsafe ERC20 transfer',
          message: `Some ERC20 tokens (like USDT) don't return a bool from transfer/transferFrom. Use OpenZeppelin's SafeERC20 library to handle these safely.`
        })
      }
    }
  }
}

function detectUncheckedMath(source, ast, findings) {
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('unchecked')) {
      findings.push({
        severity: INFO,
        line: i + 1,
        title: 'Unchecked arithmetic block',
        message: `Unchecked block disables overflow/underflow protection. Make sure this is intentional and inputs are validated beforehand.`
      })
    }
  }
}

function detectMagicNumbers(source, ast, findings) {
  visit(ast, {
    NumberLiteral(node) {
      const val = node.number
      if (!val) return
      // Skip 0, 1, 2, common decimals, well-known constants
      const skip = ['0', '1', '2', '10', '18', '6', '8', '100', '1000', '10000', '256', '32', '0']
      if (skip.includes(val)) return
      // Skip hex literals (usually addresses or selectors)
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

// ── Gas Optimization Tips ────────────────────────────────────

const GAS = 'gas'

export function analyzeGasOptimizations(source) {
  const tips = []
  const lines = source.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // > 0 for unsigned integers (costs more than != 0)
    if (line.match(/>\s*0\b/) && !line.includes('int') && !line.includes('//')) {
      tips.push({ line: lineNum, col: line.indexOf('> 0'), message: 'Use "!= 0" instead of "> 0" for unsigned integers — saves ~6 gas per comparison' })
    }

    // .length in for loop condition (re-read every iteration)
    if (line.match(/for\s*\(/) && line.includes('.length')) {
      tips.push({ line: lineNum, col: line.indexOf('.length'), message: 'Cache array.length before the loop — reading .length from storage every iteration costs extra gas' })
    }

    // i++ instead of ++i in for loops
    if (line.match(/for\s*\(.*\bi\+\+/) && !line.includes('unchecked')) {
      tips.push({ line: lineNum, col: line.indexOf('i++'), message: 'Use "++i" instead of "i++" — saves ~5 gas per iteration (no temp copy needed)' })
    }

    // string error messages in require (costs more gas to deploy)
    const reqMatch = line.match(/require\s*\([^,]+,\s*"([^"]{20,})"/)
    if (reqMatch) {
      tips.push({ line: lineNum, col: line.indexOf(reqMatch[1]), message: `Long error string ("${reqMatch[1].slice(0, 20)}...") — consider a custom error to reduce deployment gas` })
    }

    // public instead of external (public copies calldata to memory)
    if (line.match(/function\s+\w+\s*\([^)]*\)\s+(public)/) && !line.includes('override')) {
      const col = line.indexOf('public')
      tips.push({ line: lineNum, col, message: 'Use "external" instead of "public" if the function is not called internally — avoids copying calldata to memory' })
    }

    // bool storage (costs extra since EVM uses a full slot)
    if (line.match(/^\s+bool\s+(public\s+)?[a-zA-Z]/) && !line.includes('//') && !line.includes('memory') && !line.includes('calldata')) {
      tips.push({ line: lineNum, col: line.indexOf('bool'), message: 'Bool storage variables use a full 256-bit slot — consider packing with adjacent small types or using uint8' })
    }

    // Initialize variable to default (wastes gas: uint256 x = 0)
    if (line.match(/uint\d*\s+\w+\s*=\s*0\s*;/) && !line.includes('//')) {
      tips.push({ line: lineNum, col: line.indexOf('= 0'), message: 'Default initialization to 0 is unnecessary — Solidity defaults uint to 0, saves deployment gas' })
    }

    // memory instead of calldata for read-only params
    if (line.match(/function\s+\w+.*\bmemory\b.*\bexternal\b/) || line.match(/function\s+\w+.*\bexternal\b.*\bmemory\b/)) {
      if (line.includes('memory') && (line.includes('string') || line.includes('bytes') || line.includes('[]'))) {
        tips.push({ line: lineNum, col: line.indexOf('memory'), message: 'Use "calldata" instead of "memory" for read-only external function parameters — avoids copying' })
      }
    }
  }

  return tips
}

// ── Helpers ──────────────────────────────────────────────────

// Built-in member methods that don't make external calls
const NON_EXTERNAL_METHODS = new Set(['push', 'pop', 'length', 'concat'])

function hasExternalCall(node) {
  let found = false
  try {
    visit(node, {
      FunctionCall(n) {
        // Unwrap .call{value: x}() — parser wraps these in NameValueExpression
        let expr = n.expression
        if (expr?.type === 'NameValueExpression') expr = expr.expression
        if (!expr) return

        // .call, .delegatecall, .staticcall, .transfer, .send
        if (expr.memberName === 'call' || expr.memberName === 'delegatecall' ||
            expr.memberName === 'staticcall' || expr.memberName === 'transfer' ||
            expr.memberName === 'send') {
          found = true
          return
        }
        // Direct contract calls: someContract.someFunction()
        if (expr.type === 'MemberAccess' && expr.expression?.type === 'Identifier') {
          // Heuristic: if calling a method on a variable (not a built-in namespace)
          const obj = expr.expression.name
          const builtins = ['this', 'super', 'msg', 'block', 'tx', 'abi', 'type', 'address']
          if (!builtins.includes(obj) && !NON_EXTERNAL_METHODS.has(expr.memberName)) {
            found = true
          }
        }
      }
    })
  } catch {}
  return found
}

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='])

// Walks a target expression (LHS of an assignment or subject of ++/--) down to
// its base identifier. E.g. balances[msg.sender].x → Identifier "balances".
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

function hasStateWrite(node, locals) {
  let found = false
  try {
    visit(node, {
      ExpressionStatement(n) {
        const expr = n.expression
        if (!expr) return

        let target = null
        // Assignment or compound assignment: x = ..., x += ..., x -= ..., etc.
        if (expr.type === 'BinaryOperation' && ASSIGN_OPS.has(expr.operator)) {
          target = expr.left
        }
        // Increment/decrement: x++, x--, ++x, --x
        else if (expr.type === 'UnaryOperation' && (expr.operator === '++' || expr.operator === '--')) {
          target = expr.subExpression
        }
        if (!target) return

        const name = baseIdentifierName(target)
        // Only flag writes to non-local (i.e. state) variables.
        if (name && !(locals && locals.has(name))) {
          found = true
        }
      }
    })
  } catch {}
  return found
}
