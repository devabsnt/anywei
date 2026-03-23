# anywei

A browser-based toolkit for Solidity developers. Write, compile, test, deploy, and debug — all from one tab, no setup required.

**[anywei.dev](https://anywei.dev)**

## Why

Solidity development involves constantly switching between tools: Remix for quick edits, Etherscan for decoding, a terminal for Foundry commands, a converter bookmark for hex math, and a dozen browser tabs for reference. anywei puts everything in one place.

No installs. No accounts. No wallet required (until you want to deploy). Just open the site and paste.

## Tools

### Solidity IDE
Full in-browser development environment with CodeMirror editor, Solidity syntax highlighting, and compilation via the official solc compiler loaded from CDN. Supports `@openzeppelin` imports resolved automatically through jsDelivr. Includes a file manager, contract templates (ERC20, ERC721, ERC1155, UUPS Proxy, Vault), and a terminal panel with Problems/Output/Artifacts tabs.

*Compile and iterate on contracts without installing anything locally.*

### Security Analyzer
Runs automatically after compilation. Parses the Solidity AST and flags common vulnerability patterns: reentrancy (CEI violations), `tx.origin` authentication, missing access control, unchecked call returns, selfdestruct, unbounded loops, ETH transfers in loops, missing zero-address checks, block.timestamp dependencies, floating pragmas, missing events, and unsafe ERC20 usage.

*Catch the patterns behind most real-world exploits before they reach production.*

### Quick Test / Fuzz
Deploy compiled contracts to a local EVM (powered by @ethereumjs/evm) and run tests without any network. **Quick Test** generates boundary-value test cases per parameter type (0, 1, max, empty arrays, zero addresses). **Fuzz** generates random but type-correct inputs for configurable iterations (50–1000) and reports gas distribution, failure rates, and the specific inputs that caused reverts.

*Smoke-test your contracts in seconds without writing a single test file.*

### Gas Estimator
Two modes. **Deployed contracts**: fetches recent transactions from Etherscan, groups by function selector, and shows min/median/avg/max gas with costs at current and projected gas prices. **Local contracts**: runs `eth_estimateGas` on the local EVM against your compiled bytecode.

*Know what a function costs before you ship it.*

### Deploy & Interact
Connect any wallet via RainbowKit (MetaMask, Coinbase, WalletConnect, Rainbow, and more). Deploy compiled contracts to any EVM chain — Ethereum, Sepolia, Holesky, Polygon, Arbitrum, Optimism, Base, Avalanche, BSC. After deployment, interact with the contract directly: call view functions, send transactions, pass parameters — all from within the IDE.

*Go from source code to a live contract without leaving the browser.*

### Calldata Decoder
Paste raw transaction input data and see the decoded function call with named parameters. Fetches the contract ABI automatically from Etherscan/Sourcify, or falls back to 4byte.directory and OpenChain for unknown selectors.

*Understand what any transaction is doing at a glance.*

### Calldata Encoder
Enter a function signature (or paste an ABI and select a function), fill in parameters, and generate the encoded calldata. Shows a word-by-word breakdown of the encoded output with selector highlighted.

*Build calldata for multisig proposals, Safe transactions, or manual `cast send` commands.*

### Event Log Decoder
Paste event topics and data (or a full JSON log object) to decode event parameters. Matches topic0 against known event signatures via OpenChain, or decodes using a provided ABI.

*Read raw event logs without manually matching topics to parameter types.*

### Error / Revert Decoder
Paste revert data from a failed transaction. Decodes `Error(string)`, `Panic(uint256)` with human-readable descriptions for all panic codes, and custom errors when an ABI is provided.

*Turn opaque revert bytes into an actionable error message.*

### Storage Slot Calculator
Compute storage slot positions for Solidity mappings, nested mappings, dynamic arrays, and structs. Shows intermediate keccak256 steps. Optionally read the actual on-chain value at the computed slot via `eth_getStorageAt`.

*Find and read any storage variable without the contract source.*

### Selector / Signature Lookup
**Lookup mode**: paste a 4-byte function selector or 32-byte event topic and see all matching signatures from OpenChain and 4byte.directory. **Compute mode**: type a function or event signature and get the selector and full keccak256 hash.

*Instantly identify unknown selectors from bytecode or transaction data.*

### Unit Converter
Live-updating conversions for everything Solidity devs deal with: wei/gwei/ether (with USD price), decimal/hex/binary, keccak256 hashing (UTF-8 or raw bytes), address checksumming and bytes32 padding, unix timestamps, and `abi.encode` / `abi.encodePacked` output.

*One dashboard for every conversion you reach for during development.*

### ABI Explorer
Paste a contract address or ABI JSON to see a clean breakdown: constructor, write functions, read functions, events, errors — each with selectors, parameter types, and copy buttons. Includes search/filter, proxy detection with automatic implementation ABI loading, and ABI download.

*Navigate complex contract interfaces quickly without reading the source.*

### Bytecode Disassembler
Paste bytecode or a contract address to see the full opcode listing. Color-coded by category (storage, memory, calls, control flow, stack). Shows stats: total bytes, SSTORE/SLOAD count, external calls, JUMPDESTs. Extracts function selectors from PUSH4 instructions. Detects CBOR metadata at the end of bytecode.

*Inspect what the compiler actually produced.*

### Contract Diff
Compare two ABIs or two bytecodes side by side. ABI diff highlights added, removed, and changed functions/events/errors. Bytecode diff shows per-byte differences with changed bytes highlighted.

*Verify exactly what changed in a proxy upgrade or contract migration.*

### Transaction Decoder
Paste a transaction hash to see the full breakdown: sender, receiver, value, gas used/price, cost, block number, status. Decodes calldata into the function call with named parameters. Decodes all emitted events. Shows contract creation address for deploy transactions.

*Understand any on-chain transaction without navigating Etherscan's UI.*

### Merkle Tree Generator
Paste a list of addresses and amounts to generate a Merkle root and individual proofs. Supports address-only mode for simple allowlists. Export the complete tree as JSON for contract integration.

*Generate airdrop and allowlist Merkle trees without running a script.*

### CREATE2 Address Calculator
Enter a deployer address, salt, and init code (or its hash) to compute the deterministic deployment address. Shows all intermediate values.

*Predict where a contract will be deployed before deploying it.*

### EIP-712 Signer / Verifier
Build EIP-712 typed data structures, sign them with a connected wallet, or verify existing signatures by recovering the signer address. Supports computing the struct hash without signing.

*Test permit signatures, gasless transactions, and off-chain auth flows.*

### Multicall Builder
Build batched calls for Multicall3. Add multiple target/function/argument combinations and encode them into a single aggregate3 calldata. Shows per-call breakdown with byte sizes.

*Batch multiple contract reads into a single RPC call.*

### Chain Reference
Quick-reference cards for 22 EVM chains and testnets: chain ID (decimal + hex), native currency, RPC URL (click to copy), and block explorer link. Searchable and filterable by mainnet/testnet.

*Look up chain IDs and RPCs without googling.*

## Stack

- **Vite** — bundler, dev server
- **viem** — ABI encoding/decoding, hashing, wallet interaction
- **CodeMirror 6** — editor with Solidity syntax highlighting
- **@ethereumjs/evm** — local EVM for testing and gas estimation
- **@solidity-parser/parser** — AST-based security analysis
- **RainbowKit + wagmi** — wallet connection and chain management
- **solc** — Solidity compiler loaded from official CDN in a Web Worker

All tools except the IDE and Quick Test load in under 10KB. Each tool is lazy-loaded on navigation — opening any tool doesn't load code for the others.

## Development

```bash
npm install
npm run dev
```

The Vercel serverless functions in `api/` proxy Etherscan/Blockscout and RPC calls. For local development, these are proxied via Vite's dev server config.

## License

MIT
