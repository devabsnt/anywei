# anywei

A browser-based toolkit for Solidity developers. Write, compile, test, deploy, and debug — all from one tab, no setup required.

**[anywei.dev](https://anywei.dev)**

## Why

Solidity development involves constantly switching between tools: Remix for quick edits, Etherscan for decoding, a terminal for Foundry commands, a converter bookmark for hex math, and a dozen browser tabs for reference. anywei puts everything in one place.

No installs. No accounts. No wallet required (until you want to deploy). Just open the site and paste.

## Tools

### Build

**Solidity IDE** — Full in-browser development environment with CodeMirror editor, Solidity syntax highlighting, and compilation via the official solc compiler loaded from CDN. Supports `@openzeppelin` imports resolved automatically through jsDelivr. Includes a file manager, contract templates (ERC20, ERC721, ERC1155, UUPS Proxy, Vault), terminal panel with Problems/Output/Artifacts tabs, find and replace, code formatting, and shareable URLs. Connect any wallet via RainbowKit and deploy directly to any EVM chain.

*Compile and iterate on contracts without installing anything locally.*

**dApp Builder** — Drag-and-drop frontend builder for contract interaction UIs. Load a contract from the IDE, a deployed address, or a predicted CREATE2 address. Drop components onto a grid canvas: connect wallet buttons, function call buttons, read displays, input fields, headings, balance displays, and event feeds. Chain components together (e.g., refresh a balance after a transaction succeeds) with visual arrow connections. Configure fonts, alignment, and theming (dark/light). Export as a standalone HTML file with ethers.js baked in — ready to host anywhere.

*Go from contract to working frontend without scaffolding a React app.*

**Quick Test / Fuzz** — Deploy compiled contracts to a local EVM (powered by @ethereumjs/evm) and run tests without any network. Quick Test generates boundary-value test cases per parameter type. Fuzz generates random inputs for configurable iterations. Includes an opcode trace viewer — click "Trace" on any test result to see step-by-step EVM execution with full stack inspection, editable params, and re-run capability.

*Smoke-test your contracts in seconds without writing a single test file.*

**Gas Estimator** — Two modes. Deployed contracts: fetches recent transactions from Etherscan, groups by function selector, shows min/median/avg/max gas with costs at current and projected gas prices. Local contracts: runs eth_estimateGas on the local EVM against your compiled bytecode with a "Fill All Random" button for quick testing.

*Know what a function costs before you ship it.*

**Security Analyzer** — Runs automatically after compilation in the IDE. Parses the Solidity AST and flags common vulnerability patterns: reentrancy, tx.origin authentication, missing access control, unchecked call returns, selfdestruct, unbounded loops, ETH transfers in loops, missing zero-address checks, block.timestamp dependencies, floating pragmas, missing events, and unsafe ERC20 usage.

*Catch the patterns behind most real-world exploits before they reach production.*

### Decode

**Calldata Decoder** — Paste raw transaction input data and see the decoded function call with named parameters. Fetches the contract ABI automatically, or falls back to 4byte.directory and OpenChain for unknown selectors.

*Understand what any transaction is doing at a glance.*

**Calldata Encoder** — Enter a function signature or paste an ABI, fill in parameters (or hit "Fill Random"), and generate encoded calldata with a word-by-word breakdown.

*Build calldata for multisig proposals, Safe transactions, or manual cast send commands.*

**Transaction Decoder** — Paste a transaction hash to see the full breakdown: sender, receiver, value, gas used/price, cost, block, status. Decodes calldata and all emitted events with named parameters.

*Understand any on-chain transaction without navigating Etherscan's UI.*

**Event Log Decoder** — Paste event topics and data (or a full JSON log object) to decode event parameters. Matches topic0 against known signatures or decodes using a provided ABI.

*Read raw event logs without manually matching topics to parameter types.*

**Error / Revert Decoder** — Paste revert data from a failed transaction. Decodes Error(string), Panic(uint256) with all panic codes explained, and custom errors when an ABI is provided.

*Turn opaque revert bytes into an actionable error message.*

### Inspect

**ABI Explorer** — Paste a contract address or ABI JSON to see a clean breakdown of the interface. Grouped by constructor, write/read functions, events, and errors with selectors, search/filter, proxy detection, and ABI download.

*Navigate complex contract interfaces quickly.*

**Bytecode Disassembler** — Parse bytecode into opcodes with offsets, colour-coded by category (storage, memory, calls, control flow). Shows stats, extracts function selectors, and detects CBOR metadata.

*Inspect what the compiler actually produced.*

**Contract Diff** — Compare two ABIs or bytecodes side by side. ABI diff highlights added, removed, and changed items. Bytecode diff shows per-byte differences with individual changed bytes highlighted.

*Verify exactly what changed in a proxy upgrade.*

**Storage Slot Calculator** — Compute storage slot positions for mappings, nested mappings, arrays, and structs with intermediate keccak256 steps. Optionally read the actual on-chain value.

*Find and read any storage variable without the contract source.*

**Selector / Signature Lookup** — Look up function/event signatures from selectors via OpenChain and 4byte.directory, or compute selectors from signatures.

*Instantly identify unknown selectors from bytecode or transaction data.*

### Utilities

**Unit Converter** — Live-updating conversions: wei/gwei/ether with USD price, decimal/hex/binary, keccak256 hashing, address checksumming, unix timestamps, and abi.encode/abi.encodePacked.

*One dashboard for every conversion you reach for during development.*

**Merkle Tree Generator** — Paste addresses and amounts to generate a Merkle root and individual proofs. Export as JSON for contract integration.

*Generate airdrop and allowlist Merkle trees without running a script.*

**CREATE2 Address Calculator** — Enter deployer, salt, and init code to compute the deterministic deployment address.

*Predict where a contract will be deployed before deploying it.*

**EIP-712 Signer / Verifier** — Build EIP-712 typed data, sign with a connected wallet, verify signatures by recovering the signer, or compute struct hashes.

*Test permit signatures, gasless transactions, and off-chain auth flows.*

**Multicall Builder** — Build batched calls for Multicall3. Add multiple target/function/argument combinations and encode into a single aggregate3 calldata.

*Batch multiple contract reads into a single RPC call.*

**Chain Reference** — Quick-reference cards for 22+ EVM chains and testnets: chain ID, native currency, RPC URL (click to copy), and block explorer link.

*Look up chain IDs and RPCs without googling.*

## Stack

- **Vite** — bundler, dev server
- **viem** — ABI encoding/decoding, hashing, wallet interaction
- **CodeMirror 6** — editor with Solidity syntax highlighting
- **@ethereumjs/evm** — local EVM for testing and gas estimation
- **@solidity-parser/parser** — AST-based security analysis
- **RainbowKit + wagmi** — wallet connection and chain management
- **solc** — Solidity compiler loaded from official CDN in a Web Worker
- **ethers.js** — baked into dApp Builder exports for standalone frontends

Each tool is lazy-loaded on navigation — opening any tool doesn't load code for the others.

## Development

```bash
npm install
npm run dev
```

The Vercel serverless functions in `api/` proxy Etherscan/Blockscout and RPC calls. For local development, these are proxied via Vite's dev server config.

## Built by

[@_absnt](https://x.com/_absnt)

## License

MIT
