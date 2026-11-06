# Third-party software

This source distribution retains the original licenses and notices for third-party components. The Apache 2.0 license for ModyCrew does not replace those licenses.

## Agentic Inbox

Project: Agentic Inbox
Repository: https://github.com/cloudflare/agentic-inbox
License: Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
Copyright: Copyright (c) 2026 Cloudflare, Inc.

ModyCrew includes code derived from Agentic Inbox in the following files:

- `packages/domain/src/mail-threading.ts` (RFC threading, References chain,
  threading headers; subject fallback rewritten with exact participant matching)
- `packages/domain/src/mail-quote.ts` (HTML escape/strip utilities, quoted
  reply block; line-break preservation and Korean locale added)
- `packages/domain/src/mail-draft-guard.ts` (prompt-injection scanner and
  draft verifier prompts/logic; model calls made provider-injectable and the
  error path changed to keep the original draft body)

Each derived file carries the original copyright notice and a summary of
modifications in its header, as required by the Apache License, Version 2.0.
A full copy of the Apache 2.0 license text is kept at
`licenses/agentic-inbox-LICENSE` in this repository. Distributions of ModyCrew
that include these files must retain this notice and include that license copy
(or provide the full license text at the URL above).

ModyCrew is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc.
or the Agentic Inbox project.

## Munder Difflin

Project: Munder Difflin
Repository: https://github.com/chaitanyagiri/munder-difflin
Version referenced: 0.4.5
License: MIT License
Copyright: Copyright (c) 2026 Chaitanya Giri

ModyCrew adapts the following source from Munder Difflin. The upstream copyright and MIT permission notice are retained below.

Adapted files:

- `packages/domain/src/hive/task-ledger.ts` — the non-destructive ledger merge
  rules (`mergeTaskLedger`, `patchTaskInLedger`) are ported from
  `src/shared/taskLedger.ts`, translated to ModyCrew types and Korean comments.
- `packages/domain/src/hive/delegated-agent-loop.ts` — the delegated-worker loop
  follows the orchestration structure of `src/main/hive.ts` (observe, act,
  re-plan, ask the human when blocked). The code is written for ModyCrew's own
  `TOOL=` text protocol rather than copied.

ModyCrew does not adopt Munder Difflin's user interface, visual design,
component library, or developer-facing surfaces (terminal, code editor, git
graph, CLI provider selection). Product screens are built with ModyCrew's own
design language.

MIT License

Copyright (c) 2026 Chaitanya Giri

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

ModyCrew is not affiliated with, endorsed by, or sponsored by Chaitanya Giri or
the Munder Difflin project.

## PptxGenJS document production renderer

Project: PptxGenJS
Version: 4.0.1
Repository: https://github.com/gitbrent/PptxGenJS
License: MIT

ModyCrew bundles the unmodified upstream ESM build at apps/modycrew-desktop/src/main/document-production/vendor/pptxgenjs-4.0.1.mjs. Source version and SHA-256 are recorded in PROVENANCE.json. Its only ESM import is JSZip; unused npm image parsers are not bundled with this snapshot. Text and table creation is supported. The upstream source also contains the Microsoft TypeScript helper copyright notice, which is retained verbatim.

The MIT License (MIT)

Copyright (c) 2015-2022 Brent Ely

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

## PDF.js

Project: PDF.js — https://github.com/mozilla/pdf.js
License: Apache License 2.0 for PDF.js; included fonts, CMaps, color profiles and WebAssembly libraries retain their individual licenses.

The bundled viewer archive at apps/modycrew-desktop/src/main/feature-modules/assets/pdfjs-bundled-6.4.299.zip retains the upstream LICENSE and the license files under web/cmaps, web/iccs, web/standard_fonts and web/wasm. Keep all these notices when extracting or redistributing the viewer.

## npm dependencies

Package manifests and lockfiles identify the dependencies used by the source edition. Dependencies installed with npm retain the licenses distributed in their own packages. A node_modules directory is not part of this repository.

## Optional tools and downloaded modules

Provider CLIs, Python, Node.js, Git, speech models and optional analysis tools are not bundled as executable runtimes in this source repository. Runtime manifests and download catalogs identify their upstream locations, versions, checksums and licensing metadata. Their own license and redistribution requirements apply when they are installed or packaged.

## Brand assets

Mody and ModyCrew names and logos are covered by BRANDING.md. References to third-party projects do not imply affiliation, sponsorship or endorsement.
