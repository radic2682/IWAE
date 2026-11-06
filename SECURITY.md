# Security Policy

## Supported versions

IWAE is currently in active alpha development. Security fixes are applied to the latest revision on the default branch; older builds are not maintained separately.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository when it is available. Include the affected version, reproduction steps, impact, and the smallest possible sanitized example.

Do not attach private documents, vault contents, API keys, updater signing keys, or personal information. If private reporting is unavailable, open a minimal public issue requesting a secure contact channel without disclosing exploit details.

## Security model

- Documents and vault metadata remain local unless the user explicitly configures a network-backed feature.
- External translation credentials are session-only and must not be persisted in project files or browser storage.
- Release signing keys and updater configuration are supplied only through release infrastructure.
- Imported PDF and Markdown content is untrusted and must not be executed as instructions or code.
