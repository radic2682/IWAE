# Contributing to IWAE

Thank you for contributing to IWAE. The project is in active alpha development, so focused changes with explicit validation are preferred.

## Development setup

1. Install Node.js 22, the Rust stable toolchain, and the Tauri 2 platform prerequisites.
2. Run `npm ci`.
3. Start the browser preview with `npm run dev` or the desktop application with `npm run tauri dev`.

## Before opening a pull request

Run the checks relevant to your change:

```bash
npm test
npm run build
npm run verify:ocr-dist
npm run test:release-scripts
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Change guidelines

- Keep changes scoped and consistent with the existing architecture.
- Preserve local-first storage, stable source links, and recovery behavior.
- Add regression tests for bug fixes and storage or migration changes.
- Do not commit private documents, API keys, signing material, or generated updater configuration.
- Treat imported document content as untrusted data.
- Update public documentation when behavior or commands change.

## Reporting security issues

Do not disclose vulnerabilities or sensitive document data in a public issue. Follow [SECURITY.md](SECURITY.md) instead.
