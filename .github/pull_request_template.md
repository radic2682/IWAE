## Summary

- What changed?
- Why is this change needed?
- Related issue or discussion (for example `Fixes #123`):

## Screenshots or recordings

For interface changes, show before and after in the light and dark themes. Remove private document content first.

## Validation

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run verify:ocr-dist`
- [ ] `npm run test:e2e` when the interface changes
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` when native code changes
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `cargo clippy` when native code changes

## Risk review

- [ ] Local-first behavior and vault data remain intact.
- [ ] No credentials, private documents, generated updater config, or signing material are included.
- [ ] No personal paths, internal hostnames, employer or customer names, or private email addresses are included (`npm run release:scan` is clean).
- [ ] Storage, migration, and interaction changes include regression coverage where practical.
- [ ] New user-visible text is added in both Korean and English, and the i18n completeness test passes.
- [ ] Imported document content (PDF text, Markdown, file names) is treated as untrusted: no `innerHTML` without sanitizing, no paths used without checking they stay inside the Vault.
- [ ] Public documentation (README, FAQ, release notes) is updated when behavior or commands change.
- [ ] A new dependency, font, model, or bundled asset is listed in `THIRD_PARTY_NOTICES.md` with its license.
