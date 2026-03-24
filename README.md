# anywei

A browser-based toolkit for Solidity developers. Write, compile, test, deploy, and debug from one tab. No setup required.

**[anywei.dev](https://anywei.dev)**

## Why

Solidity development means constantly switching between tools. Remix for quick edits, Etherscan for decoding, a terminal for Foundry, a converter bookmark for hex math, and a dozen browser tabs for reference. anywei puts everything in one place.

No installs. No accounts. No wallet required (until you want to deploy). Just open and paste.

## Tools

### Build

**Solidity IDE** - In-browser editor with CodeMirror syntax highlighting, solc compilation via Web Worker, `@openzeppelin` import resolution through jsDelivr, file manager, contract templates, terminal panel, find/replace, code formatting, contract flattening, shareable URLs, and wallet-based deployment to any EVM chain via RainbowKit. Live linting underlines security issues and gas optimizations as you type.

**dApp Builder** - Drag-and-drop frontend builder for contract interaction UIs. Load a contract from the IDE, a deployed address, or a predicted CREATE2 address. Drop components onto a grid canvas, chain them together with visual arrow connections, configure theming, and export as a standalone HTML file with ethers.js baked in.

**Quick Test / Fuzz** - Deploy compiled contracts to a local EVM and run tests without any network. Quick Test generates boundary-value test cases per parameter type. Fuzz generates random inputs for configurable iterations. Includes an opcode trace viewer with step-by-step execution, full stack inspection, and editable params for re-runs.

**Gas Estimator** - Two modes. Deployed contracts: historical gas data from recent transactions with min/median/avg/max breakdown. Local contracts: eth_estimateGas on the local EVM with "Fill All Random" for quick testing. Both show costs at current and projected gas prices.

**Security Analyzer** - Runs after compilation and live as you type. Parses the Solidity AST to flag reentrancy, tx.origin auth, missing access control, unchecked call returns, selfdestruct, unbounded loops, ETH transfers in loops, missing zero-address checks, block.timestamp dependencies, floating pragmas, missing events, and unsafe ERC20 usage. Duplicate findings are grouped with expandable counts.

**Gas Optimization Tips** - Inline green underlines in the editor for gas-saving patterns: `!= 0` over `> 0`, caching `.length`, `++i` over `i++`, custom errors over long require strings, `external` over `public`, `calldata` over `memory`, and more.

**Contract Size Monitor** - After compilation, shows a progress bar for each contract against the 24KB EIP-170 limit. Green under 75%, yellow 75-90%, red over 90%.

**Contract Flattener** - One-click in the IDE toolbar. Resolves all imports and concatenates into a single file with deduplicated pragmas and licenses. Ready for Etherscan verification.

### Decode

**Calldata Decoder** - Paste raw transaction input data to see the decoded function call with named parameters. Auto-fetches ABIs, falls back to 4byte.directory and OpenChain.

**Calldata Encoder** - Enter a function signature or paste an ABI, fill in parameters (or hit "Fill Random"), and generate encoded calldata with a word-by-word breakdown.

**Event Log Decoder** - Paste event topics and data (or full JSON log) to decode event parameters with signature lookup.

**Error / Revert Decoder** - Paste revert data to decode Error(string), Panic(uint256) with human-readable codes, and custom errors from an ABI.

### Inspect

**Explorer** - Paste an address or transaction hash. Addresses show balance, nonce, contract info, and recent transactions with decoded function calls. Transaction hashes open in a modal with full breakdown, decoded calldata, and events. Click any address or hash to navigate.

**ABI Explorer** - Paste a contract address or ABI JSON for a clean breakdown: constructor, write/read functions, events, errors with selectors, search/filter, proxy detection, and ABI download.

**Bytecode Disassembler** - Parse bytecode into colour-coded opcodes. Shows stats (SSTORE/SLOAD count, external calls, JUMPDESTs), extracts function selectors, detects CBOR metadata.

**Contract Diff** - Compare two ABIs or bytecodes side by side. Added/removed/changed items highlighted. Bytecode diff highlights individual changed bytes.

**Storage Slot Calculator** - Compute storage slot positions for mappings, nested mappings, arrays, and structs. Shows keccak256 intermediate steps. Optionally reads the on-chain value.

**Selector / Signature Lookup** - Look up function/event signatures from selectors, or compute selectors from signatures. Uses OpenChain and 4byte.directory.

**Interface Checker** - Check if a contract correctly implements an interface. Supports ERC20, ERC721, ERC1155 standards or custom ABIs. Shows pass/fail per function with return type validation.

**Proxy Inspector** - Paste any contract address to detect its proxy pattern (EIP-1967, EIP-1822, OpenZeppelin legacy, EIP-1167 minimal proxy, Beacon). Shows implementation address, admin, and all checked storage slots.

### Utilities

**Unit Converter** - Live-updating conversions: wei/gwei/ether with USD, decimal/hex/binary, keccak256, address checksumming, timestamps, and abi.encode/encodePacked.

**Merkle Tree Generator** - Paste or upload addresses and amounts. Generates Merkle root and individual proofs. Export as JSON. Supports address-only mode for simple allowlists.

**CREATE2 Calculator** - Enter deployer, salt, and init code (or hash) to compute the deterministic deployment address. Live updates as you type.

**EIP-712 Signer / Verifier** - Build typed data, sign with a connected wallet, verify signatures by recovering the signer, or compute struct hashes.

**Multicall Builder** - Build batched calls for Multicall3. Add multiple targets and functions, encode into a single aggregate3 calldata.

**Chain Reference** - Reference cards for 22+ EVM chains and testnets with chain ID, currency, RPC URL, and block explorer. Add and save custom chains.

**Event Monitor** - Watch contract events in real-time. Paste an address, select which events to monitor, and see them stream in as they happen. Runs in the background while you use other tools, with a persistent toast indicator.

**Safe TX Builder** - Build transaction batches for Gnosis Safe. Select contracts and functions, fill params, and export the exact JSON payload the Safe web app expects. Supports batching multiple calls.

**Vanity Address Miner** - Generate Ethereum addresses matching a custom pattern (starts with, ends with, or contains). Runs in a Web Worker in the background. Shows estimated difficulty, live speed, and blurred private keys. Continues mining while you use other tools.

## Features

- **Dark/light theme** toggle (default dark, persists across sessions)
- **Live gas ticker** in the footer showing current mainnet gas price
- **Background tasks** with persistent toast notifications for Event Monitor and Vanity Miner
- **Command palette** (press `/` or `Ctrl+K`) with fuzzy search, number keys 1-9 for quick selection, and auto-detection of pasted data
- **Keyboard navigation** for the sidebar (Left arrow to enter, Up/Down to browse, Right/Enter to select)
- **URL routing** with query param support for deep links
- **Session persistence** for files, artifacts, deployed contracts, builder state, and custom chains
- **Mobile responsive** with icon-only nav bar on small screens
- **Per-tool SEO** with unique page titles and meta descriptions

## Stack

- **Vite** for bundling
- **viem** for ABI encoding/decoding, hashing, and wallet interaction
- **CodeMirror 6** for the editor with Solidity syntax highlighting and inline linting
- **@ethereumjs/evm** for local EVM execution
- **@solidity-parser/parser** for AST-based security analysis
- **RainbowKit + wagmi** for wallet connection and chain management
- **solc** loaded from the official CDN in a Web Worker
- **ethers.js** baked into dApp Builder exports and Vanity Miner worker

Each tool is lazy-loaded. Opening any tool does not load code for the others.

## Development

```bash
npm install
npm run dev
```

The Vercel serverless functions in `api/` proxy Etherscan/Blockscout and RPC calls.

## Built by

[@_absnt](https://x.com/_absnt)

## License

MIT
