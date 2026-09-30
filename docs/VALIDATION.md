# Acadia 0.1.0 — validation record

This is the historical 0.1.0 record. See [v0.5 validation](VALIDATION-v0.5.md) for the current release.

Tested on Apple Silicon macOS on September 29, 2026.

## Passed

- TypeScript check and production Electron build.
- 51 unit tests: project validation, citation mapping, five offline outputs, imported-text inclusion, provider request formats and errors, bounded input/output, local storage, path safety, PDF extraction, and export escaping.
- Four native Electron scenarios: card creation/edit/review, directional connections, movement and persistence after restart; output generation and citations, second-window synchronization and read-only enforcement; real PDF/text import, Markdown/PDF export, portable project round trip and automatic recovery; simulated touch drag/pan/pinch and a 960 × 700 layout check.
- A packaged Apple Silicon application test covering PDF extraction, Markdown and PDF exports, source preservation, portable project reopening, and recovery.
- No unhandled renderer errors in those native scenarios.
- Apple Silicon app and Windows x64 NSIS installer created. The Windows package includes the x64 native PDF dependency.
- npm audit reported no known vulnerabilities at build time.

## Not yet verified

- Native Windows installation and runtime behavior, or Intel Mac support.
- Physical Smartboard/touchscreen operation, projector arrangements, mixed-DPI monitors, and a real second physical display. Separate native windows and synchronization were exercised on this Mac.
- Live AI model/service responses. Provider request/response behavior was tested with mocked endpoints; no external research data or paid requests were sent.
- Very large research boards and all possible file/codec combinations.

These are development packages without a trusted publisher signature or macOS notarization. The Mac executable has an ad-hoc signature. Configure platform signing before broad distribution.
