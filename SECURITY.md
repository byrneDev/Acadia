# Security policy

## Report a vulnerability privately

Use [Report a vulnerability](https://github.com/byrneDev/Acadia/security/advisories/new) in this repository's **Security → Advisories** section. This creates a private report for maintainers through GitHub. See [GitHub's reporting instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately) if needed.

Do not publish an exploit, exposed credential, private document, or another person's data in an issue. If private reporting is unavailable, open an issue asking for a private security contact **without including the vulnerability details**.

Include the affected version and operating system, a minimal reproduction, the security impact, and any workaround you found. Use synthetic documents and test credentials. Relevant areas include malicious document/archive handling, source capture, IPC authorization, draft disclosure to the released display, unintended network transmission, and credential storage.

Maintainers will assess the report and coordinate a fix and disclosure when possible. This project does not offer a bug bounty, a guaranteed response deadline, or an independent security certification.

## Supported versions

Security fixes are developed against the latest release and the default branch. Older 0.x versions are not maintained as separate long-term support branches. Check [Releases](https://github.com/byrneDev/Acadia/releases) for available fixes and their validation status.

## Data and trust boundaries

- Research documents, annotations, source passages, reports, and exported `.acadia` archives can contain sensitive information. The workspace is local storage, not an encrypted vault.
- Keys entered in the interface are passed to the main process. Saved credentials are not returned in renderer settings or included in project exports. Analysis-key persistence uses Electron's operating-system secure storage when a usable backend is available; otherwise analysis keys remain session-only. A nonempty Brave Search key cannot be saved without usable secure storage. Linux's plaintext `basic_text` backend is not accepted for secure persistence.
- Local analysis permits a configured loopback model service or the offline engine. Cloud analysis is an explicit per-project choice. A locally running model is software you operate separately and must trust.
- Web capture requests selected public URLs. It blocks private-network destinations, sanitizes readable content, and does not run the page's scripts. External Brave discovery requires approval of the displayed plan.
- The audience window receives the released report snapshot and its cited evidence, with privileged workspace mutations denied in the main process.
- Source and model content are untrusted inputs. Citation checks establish provenance and quotation locations; they do not prove the accuracy or safety of a conclusion.

Release binaries are currently unsigned and the macOS build is not notarized. Obtain packages from the project's [release page](https://github.com/byrneDev/Acadia/releases), compare published checksums, and review release notes. A checksum helps detect a changed download; it is not a publisher signature.
