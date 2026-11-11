# Security Policy

## Supported versions

IWAE is currently in active alpha development. Security fixes are applied to the latest revision on the default branch; older builds are not maintained separately.

## Reporting a vulnerability

Report it privately through GitHub: [Report a vulnerability](https://github.com/radic2682/IWAE/security/advisories/new) (Security tab → Report a vulnerability). Please do not open a public issue. Include the affected version, reproduction steps, impact, and the smallest possible sanitized example.

Do not attach private documents, vault contents, API keys, updater signing keys, or personal information. If private reporting is unavailable, open a minimal public issue requesting a secure contact channel without disclosing exploit details.

## Security model

- Documents and vault metadata remain local unless the user explicitly configures a network-backed feature.
- External translation API keys are kept in the operating system's credential store (Windows Credential Manager, macOS Keychain). They must not be written to the Vault, project files, or browser storage.
- The optional local MCP server is off by default, listens on `127.0.0.1` only, requires a random bearer token, and rejects requests that carry a browser `Origin` header. The token is stored in the app data folder of the current user, not in the Vault. It can be regenerated in Settings.
- The web view runs under a restrictive Content Security Policy (no remote scripts, no inline scripts, no frames). Rendered Markdown and memo HTML are sanitized, and links open in the system browser only after a confirmation and only for `http`, `https` and `mailto`.
- Updates are verified with a minisign signature before they are installed.
- Release signing keys and updater configuration are supplied only through release infrastructure.
- Imported PDF and Markdown content is untrusted and must not be executed as instructions or code.
