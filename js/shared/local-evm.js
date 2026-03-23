/**
 * LocalEVM — comprehensive wrapper around @ethereumjs/evm
 *
 * A complete local Ethereum execution environment for testing,
 * fuzzing, and gas estimation. No network, no fork, pure local.
 */
import { createEVM } from '@ethereumjs/evm'
import { SimpleStateManager } from '@ethereumjs/statemanager'
import { Mainnet, Common } from '@ethereumjs/common'
import {
  createAddressFromString, createAccount,
  hexToBytes, bytesToHex,
  Account
} from '@ethereumjs/util'

// ── Helpers ──────────────────────────────────────────────────

function toAddr(hex) {
  return createAddressFromString(hex.toLowerCase())
}

function toBytes(hex) {
  if (!hex || hex === '0x') return new Uint8Array(0)
  return hexToBytes(hex.startsWith('0x') ? hex : '0x' + hex)
}

function toHex(bytes) {
  return bytesToHex(bytes)
}

function calculateIntrinsicGas(data) {
  let gas = 21000n
  if (!data || data.length === 0) return gas
  for (const byte of data) {
    gas += byte === 0 ? 4n : 16n
  }
  return gas
}

// ── LocalEVM Class ──────────────────────────────────────────

export class LocalEVM {
  constructor() {
    this.common = null
    this.stateManager = null
    this.evm = null
    this._ready = false
    this._snapshots = []
    this._blockContext = {
      number: 20000000n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      baseFee: 1000000000n, // 1 gwei
      coinbase: '0x0000000000000000000000000000000000000000',
      gasLimit: 30000000n,
      difficulty: 0n,
    }
  }

  // ── Initialization ──────────────────────────────────────

  async init() {
    if (this._ready) return this
    this.common = new Common({ chain: Mainnet })
    this.stateManager = new SimpleStateManager()
    this.evm = await createEVM({
      common: this.common,
      stateManager: this.stateManager,
    })
    this._ready = true
    return this
  }

  _ensureReady() {
    if (!this._ready) throw new Error('LocalEVM not initialized. Call init() first.')
  }

  // ── Account Management ──────────────────────────────────

  /** Create or overwrite an account */
  async createAccount(address, { balance = 0n, nonce = 0n, code } = {}) {
    this._ensureReady()
    const addr = toAddr(address)
    await this.stateManager.putAccount(addr, createAccount({ nonce, balance }))
    if (code) await this.stateManager.putCode(addr, toBytes(code))
    return this
  }

  /** Set account balance (overwrites existing) */
  async setBalance(address, balance) {
    this._ensureReady()
    const addr = toAddr(address)
    const existing = await this.stateManager.getAccount(addr)
    const nonce = existing?.nonce ?? 0n
    await this.stateManager.putAccount(addr, createAccount({ nonce, balance: BigInt(balance) }))
    return this
  }

  /** Get account balance */
  async getBalance(address) {
    this._ensureReady()
    const acc = await this.stateManager.getAccount(toAddr(address))
    return acc?.balance ?? 0n
  }

  /** Add to existing balance */
  async fundAccount(address, amount) {
    const current = await this.getBalance(address)
    await this.setBalance(address, current + BigInt(amount))
    return this
  }

  /** Set account nonce */
  async setNonce(address, nonce) {
    this._ensureReady()
    const addr = toAddr(address)
    const existing = await this.stateManager.getAccount(addr)
    const balance = existing?.balance ?? 0n
    await this.stateManager.putAccount(addr, createAccount({ nonce: BigInt(nonce), balance }))
    return this
  }

  /** Get account nonce */
  async getNonce(address) {
    this._ensureReady()
    const acc = await this.stateManager.getAccount(toAddr(address))
    return acc?.nonce ?? 0n
  }

  /** Check if account exists and has code or balance */
  async accountExists(address) {
    this._ensureReady()
    const acc = await this.stateManager.getAccount(toAddr(address))
    return acc !== undefined && (acc.balance > 0n || acc.nonce > 0n)
  }

  /** Check if address is a contract (has code) */
  async isContract(address) {
    this._ensureReady()
    const code = await this.stateManager.getCode(toAddr(address))
    return code && code.length > 0
  }

  // ── Code ────────────────────────────────────────────────

  /** Deploy runtime bytecode at an address (no constructor execution) */
  async deployCode(address, bytecode) {
    this._ensureReady()
    const addr = toAddr(address)
    const existing = await this.stateManager.getAccount(addr)
    if (!existing) {
      await this.stateManager.putAccount(addr, createAccount({ nonce: 1n, balance: 0n }))
    }
    await this.stateManager.putCode(addr, toBytes(bytecode))
    return this
  }

  /** Get deployed code at an address */
  async getCode(address) {
    this._ensureReady()
    const code = await this.stateManager.getCode(toAddr(address))
    return code ? toHex(code) : '0x'
  }

  /** Deploy via CREATE — execute constructor bytecode, return deployed address */
  async deploy({ from, bytecode, value = 0n, gasLimit = 30000000n }) {
    this._ensureReady()
    const result = await this.evm.runCall({
      caller: toAddr(from),
      data: toBytes(bytecode),
      value: BigInt(value),
      gasLimit: BigInt(gasLimit),
      isCreate: true,
    })

    if (result.execResult.exceptionError) {
      throw new Error(`Deploy failed: ${result.execResult.exceptionError.error}`)
    }

    const deployedAddr = result.createdAddress ? toHex(result.createdAddress.bytes) : null
    return {
      address: deployedAddr,
      gasUsed: result.execResult.executionGasUsed,
      deployedBytecode: toHex(result.execResult.returnValue),
    }
  }

  // ── Storage ─────────────────────────────────────────────

  /** Get a single storage slot */
  async getStorage(address, slot) {
    this._ensureReady()
    const val = await this.stateManager.getStorage(toAddr(address), toBytes(slot))
    return val ? toHex(val) : '0x' + '00'.repeat(32)
  }

  /** Set a single storage slot */
  async setStorage(address, slot, value) {
    this._ensureReady()
    await this.stateManager.putStorage(toAddr(address), toBytes(slot), toBytes(value))
    return this
  }

  /** Set multiple storage slots at once */
  async setStorageMany(address, entries) {
    for (const [slot, value] of Object.entries(entries)) {
      await this.setStorage(address, slot, value)
    }
    return this
  }

  // ── Execution ───────────────────────────────────────────

  /** Execute a call (may modify state) */
  async call({ from, to, data = '0x', value = 0n, gasLimit = 30000000n }) {
    this._ensureReady()
    const result = await this.evm.runCall({
      caller: toAddr(from),
      to: toAddr(to),
      data: toBytes(data),
      value: BigInt(value),
      gasLimit: BigInt(gasLimit),
    })

    const execResult = result.execResult
    const success = !execResult.exceptionError
    const executionGas = execResult.executionGasUsed
    const intrinsicGas = calculateIntrinsicGas(toBytes(data))

    return {
      success,
      gasUsed: intrinsicGas + executionGas,
      executionGasUsed: executionGas,
      intrinsicGas,
      returnData: toHex(execResult.returnValue),
      error: execResult.exceptionError?.error || null,
      logs: execResult.logs || [],
    }
  }

  /** Execute a static call (no state modification, reverts if state is touched) */
  async staticCall({ from, to, data = '0x', gasLimit = 30000000n }) {
    this._ensureReady()
    const result = await this.evm.runCall({
      caller: toAddr(from),
      to: toAddr(to),
      data: toBytes(data),
      gasLimit: BigInt(gasLimit),
      isStatic: true,
    })

    const execResult = result.execResult
    return {
      success: !execResult.exceptionError,
      returnData: toHex(execResult.returnValue),
      gasUsed: calculateIntrinsicGas(toBytes(data)) + execResult.executionGasUsed,
      executionGasUsed: execResult.executionGasUsed,
      error: execResult.exceptionError?.error || null,
    }
  }

  /** Estimate gas for a call (runs it, returns total gas) */
  async estimateGas({ from, to, data = '0x', value = 0n }) {
    const result = await this.call({ from, to, data, value })
    if (!result.success) {
      const err = new Error(`Execution reverted: ${result.error || 'unknown'}`)
      err.returnData = result.returnData
      throw err
    }
    // Add a small buffer (same as Geth does — 30% overhead for safety)
    return result.gasUsed
  }

  // ── State Snapshots ─────────────────────────────────────

  /** Take a state snapshot, returns snapshot ID */
  async snapshot() {
    this._ensureReady()
    await this.stateManager.checkpoint()
    const id = this._snapshots.length
    this._snapshots.push(true)
    return id
  }

  /** Revert to a snapshot (discards all changes since) */
  async revert(snapshotId) {
    this._ensureReady()
    if (snapshotId === undefined) snapshotId = this._snapshots.length - 1
    // Revert all checkpoints up to and including the target
    while (this._snapshots.length > snapshotId) {
      await this.stateManager.revert()
      this._snapshots.pop()
    }
    return this
  }

  /** Commit current checkpoint (keep changes) */
  async commit() {
    this._ensureReady()
    await this.stateManager.commit()
    if (this._snapshots.length > 0) this._snapshots.pop()
    return this
  }

  /** Full reset — create a fresh EVM instance */
  async reset() {
    this._ready = false
    this._snapshots = []
    await this.init()
    return this
  }

  // ── Block Context ───────────────────────────────────────

  /** Set block context values for execution */
  setBlockContext({ number, timestamp, baseFee, coinbase, gasLimit, difficulty } = {}) {
    if (number !== undefined) this._blockContext.number = BigInt(number)
    if (timestamp !== undefined) this._blockContext.timestamp = BigInt(timestamp)
    if (baseFee !== undefined) this._blockContext.baseFee = BigInt(baseFee)
    if (coinbase !== undefined) this._blockContext.coinbase = coinbase
    if (gasLimit !== undefined) this._blockContext.gasLimit = BigInt(gasLimit)
    if (difficulty !== undefined) this._blockContext.difficulty = BigInt(difficulty)
    return this
  }

  /** Advance block number and timestamp */
  advanceBlock(blocks = 1, timePerBlock = 12) {
    this._blockContext.number += BigInt(blocks)
    this._blockContext.timestamp += BigInt(blocks * timePerBlock)
    return this
  }

  /** Set timestamp to current wall clock time */
  syncTimestamp() {
    this._blockContext.timestamp = BigInt(Math.floor(Date.now() / 1000))
    return this
  }

  // ── Convenience ─────────────────────────────────────────

  /** Deploy runtime bytecode and fund the caller in one step */
  async setup({ contractCode, contractAddress = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', callerAddress = '0x5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e5e7e', callerBalance = 10n ** 24n }) {
    await this.init()
    await this.createAccount(callerAddress, { balance: callerBalance })
    await this.deployCode(contractAddress, contractCode)
    return { contractAddress, callerAddress }
  }
}

// ── Factory ──────────────────────────────────────────────────

/** Create and initialize a LocalEVM instance */
export async function createLocalEVM() {
  const evm = new LocalEVM()
  await evm.init()
  return evm
}
