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

## Project layout

- `src/app/`: application shell and generic UI (`App.tsx`, top bar, command palette, popups, preferences). Feature folders:
  - `workspace/`: panes, split layout, screens, tabs and tab dragging/docking, sessions, color channels, floating panes, prefix keys, link layer.
  - `documents/`: PDF and Markdown viewing UI (toolbars, search, tools dialogs, printing, highlights, excerpts).
  - `notes/`: memo notes, the note canvas, blocks and their hooks.
  - `sidebar/`: library, side panels, search, versions, bibliography, sources.
  - `vault/`: Vault open/recovery/backup, sample vault, import and export actions.
  - `settings/`: settings modal and panels, themes, theme files.
  - `translation/`: translator panel and translation state.
  - `onboarding/`: tours, what's new, release notes, about, updater, problem report.
  - `mcp/`: the in-app side of the local MCP server (tools, adapters, activity store, AI pill).
- `src/core/`: pure logic and data models (no React).
- `src/pdf/`: PDF rendering, annotation layers and the memo editor.
- `src/bridge/`: calls into the Tauri backend.
- `src/ui/`: CSS and shared UI primitives.
- `src/i18n/`: Korean and English strings.
- `src-tauri/`: Rust backend. `scripts/`: build and release scripts. `e2e/`: Playwright tests. `docs/`: documentation and design notes.

Tests sit next to the file they cover (`X.test.tsx` beside `X.tsx`).

## Change guidelines

- Keep changes scoped and consistent with the existing architecture.
- Preserve local-first storage, stable source links, and recovery behavior.
- Add regression tests for bug fixes and storage or migration changes.
- Do not commit private documents, API keys, signing material, or generated updater configuration.
- Treat imported document content as untrusted data.
- Update public documentation when behavior or commands change.

## Reporting security issues

Do not disclose vulnerabilities or sensitive document data in a public issue. Follow [SECURITY.md](SECURITY.md) instead.
