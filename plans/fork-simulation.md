# Fork-simulation mode — implementation plan

## Goal

Let Quick Test (and eventually Gas Estimator, Invariants) run against a
pinned block of a real chain. User supplies RPC URL + block number; the
tool lazy-fetches state from upstream on every `SLOAD`/`EXTCODECOPY`, caches
it, and stores overrides locally.

Use cases: "what happens if I swap 100 ETH on Uniswap right now", "does my
callback interact correctly with cDAI", replaying real mainnet positions.

## Architecture sketch

```
User action: runs Quick Test in fork mode
  │
  ▼
ForkStateManager (replaces SimpleStateManager in LocalEVM)
  │
  ├── inMemoryStorage: Map<addr,Map<slot,value>>  (local writes + cache)
  ├── inMemoryCode:    Map<addr, bytes>          (fetched + overrides)
  ├── inMemoryAccounts: Map<addr, account>        (fetched + overrides)
  │
  └── on miss, async fetch from upstream at pinned block:
        eth_getStorageAt(addr, slot, blockNum)
        eth_getCode(addr, blockNum)
        eth_getBalance(addr, blockNum)
        eth_getTransactionCount(addr, blockNum)
```

## The key obstacle: async state in a sync state manager

`@ethereumjs/evm` expects synchronous state reads during execution. The
`StateManager` interface has async methods, but `evm.runCall` awaits them
in a loop — as long as we return a `Promise`, it works.

**The catch**: each SLOAD during execution now triggers a network round-trip
unless cached. A non-trivial transaction may hit 50+ storage slots; at 100ms
per RPC call, that's 5 seconds per test. Unacceptable.

**Solution**: pre-warm the cache.

1. Do a "scout" run: trace the transaction with a stub state manager that
   records every slot/account touched.
2. Batch-fetch them all in parallel via multicall or concurrent requests.
3. Re-run with the populated cache for fast, accurate execution.

For repeated tests (Quick Test's boundary cases, Fuzz's iterations), the
scout cache is reused. Only the first run is slow.

## State reversion between test cases

Each test case must start from the same forked state. Options:

- **Snapshot/revert**: LocalEVM already supports this. `ForkStateManager`
  would snapshot its *local overrides* only (the upstream cache is never
  mutated). Revert = drop overrides, keep cache.
- **Fresh state manager per test**: simpler but re-does scout phase.

Recommendation: snapshot-based, since tests should share the upstream cache.

## Interface

### ForkConfig
```js
{
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/...',
  blockNumber: 19000000,   // or 'latest'
  cache: 'session',        // 'session' | 'memory' | 'none'
}
```

### Tool integration

Quick Test and Gas Estimator grow a "Fork" toggle in local mode:

```
[ ] Fork mainnet at block [_____________]
    RPC URL: [_______________________________]
```

Enabling it swaps `createLocalEVM()` → `createForkedLocalEVM(config)`.

## File structure

```
js/shared/fork-state-manager.js   — ForkStateManager class
js/shared/fork-evm.js             — createForkedLocalEVM() factory
js/shared/rpc-batch.js            — request batching + concurrency limiter
```

## Complexity estimate

- `ForkStateManager`: **~300 LOC** (implements all StateManager methods)
- Scout tracer: **~100 LOC**
- RPC batching + retry + cache: **~150 LOC**
- `createForkedLocalEVM`: **~80 LOC**
- Tool integration (Quick Test, Gas Estimator): **~150 LOC**
- Tests: **~200 LOC**

**Total: ~1000 LOC.** Less than Foundry importer but more infrastructure-heavy.

## Risk / uncertainty

1. **RPC rate limits**: running a 1000-iteration fuzz against a forked state
   can burn through a free tier quickly. Need to warn users and encourage
   heavy caching.
2. **Archive-node requirements**: `eth_getStorageAt(..., blockNum)` for
   older blocks requires archive access. Most public RPCs only keep 128
   recent blocks. Detection + error message.
3. **StateManager compatibility**: `@ethereumjs/statemanager`'s API changes
   between versions. Need to pin the version and test against it.
4. **EXTCODESIZE / EXTCODECOPY**: need to fetch foreign code lazily, not
   just for the target contract.
5. **CHAINID / BLOCKHASH**: need to mirror upstream values or tests see
   wrong chain.

## Suggested rollout

- **v1**: happy path (fork latest, single contract, read-only). Ship to
  gauge demand before investing in edge cases.
- **v2**: archive block support, multi-contract traces, pre-warm scouting.
- **v3**: persistent IndexedDB cache across sessions.

## Why we're deferring

This needs a dedicated session because:
1. It's a new infrastructure primitive (state manager, RPC batching, cache
   layer) that will get reused by multiple tools.
2. The correctness bar is high — silently wrong state would break every
   test that depends on it.
3. Real-world testing requires a funded RPC endpoint, which doesn't
   fit this session's scope.
