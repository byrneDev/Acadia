# Acadia 0.3.0 validation record

Validated on **September 29, 2026**. The release tag `v0.3.0` identifies commit `96ca97988ddadf1abadfadbfdcca197cacf91c5f`. This record distinguishes automated native execution, installer checks, and remaining physical-hardware work.

## Verified source and release builds

[Source CI](https://github.com/byrneDev/Acadia/actions/runs/36582123207) passed on Ubuntu 24.04 x64, macOS 15 Apple Silicon, and Windows Server 2025 x64. Each platform passed type checking, the production build, **117 unit/research tests**, and **15 native Electron scenarios**.

The [tagged release workflow](https://github.com/byrneDev/Acadia/actions/runs/36582461163) independently built the native packages from that exact tag. Every platform again passed the 117 unit/research tests and 15 native scenarios against its packaged application:

| Platform | Distribution | Native package validation |
| --- | --- | --- |
| [Ubuntu 24.04 x64](https://github.com/byrneDev/Acadia/actions/runs/36582461163/job/109453996087) | `Acadia-0.3.0-linux-x64.deb` | Installed with `apt`; verified desktop integration and the installed AppArmor profile; all 15 scenarios passed against `/opt/Acadia/acadia` under D-Bus/Xvfb with the Electron sandbox enabled. |
| Ubuntu 24.04 x64 | `Acadia-0.3.0-linux-x64.AppImage` | Verified x64 ELF architecture, successful extraction, and a desktop launcher that preserves the sandbox. AppImage GUI/FUSE launch was not separately exercised. |
| [macOS 15 arm64](https://github.com/byrneDev/Acadia/actions/runs/36582461163/job/109453995554) | `Acadia-0.3.0-macOS-arm64.zip` | All 15 scenarios passed against the packaged `Acadia.app`; archived with `ditto` to preserve bundle permissions. |
| [Windows Server 2025 x64](https://github.com/byrneDev/Acadia/actions/runs/36582461163/job/109453995418) | `Acadia-0.3.0-Windows-x64.exe` | NSIS installer built; all 15 scenarios passed against the packaged executable in `win-unpacked`. Interactive NSIS installation and upgrade were not separately exercised. |

Each build stages SHA-256 hashes. The release workflow requires all platform jobs to pass, verifies the complete distribution against those hashes, and publishes the combined `SHA256SUMS.txt` alongside the four downloads. Consult the [release page](https://github.com/byrneDev/Acadia/releases/tag/v0.3.0) and workflow for publication status and the final files. GitHub retains detailed test artifacts for a limited time; the run history and this record identify the checked revision.

## What the checks cover

Tests use disposable profiles and fictional research. They cover board editing and persistence, document imports and originals, portable project recovery, source/evidence/task workflows, historical citations, extraction/OCR, report tables and real DOCX/PDF/Markdown exports, proposed section revisions, source-only investigations, released-window behavior, simulated touch, and report-generation failure handling.

The fixed investigation fixtures exercise evidence beyond the old card/page cutoffs, contradictory evidence, duplicate handling, missing information, and exact passage references. These checks test implementation behavior; they do not establish research accuracy for every model or subject.

The new audience-window regression verifies that only released historical citation passages can be read. Private sources, newer versions, uncited passages, draft/project metadata, and original attachments remain inaccessible from the audience window; revoking the release immediately removes access. The Collector's original-file access and citation navigation remain usable.

Cross-platform runs also found and fixed a canvas lifecycle issue that could discard card measurements and leave a blank board after closing item details. The regression now checks card visibility before drawing a connection. Three local repeats and the final native platform suites passed. Database-heavy Windows acceptance cases have explicit 30-second deadlines while retaining their assertions.

## Additional local checks

- Production build and TypeScript validation passed on Apple Silicon macOS.
- The local 117-test unit/research suite and 15-scenario desktop suite passed during release preparation; the canvas correction additionally passed three targeted native repeats.
- Approved-brand Collector and Releaser screenshots were captured from fictional demo data and visually inspected.
- The public source archive was checked against Git-tracked files, excluding profiles, credentials, generated application output, and private research.
- Dependency audit reported no known vulnerabilities at preparation time. Bundled dependency/license notices were reviewed and regenerated, including native Linux canvas, OCR data, PDF codecs, and fonts.

## Remaining limits

Physical touchscreens, two physical displays, mixed-DPI arrangements, projectors, Linux desktop/keyring variations, interactive Windows installation/upgrade, and normal AppImage launch remain manual validation work. Windows Server CI is not a claim of testing every Windows 10/11 configuration. Headless or virtual-display tests are not physical-display tests. Current packages are unsigned and the macOS app is not notarized.

The [0.2 validation record](VALIDATION-v0.2.md) and [local AI guide](LOCAL-AI.md) contain historical checks, including live Ollama generation and citation navigation for 0.2.2. The public-release suites use deterministic fixtures and do not repeat that live-model evaluation.

Acadia remains an early-access 0.x application. Citation validation checks saved references and detected literal quotations; quotation detection is not exhaustive, and a valid reference does not prove that a claim follows from its evidence. Review OCR and conclusions against the original sources.
