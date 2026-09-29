<p align="center">
  <img src="resources/branding/acadia-logo.png" width="220" alt="Acadia" />
</p>

<h1 align="center">Acadia</h1>
<p align="center"><strong>Collect evidence. Connect ideas. Release understanding.</strong></p>
<p align="center">
  <a href="https://github.com/byrneDev/Acadia/releases">Download</a> ·
  <a href="docs/QUICK-START.md">Quick start</a> ·
  <a href="docs/LOCAL-AI.md">Local AI</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="SUPPORT.md">Get help</a>
</p>

[![CI](https://github.com/byrneDev/Acadia/actions/workflows/ci.yml/badge.svg)](https://github.com/byrneDev/Acadia/actions/workflows/ci.yml)
[![Release](https://github.com/byrneDev/Acadia/actions/workflows/release.yml/badge.svg)](https://github.com/byrneDev/Acadia/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Acadia is a desktop research workspace for turning a collection of documents, links, and ideas into an argument you can inspect. Arrange evidence on a large canvas, record what supports or contradicts a claim, identify the missing information, and develop a report whose citations lead back to saved source passages.

**The Collector** is your working space. **The Releaser** is where findings become editable reports and explicitly released presentations. A separate display can show a finished revision while you continue investigating privately.

Acadia is an **early-access 0.x application** for one researcher. It runs locally without an account. AI is optional: the offline engine organizes evidence, while a separately configured local or cloud model can draft analysis.

## Download and start

Get the package for your computer from [GitHub Releases](https://github.com/byrneDev/Acadia/releases). Each release records its checksums and validation results; a packaged target is not automatically a natively tested platform.

| Platform             | Distribution                               | Getting started                                        |
| -------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Ubuntu 24.04, x64    | `.deb` package or `.AppImage`              | Follow the [Linux guide](docs/LINUX.md).               |
| macOS, Apple Silicon | ZIP containing `Acadia.app`                | Extract the app and move it to Applications.           |
| Windows, x64         | NSIS installer; ZIP handoff where provided | Extract the ZIP if applicable, then run the installer. |

Current builds are unsigned; the macOS app is not notarized. Read the release notes before installing. Intel Mac, Linux ARM, and other Linux distributions are not release targets for 0.3.0. See [Support](SUPPORT.md) for platform and troubleshooting expectations.

Start with the included [fictional library-hours investigation](docs/samples/Library-hours-sample.acadia), or create a project and enter the question you want to investigate. No API key is needed to collect, search, organize, edit, or export research.

## Two spaces, one investigation

### Collector — follow the evidence

- **Board:** arrange notes, questions, hypotheses, files, and links; draw labeled relationships; organize named areas and save useful views.
- **Sources:** read searchable PDF, Word, text, and captured web passages with page or paragraph locations, acquisition dates, and source versions. Use local English OCR for scanned PDFs and images.
- **Evidence:** compare supporting passages, contradictions, alternative explanations, and researcher assessments without treating a drawn connection as proof.
- **Tasks:** connect follow-up work to a question or gap, with completion criteria, status, optional dates, and resulting sources.
- **Ask & analyze:** question the included collection, follow passage citations, and inspect recorded analysis runs. AI connection suggestions require acceptance.
- **Discover:** review and approve a bounded external search plan, then decide which results enter the source library.

### Releaser — make the reasoning reviewable

Draft a decision brief, hypothesis, research plan, whitepaper, gap analysis, or needs analysis. Edit headings, lists, tables, and numbered citations. Request a proposed revision to selected text and review it before applying it.

Save report revisions and choose exactly which one to release. Working drafts stay private to the main window; the second display receives the selected released snapshot. Export an editable **DOCX**, a print-oriented **PDF**, or **Markdown**, including bibliography and source locations.

### Evidence that survives revision

Source versions and report snapshots preserve the evidence behind older findings. Updating a document does not silently redirect its previous citations. The app flags changed sources for reconsideration, distinguishes partial or failed extraction from complete coverage, and avoids counting identical files as independent corroboration.

SQLite full-text search covers the indexed collection. A model still receives a finite selection of passages, with coverage limits recorded in the result. A verified citation establishes saved source provenance; it does not establish that a conclusion is correct. Automatic quotation detection is not exhaustive, so quoted prose still needs human review.

## A look inside

![Collector canvas with connected research cards](docs/screenshots/collector.png)

_Collector: arrange evidence and follow the relationships between ideas._

![Releaser report editor with saved source citations](docs/screenshots/releaser.png)

_Releaser: review a cited draft, save revisions, and choose what appears on the output display._

## Local data and optional connections

| Action                                                  | What leaves the computer                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Offline research, extraction, OCR, editing, and exports | No document content is sent to an analysis service.                                             |
| Local model analysis                                    | The question, instructions, and selected passages go to your configured loopback model service. |
| Cloud model analysis                                    | The same research inputs go to the provider explicitly selected for that project.               |
| Capture a website                                       | Acadia requests the URL you chose and saves a readable snapshot.                                |
| Approved Brave discovery                                | The displayed queries go to Brave Search; a candidate page is captured only when accepted.      |

Local projects never silently fall back to cloud analysis. Models are installed and operated separately from Acadia. Start with [Local AI](docs/LOCAL-AI.md), or configure a compatible chat-completions endpoint in research engine settings.

Keys entered in the interface are submitted to the main process; saved keys are not returned in renderer settings or included in project exports. Analysis keys use operating-system secure storage when a usable backend is available and otherwise remain session-only. Saving a Brave Search key requires usable secure storage; it is refused when that storage is unavailable. Research files and the SQLite database are ordinary local data, **not an encrypted vault**. A portable `.acadia` archive contains research content and originals: share it intentionally and keep backups.

Brave Search is optional and independent of the analysis provider. Plans permit at most five queries and twenty candidates, with additional searches requiring another approval. Acadia does not conduct autonomous background investigations.

## Run from source

Install **Node.js 24.x**, npm, and Git. Electron supplies its own runtime for the packaged app; a database server is not required.

```sh
git clone https://github.com/byrneDev/Acadia.git
cd Acadia
npm ci
npm run dev
```

Use the committed lockfile with `npm ci`. On Linux, follow the [native dependency and display requirements](docs/LINUX.md). Run Electron desktop checks in a graphical session; browser-only tests do not verify the native application.

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The development browser preview, `npm run dev:web`, supports a limited board/editor preview. It reports desktop-only operations as unavailable; it does not provide the SQLite research library, OCR, model connections, or native document exports.

Packaging commands and release verification are in [Releasing](docs/RELEASING.md). The [architecture guide](docs/ARCHITECTURE.md) explains storage, extraction, model boundaries, and the two-window design. [Repository automation](docs/AUTOMATION.md) describes CI and release publishing gates.

## Quality and current boundaries

Automated checks cover document extraction beyond the old page/card cutoffs, contradictory evidence, duplicate handling, source version round trips, privacy enforcement, approved search plans, citation validation, report revisions, real document exports, and separate-window release behavior. Native checks use disposable profiles. See the [0.3 validation record](docs/VALIDATION-v0.3.md) for release-preparation results, [0.2 validation](docs/VALIDATION-v0.2.md) for earlier package checks, and [local-model validation](docs/LOCAL-AI.md) for the live model example. Consult each release for the results of its exact build.

Printed English OCR needs review against the original. Login-dependent pages, arbitrary media codecs, very large investigations, and every possible document layout are not guaranteed. Files are bounded to 250 MB each and portable archives to approximately 1 GB. Physical touchscreens, mixed-DPI monitors, and presentation hardware need testing on your setup.

Remote collaboration, audio/video transcription, quantitative dataset analysis, cloud synchronization, automatic updates, and external publishing are outside the current release. See the [roadmap](docs/ROADMAP.md) for priorities rather than promises.

## Participate

Useful contributions include reproducible bugs, accessibility findings, platform test results, careful extraction fixtures, and improvements that preserve evidence provenance. Start with [Contributing](CONTRIBUTING.md), [Support](SUPPORT.md), and the [Code of conduct](CODE_OF_CONDUCT.md).

Report vulnerabilities privately through the process in [Security](SECURITY.md). Acadia is released under the [MIT License](LICENSE). Bundled dependencies retain their own licenses in the [third-party notices](docs/THIRD-PARTY-NOTICES.txt). The [changelog](CHANGELOG.md) records release history.
