# Third-Party Notices

IWAE includes open-source software distributed under permissive and weak
copyleft licenses. These components do not require an online account, runtime
backlink, or separate service integration. Their copyright and license notices
must remain available with distributed copies of IWAE.

## Tauri and Tauri plugins

Components: `tauri`, `tauri-build`, `@tauri-apps/api`, `@tauri-apps/cli`,
`tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-log`,
`tauri-plugin-persisted-scope`, `tauri-plugin-updater`, and
`tauri-plugin-window-state`.

Upstream: https://github.com/tauri-apps/tauri

License: MIT OR Apache-2.0.

## React and React DOM

Upstream: https://github.com/facebook/react

License: MIT.

## Phosphor Icons

Upstream: https://github.com/phosphor-icons/react

License: MIT.

## React Flow (`@xyflow/react`, `@xyflow/system`)

Upstream: https://github.com/xyflow/xyflow

MIT License

Copyright (c) 2019-2025 webkid GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## PaddleOCR (`@paddleocr/paddleocr-js`, PP-OCR model assets)

Upstream: https://github.com/PaddlePaddle/PaddleOCR

Apache License 2.0. IWAE bundles the PP-OCRv5 mobile text detection model and
the PP-OCRv6 tiny recognition model used by the SDK during initialization.
Only text detection inference is used for PDF excerpt sizing.

## ONNX Runtime Web

Upstream: https://github.com/microsoft/onnxruntime

MIT License. IWAE bundles the WebAssembly runtime needed for local OCR inference.

## PDFium and `pdfium-render`

Upstream binaries: https://github.com/bblanchon/pdfium-binaries

Rust binding: https://github.com/ajrcarey/pdfium-render

License: PDFium is distributed under the BSD-3-Clause license and includes
third-party Chromium components with their own notices. `pdfium-render` is
licensed under MIT OR Apache-2.0. IWAE bundles a Windows PDFium runtime DLL and
uses the Rust binding to render local documents.

## Other Rust and JavaScript dependencies

The application also contains transitive dependencies under MIT, Apache-2.0,
BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unicode-3.0, and MPL-2.0 terms. MPL-2.0
applies at file level to the covered dependency files; IWAE does not modify or
relicense those upstream files.

## TranslateGemma models (downloaded separately)

IWAE does not bundle or redistribute TranslateGemma model weights. When a user
chooses to download a TranslateGemma model, Ollama obtains that model separately
from IWAE.

Model information: https://ai.google.dev/gemma/docs/translate-gemma

Gemma Terms of Use: https://ai.google.dev/gemma/terms

TranslateGemma is provided under the applicable Gemma terms. Review those terms
before downloading or using a model, especially before redistribution or
commercial use.

## Twemoji (twemoji-colr-font 15.0.3)

IWAE bundles a COLR build of the Twemoji emoji font to draw item emoji.

Emoji graphics © Twitter, Inc. and other contributors, licensed under CC-BY 4.0:
https://creativecommons.org/licenses/by/4.0/

The font build by Tilman Vatteroth (https://github.com/mrdrogdrog/twemoji-color-font)
is licensed under the SIL Open Font License 1.1.

## Emojibase data 17.0.0

Korean emoji names and search tags come from Emojibase (https://emojibase.dev),
MIT License, © Miles Johnson. A trimmed copy is generated into
`src/core/emojiData.json` by `scripts/build-emoji-data.mjs`.

## SQLite (via rusqlite 0.40, bundled)

The search index uses SQLite, which is in the public domain (https://sqlite.org/copyright.html).
rusqlite is licensed under the MIT License.

## tiny_http 0.12

The local MCP server uses tiny_http, licensed under the Apache License 2.0 or the MIT License.

## getrandom 0.4

Access tokens are generated with getrandom, licensed under the Apache License 2.0 or the MIT License.

