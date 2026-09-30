# Getting help with Acadia

Start with the [Quick start](docs/QUICK-START.md), [Local AI guide](docs/LOCAL-AI.md), and [Linux guide](docs/LINUX.md). Check [release notes](https://github.com/byrneDev/Acadia/releases) for the exact version you installed.

For a reproducible bug or a feature request, use [GitHub Issues](https://github.com/byrneDev/Acadia/issues). Search existing issues first. This is an early-access project with community support; there is no guaranteed response time or enterprise support service.

## Include enough information to reproduce the problem

- Acadia version and package type, operating system/version, and CPU architecture.
- What you expected, what happened, and the shortest sequence that reproduces it.
- The visible error text and, where helpful, a cropped screenshot with private information removed.
- For document problems: file type, approximate size/page count, whether it contains scans, and extraction status. Supply a minimal synthetic file if possible.
- For model problems: provider type, model name, local/cloud mode, and whether the model service is running. Never include API keys or confidential prompts/passages.
- For display problems: monitor arrangement, resolution, scaling, input device, and whether the issue occurs with a mouse, keyboard, or physical touch.

An entire workspace profile or portable project is usually unnecessary and may expose original documents, source snapshots, and analysis history. Share a sanitized reproduction instead. Report security vulnerabilities using [Security](SECURITY.md), not a public issue.

## Common problems

| Symptom                                                       | First checks                                                                                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The offline report is an outline rather than an AI conclusion | Offline mode organizes evidence. Configure an explicit local or cloud model for AI drafting.                                                                                           |
| A local model cannot connect                                  | Confirm the model service is running, the model name matches an installed model, and the project's endpoint uses the intended loopback address.                                        |
| A report fails citation validation                            | Read the failure message, inspect the saved passages, and retry or narrow the research direction. Failed generation retains the previous report.                                       |
| A scanned document has little or no text                      | Open its extraction status and run English OCR. Check the recognized text against the original.                                                                                        |
| A website cannot be captured                                  | It may require a login, script execution, or unsupported page structure. Import a PDF or save a sourced manual excerpt.                                                                |
| The second display is empty or shows an older report          | Save and release a revision explicitly. Working drafts do not automatically replace the released snapshot.                                                                             |
| An analysis API key disappears after restart                  | A usable operating-system secure-storage backend may be unavailable. Analysis keys remain session-only in that case; saving a Brave Search key instead requires usable secure storage. |
| A Linux package will not start                                | Use the [Linux troubleshooting guide](docs/LINUX.md); include distribution, desktop session, package type, and the visible error in your report.                                       |
| An older Acadia cannot open a new archive | V0.5.0 writes portable format v4. Open it with v0.5.0 or later; earlier formats remain importable. Keep an independent backup before upgrading. |
| A linked board item is unavailable | Its underlying record is missing. The placement and connections remain saved; inspect the corresponding workspace or restore a recovery archive. Removing a linked card does not delete its research record. |

## Backups and platform expectations

Export a portable `.acadia` project before moving computers or making substantial changes to an investigation. Keep an independent backup; recovery archives on the same disk do not protect against disk loss. Avoid modifying the live SQLite database or attachment directory manually.

The release targets are Ubuntu 24.04 x64, Apple Silicon macOS, and Windows x64. Native validation differs by release and is described in its notes. Successful cross-packaging does not establish native runtime compatibility. Other Linux distributions, Linux ARM, and Intel Mac are currently outside the release targets.

Physical touchscreen behavior, mixed-DPI displays, and projector arrangements should be checked on the hardware you intend to use. Automated touch simulation and a second application window do not establish hardware compatibility.
