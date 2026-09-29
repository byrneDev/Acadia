# Acadia 0.3.0 validation record

This record distinguishes completed local checks from pending release-platform checks. Initial results were recorded on **September 29, 2026**, during preparation of the public 0.3.0 release. Consult the tagged release and its workflow results for the exact published revision and assets.

The audience-window authorization fix also passed a dedicated native regression covering historical citation navigation, blocked private sources and newer versions, private metadata, attachment access, and immediate access revocation.

## Completed locally

The release-preparation source was checked on **Apple Silicon macOS**:

- TypeScript validation and the production Electron build passed.
- **117 unit/integration tests passed**, covering existing board/storage behavior and research validation, extraction, privacy, citation handling, and report workflows.
- **15 native Electron scenarios passed** against the locally built application, using disposable profiles rather than the researcher's live workspace.
- Fresh Collector and Releaser screenshots were captured from fictional demo data with the approved branding and visually inspected for the public documentation.

The native scenarios exercise board editing and persistence, document imports and originals, portable project recovery, source/evidence/task workflows, historical citations, extraction/OCR, report tables and real exports, proposed section revisions, source-only investigations, released-window behavior, and clear report-generation failure handling. These checks exercise the current implementation; they do not establish research accuracy for every model or subject.

## Release-platform checks still pending in this initial record

The configured **CI** and **Release** workflows target Ubuntu 24.04 x64, Apple Silicon macOS, and Windows x64. At the time of this initial record, the new three-platform GitHub runs had not completed. No native Ubuntu or Windows success is claimed here.

Before recording a release package as validated, add the workflow/run URL, tested source revision, runner/operating system, architecture, package filename, and the checks that passed. Distinguish a packaged executable test from a `.deb` installation, an AppImage launch, or an NSIS installation. Record failed or skipped checks and any workaround instead of treating an artifact upload as runtime validation.

## Earlier evidence and remaining limits

The [0.2 validation record](VALIDATION-v0.2.md) includes packaged macOS, OCR, long-document, export-layout, and migration/recovery checks from that release. The [local AI guide](LOCAL-AI.md) records a live Ollama generation and citation-navigation check performed for 0.2.2. Those results are historical evidence, not a replacement for checking new release artifacts.

Physical two-monitor arrangements, physical touchscreens, mixed-DPI displays, distribution-specific Linux desktop behavior, and all file/codec combinations are not established by the automated suite. Headless or virtual-display tests are not physical-display tests. Current packages are unsigned and the macOS app is not notarized.

Acadia remains an early-access 0.x application. Citation validation verifies saved references and checks some literal quotations; automatic quotation detection is not exhaustive and it does not prove that a claim follows from its evidence. Test conclusions and OCR output against the source material before relying on a report.
