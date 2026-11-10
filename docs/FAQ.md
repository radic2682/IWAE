# IWAE FAQ

[한국어](FAQ.ko.md)

Short answers to the questions people ask first. For anything not covered here, ask in [Discussions](https://github.com/radic2682/IWAE/discussions) or open an [issue](https://github.com/radic2682/IWAE/issues/new/choose).

## The basics

**What is IWAE?**
A desktop PDF reader (Windows and macOS) where a highlight and the memo you write for it stay linked. Click the memo later and the PDF jumps back to that exact sentence. Markdown files work the same way, and one note can collect memos from many documents.

**Is it free? What is the license?**
Yes. IWAE is open source under the MIT license (see [LICENSE](../LICENSE)). Bundled third-party components and fonts are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

**Which systems are supported?**
Windows 10/11 (x64) and macOS 12 or newer. Linux is not supported yet. macOS builds are produced separately from Windows builds, so a release can briefly exist for Windows only.

**Is it stable?**
It is alpha. Day-to-day reading, memos, notes and saving work well, and saving is atomic with a journal, but screens and file formats can still change between versions. Keep the automatic Vault backup on (Settings) and read the release notes before updating.

## Your files and privacy

**What is a Vault?**
Any folder you open in IWAE. Its PDFs and Markdown files appear as they are on disk. IWAE never moves or locks them. Notes are saved as `*.iwnote` files (in the `노트` folder by default), and everything else IWAE needs (highlights, bookmarks, search index, translation cache, history, trash) lives in a hidden `.iwae` folder inside the Vault.

**Does IWAE change my PDF files?**
Not when you read, highlight or write memos. Those are stored next to the file in `.iwae`. A PDF is only rewritten when you run a PDF tool that edits it (page edit, redact, compress and so on). The page editor backs up the original first, and most tools can write a copy instead.

**Can I sync a Vault with Dropbox, OneDrive or iCloud?**
Yes, it is an ordinary folder. Changes made in two windows are merged, and conflicting edits from two machines are kept side by side instead of overwritten. Avoid opening the same Vault on two machines at the very same moment.

**What leaves my computer?**
Only what you turn on yourself:

- Text you select for translation, when you chose a cloud provider (OpenAI, Anthropic, Gemini, Azure Translator, DeepL). Local translation with Ollama stays on your PC.
- The update check in release builds.
- Requests from an external AI agent, only if you enable the local MCP server in Settings. It is off by default and listens on `127.0.0.1` only.

IWAE has no account, no telemetry and no analytics. OCR runs locally.

**Where are my cloud translation API keys stored?**
In the operating system's credential store (Windows Credential Manager, macOS Keychain), not in the Vault and not in project files.

**How do I back up a Vault?**
Settings has a full-Vault backup (a zip) with an automatic schedule, and a restore into an empty folder. You can also simply copy the folder.

**I deleted something by accident.**
Deleted files go to the Vault's trash first, and earlier states of notes and annotations are kept for a while. Use undo (`Ctrl+Z`) right away, or look in the trash.

## Using it

**How do I try it without my own files?**
On first start choose **Start with an example**. It creates a sample Vault with a hands-on tutorial PDF called "IWAE User Guide".

**Can I use IWAE as my default PDF reader?**
Yes. Choose IWAE in Windows "Default apps" (the app has a shortcut to that page) or "Open With" on macOS. A PDF opened from outside the Vault can be copied into the Vault.

**A scanned PDF has no text to select or search.**
Use the OCR tool in the left bar's PDF tools to add a text layer. OCR runs locally with bundled PaddleOCR models; it is not perfect on low-quality scans.

**A PDF is password-protected.**
IWAE asks for the password when you open it. The "unlocked copy" tool can save a copy without the password.

**Very large PDFs feel slow.**
Performance work for large files is in progress (see the [roadmap](ROADMAP.md)). If a particular file is slow, please open a bug report and include the page count and file size, not the file itself.

**How does translation work?**
Select text and press translate. The result appears next to the text and never replaces the original. Pick a local model through Ollama, or a cloud provider with your own API key (Settings → Translation). Repeated translations are cached in the Vault.

**Can AI read my notes?**
IWAE has no built-in chat. If you enable the MCP server, an external agent such as Claude Code that you connect yourself can search the Vault, read pages and add memos. It cannot modify your PDF files. See the README section "Working with AI agents".

**Where are the keyboard shortcuts?**
Settings → Shortcuts & mouse, and the table in the README. `Ctrl+Shift+P` opens the command palette.

## Troubleshooting

**Windows says "Windows protected your PC" (SmartScreen) when I run the installer.**
Release installers are not code-signed yet, so SmartScreen warns about unrecognized apps. Choose "More info" then "Run anyway" only if you downloaded the installer from this repository's Releases page. Code signing is planned (see [CODE_SIGNING.md](CODE_SIGNING.md)).

**macOS says the app cannot be opened because the developer cannot be verified.**
The app is not notarized yet. Open System Settings → Privacy & Security and click **Open Anyway** once.

**The window is blank or PDFs do not render on Windows.**
IWAE needs Microsoft Edge WebView2 (preinstalled on current Windows 10/11) and the bundled `pdfium.dll` next to the executable. Reinstall with the setup `.exe`; antivirus software that quarantined `pdfium.dll` is a known cause.

**Markdown to PDF fails.**
Markdown views are rendered through Microsoft Edge or Google Chrome. Install one of them.

**PowerPoint import says PowerPoint is missing.**
`.ppt`/`.pptx` conversion uses PowerPoint installed on the same Windows PC. Convert to PDF elsewhere and drop the PDF in.

**How do I report a problem?**
Use the "Report a problem" command in the app when it is available: it gathers the version, system information and recent logs, with no document content, and you review the text before sending. Then [open a bug report](https://github.com/radic2682/IWAE/issues/new?template=bug_report.yml). Please remove private document content from anything you attach.

**I found a security problem.**
Do not open a public issue. Follow [SECURITY.md](../SECURITY.md).

## Contributing

**How can I help?**
Bug reports with reproduction steps, translations, and focused pull requests are welcome. Read [CONTRIBUTING.md](../CONTRIBUTING.md) first. For larger ideas, start a Discussion so we can agree on the approach before code is written.

**Will feature X be added?**
Check the [roadmap](ROADMAP.md). It lists what is planned and what is only an idea. IWAE stays local-first, so features that need a server or an account are unlikely.
