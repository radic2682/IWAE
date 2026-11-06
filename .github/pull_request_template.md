## Summary

- What changed?
- Why is this change needed?

## Validation

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run verify:ocr-dist`
- [ ] `npm run test:e2e` when the interface changes
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` when native code changes

## Risk review

- [ ] Local-first behavior and vault data remain intact.
- [ ] No credentials, private documents, generated updater config, or signing material are included.
- [ ] Storage, migration, and interaction changes include regression coverage where practical.
