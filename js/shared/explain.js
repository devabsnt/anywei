/**
 * Generate plain-English explanations of decoded function calls.
 * No LLM — pattern matching on known signatures + smart param formatting.
 */
import { formatEther } from 'viem'

// ── Known function templates ────────────────────────────────
// Keys are function names (matched case-insensitive). Each has a template function
// that receives (args, paramNames, contractAddr) and returns a string.

const TEMPLATES = {
  // ERC20
  transfer: (args, names) => `Transfers ${fmtTokenAmount(args[1])} to ${fmtAddr(args[0])}`,
  transferFrom: (args) => `Transfers ${fmtTokenAmount(args[2])} from ${fmtAddr(args[0])} to ${fmtAddr(args[1])}`,
  approve: (args) => `Approves ${fmtAddr(args[0])} to spend ${args[1] === 115792089237316195423570985008687907853269984665640564039457584007913129639935n ? 'unlimited' : fmtTokenAmount(args[1])} tokens`,
  mint: (args) => args.length === 2 ? `Mints ${fmtTokenAmount(args[1])} to ${fmtAddr(args[0])}` : args.length === 1 ? `Mints to ${fmtAddr(args[0])}` : 'Mints tokens',
  burn: (args) => args.length >= 1 ? `Burns ${fmtTokenAmount(args[0])}` : 'Burns tokens',

  // ERC721
  safeTransferFrom: (args) => args.length >= 3 ? `Transfers NFT #${args[2]} from ${fmtAddr(args[0])} to ${fmtAddr(args[1])}` : 'Transfers NFT',
  setApprovalForAll: (args) => `${args[1] ? 'Grants' : 'Revokes'} approval for all tokens to ${fmtAddr(args[0])}`,

  // Uniswap V2
  swapExactTokensForTokens: (args) => `Swaps ${fmtTokenAmount(args[0])} tokens for at least ${fmtTokenAmount(args[1])} tokens via ${(args[2]?.length || 0)}-hop path`,
  swapExactETHForTokens: (args) => `Swaps ETH for at least ${fmtTokenAmount(args[0])} tokens`,
  swapExactTokensForETH: (args) => `Swaps ${fmtTokenAmount(args[0])} tokens for at least ${fmtEth(args[1])} ETH`,
  addLiquidity: () => 'Adds liquidity to a token pair',
  removeLiquidity: () => 'Removes liquidity from a token pair',

  // Uniswap V3
  exactInput: (args) => {
    const params = args[0]
    if (params && typeof params === 'object') {
      return `Swaps ${fmtTokenAmount(params.amountIn || params[2])} tokens for at least ${fmtTokenAmount(params.amountOutMinimum || params[3])} via V3 router`
    }
    return 'Executes exact input swap via V3'
  },
  exactOutput: () => 'Executes exact output swap via V3',
  multicall: (args) => `Batched call with ${args[0]?.length || '?'} sub-calls`,

  // Common patterns
  deposit: () => 'Deposits ETH/tokens',
  withdraw: (args) => args.length >= 1 ? `Withdraws ${fmtTokenAmount(args[0])}` : 'Withdraws funds',
  stake: (args) => args.length >= 1 ? `Stakes ${fmtTokenAmount(args[0])}` : 'Stakes tokens',
  unstake: (args) => args.length >= 1 ? `Unstakes ${fmtTokenAmount(args[0])}` : 'Unstakes tokens',
  claim: () => 'Claims rewards',
  claimReward: () => 'Claims accumulated rewards',
  claimRewards: () => 'Claims accumulated rewards',
  harvest: () => 'Harvests yield/rewards',

  // Governance
  propose: () => 'Creates a governance proposal',
  castVote: (args) => `Votes ${args[1] === 1n || args[1] === true ? 'FOR' : args[1] === 0n || args[1] === false ? 'AGAINST' : 'ABSTAIN'} on proposal #${args[0]}`,
  execute: () => 'Executes a passed proposal',
  queue: () => 'Queues a proposal for execution',

  // Admin
  transferOwnership: (args) => `Transfers ownership to ${fmtAddr(args[0])}`,
  renounceOwnership: () => 'Permanently renounces ownership (irreversible)',
  grantRole: (args) => `Grants role to ${fmtAddr(args[1])}`,
  revokeRole: (args) => `Revokes role from ${fmtAddr(args[1])}`,
  pause: () => 'Pauses the contract',
  unpause: () => 'Unpauses the contract',
  upgradeTo: (args) => `Upgrades implementation to ${fmtAddr(args[0])}`,
  upgradeToAndCall: (args) => `Upgrades implementation to ${fmtAddr(args[0])} and calls initializer`,

  // ENS
  register: () => 'Registers an ENS name',
  renew: () => 'Renews an ENS name',
  setAddr: () => 'Sets the address for an ENS name',
  setName: () => 'Sets the reverse ENS record',

  // Safe/Multisig
  execTransaction: () => 'Executes a multisig transaction',
  addOwnerWithThreshold: (args) => `Adds ${fmtAddr(args[0])} as an owner, sets threshold to ${args[1]}`,
  removeOwner: (args) => `Removes owner ${fmtAddr(args[2] || args[0])}`,
}

// ── Formatters ──────────────────────────────────────────────

function fmtAddr(addr) {
  if (!addr || typeof addr !== 'string') return '?'
  if (addr === '0x0000000000000000000000000000000000000000') return 'zero address'
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

function fmtTokenAmount(val) {
  if (val === undefined || val === null) return '?'
  const n = typeof val === 'bigint' ? val : BigInt(String(val))
  if (n === 0n) return '0'
  // Try common decimals
  const s = n.toString()
  if (s.length > 18) return (Number(n) / 1e18).toFixed(4) + ' (18 dec)'
  if (s.length > 6 && s.length <= 12) return (Number(n) / 1e6).toFixed(2) + ' (6 dec)'
  return s
}

function fmtEth(val) {
  if (val === undefined || val === null) return '?'
  try { return formatEther(BigInt(String(val))) } catch { return String(val) }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Generate a plain-English explanation of a function call.
 * @param {string} functionName — the decoded function name
 * @param {Array} args — decoded arguments
 * @param {Array} inputs — ABI inputs with names/types
 * @param {bigint} value — msg.value if any
 * @returns {string|null} — explanation or null if unknown
 */
export function explainCall(functionName, args, inputs, value) {
  if (!functionName) return null

  // Try known template
  const template = TEMPLATES[functionName]
  if (template) {
    try {
      let explanation = template(args || [], inputs)
      if (value && value > 0n) {
        explanation += ` with ${fmtEth(value)} ETH`
      }
      return explanation
    } catch { /* fall through to generic */ }
  }

  // Generic explanation from param names
  if (!args?.length) {
    return value && value > 0n ? `Calls ${functionName}() with ${fmtEth(value)} ETH` : null
  }

  const parts = []
  for (let i = 0; i < (inputs?.length || args.length); i++) {
    const inp = inputs?.[i]
    const val = args[i]
    const name = inp?.name || `arg${i}`
    const type = inp?.type || ''

    if (type === 'address') parts.push(`${name}=${fmtAddr(val)}`)
    else if (type.startsWith('uint') || type.startsWith('int')) parts.push(`${name}=${fmtTokenAmount(val)}`)
    else if (type === 'bool') parts.push(`${name}=${val}`)
    else if (type === 'string') parts.push(`${name}="${String(val).slice(0, 30)}"`)
    else parts.push(`${name}=...`)
  }

  let explanation = `Calls ${functionName}(${parts.join(', ')})`
  if (value && value > 0n) explanation += ` with ${fmtEth(value)} ETH`
  return explanation
}

/**
 * Explain an event emission.
 */
export function explainEvent(eventName, args, inputs) {
  if (!eventName) return null

  const EVENTS = {
    Transfer: (a) => `${fmtAddr(a[0])} sent ${fmtTokenAmount(a[2])} to ${fmtAddr(a[1])}`,
    Approval: (a) => `${fmtAddr(a[0])} approved ${fmtAddr(a[1])} for ${fmtTokenAmount(a[2])}`,
    Deposit: (a) => a.length >= 2 ? `${fmtAddr(a[0])} deposited ${fmtTokenAmount(a[1])}` : 'Deposit',
    Withdrawal: (a) => a.length >= 2 ? `${fmtAddr(a[0])} withdrew ${fmtTokenAmount(a[1])}` : 'Withdrawal',
    Swap: () => 'Token swap executed',
    OwnershipTransferred: (a) => `Ownership transferred from ${fmtAddr(a[0])} to ${fmtAddr(a[1])}`,
    Paused: () => 'Contract paused',
    Unpaused: () => 'Contract unpaused',
  }

  const template = EVENTS[eventName]
  if (template) {
    try {
      const argValues = Array.isArray(args) ? args : inputs?.map(i => args?.[i.name]) || []
      return template(argValues)
    } catch {}
  }
  return null
}
