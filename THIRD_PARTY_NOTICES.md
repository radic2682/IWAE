# Third-Party Notices

IWAE includes open-source software distributed under permissive and weak
copyleft licenses. These components do not require an online account, runtime
backlink, or separate service integration. Their copyright and license notices
must remain available with distributed copies of IWAE.

## Tauri and Tauri plugins

Components: `tauri`, `tauri-build`, `@tauri-apps/api`, `@tauri-apps/cli`,
`tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-log`,
`tauri-plugin-opener`, `tauri-plugin-persisted-scope`, `tauri-plugin-process`,
`tauri-plugin-single-instance`, `tauri-plugin-updater`, and
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
licensed under MIT OR Apache-2.0. IWAE bundles a PDFium runtime (a DLL on
Windows, a dylib on macOS) and uses the Rust binding to render local documents.
The PDFium binary distribution contains its own LICENSE and third-party notices
(FreeType, ICU, lcms2, libjpeg-turbo, libpng, OpenJPEG, zlib, and others);
those notices apply to the bundled runtime. The installer ships them unchanged
as `pdfium-licenses.txt` next to this file. IWAE pins the PDFium release
(`chromium/8086`, 157.0.8086.0) and verifies its SHA-256 when fetching
(`scripts/fetch-pdfium.mjs`).

## Other Rust and JavaScript dependencies

The application also contains transitive dependencies under MIT, Apache-2.0,
BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unicode-3.0, MPL-2.0, BSL-1.0,
CC0-1.0, 0BSD, Unlicense, CDLA-Permissive-2.0 and Python-2.0 terms. MPL-2.0
applies at file level to the covered dependency files; IWAE does not modify or
relicense those upstream files. A review of the production dependency trees
(`cargo metadata` and `npm ls --omit=dev`) found no GPL, LGPL or AGPL
components. Direct dependencies worth naming:

- **markdown-it** (MIT) and its helpers `linkify-it`, `mdurl`, `uc.micro`,
  `punycode.js` (MIT) and `entities` (BSD-2-Clause).
- **DOMPurify** (MPL-2.0 OR Apache-2.0), used to sanitize rendered Markdown.
- **GSAP** (`gsap` 3.x), under the GreenSock "Standard no charge" license
  (https://gsap.com/standard-license). It is free to use, including commercially,
  and is not open source in the OSI sense; its terms exclude use in tools that
  let people build visual animations and compete with Webflow's. IWAE uses it
  only for its own interface animation. Re-read the license before changing how
  it is used.
- **PaddleOCR.js dependencies:** `@techstark/opencv-js` (Apache-2.0, OpenCV),
  `clipper-lib` (Boost Software License 1.0), `protobufjs` and its `@protobufjs/*`
  packages (BSD-3-Clause), `long` and `flatbuffers` (Apache-2.0), and
  `js-yaml` (MIT) with `argparse` (Python-2.0).
- **d3 modules, zustand, classcat, use-sync-external-store** (ISC or MIT),
  pulled in by React Flow.
- **Rust:** `reqwest`, `rustls`, `ring`, `webpki-roots` (CDLA-Permissive-2.0),
  `keyring`, `zip`, `image`, `encoding_rs` (Apache-2.0 OR MIT, with BSD-3-Clause
  parts), `serde`, `sha2`, `getrandom`, `tiny_http`, `rusqlite` and the Tauri
  dependency tree. `ring` is licensed under Apache-2.0 and ISC terms with
  historical OpenSSL-derived portions.

## TranslateGemma models (downloaded separately)

IWAE does not bundle or redistribute TranslateGemma model weights. When a user
chooses to download a TranslateGemma model, Ollama obtains that model separately
from IWAE.

Model information: https://ai.google.dev/gemma/docs/translate-gemma

Gemma Terms of Use: https://ai.google.dev/gemma/terms

TranslateGemma is provided under the applicable Gemma terms. Review those terms
before downloading or using a model, especially before redistribution or
commercial use.

## Pretendard (interface font)

IWAE bundles the variable build of Pretendard (`src/ui/pretendard/`) as its
interface font.

Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard),
with Reserved Font Name Pretendard. Licensed under the SIL Open Font License
1.1, which is reproduced at the end of this file. Pretendard is itself derived
from other OFL-licensed fonts (see the upstream project for the list).

## Noto Sans KR and Cascadia Mono (tutorial PDFs)

The tutorial PDFs in `public/sample-vault/` embed subsets of Noto Sans KR
(Copyright Adobe, licensed under the SIL Open Font License 1.1) and Cascadia
Mono (Copyright Microsoft Corporation, licensed under the SIL Open Font License
1.1). They are embedded in the PDFs only; the fonts are not installed or
distributed on their own. The PDFs may also contain a few symbol glyphs drawn
from a system font that was present when the PDFs were generated.

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

## Appendix: SIL Open Font License 1.1

Applies to Pretendard, Noto Sans KR, Cascadia Mono and the Twemoji font build
listed above. Each font keeps its own copyright notice and Reserved Font Name.


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
