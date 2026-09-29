# Contributing to Acadia

Acadia is an early-access research application. Contributions should help a researcher inspect evidence, preserve original material, understand uncertainty, and control what is released.

For a substantial feature or architectural change, open an issue describing the research problem and the intended behavior before starting a large patch. Small bug fixes, documentation corrections, and reproducible test cases can go directly to a pull request. Follow the [Code of conduct](CODE_OF_CONDUCT.md).

## Set up a development checkout

Use Node.js 24.x and the committed npm lockfile:

```sh
git clone https://github.com/byrneDev/Acadia.git
cd Acadia
npm ci
npm run dev
```

The desktop app uses Electron and built-in SQLite. A normal graphical session is needed for native UI work. See [Linux setup](docs/LINUX.md) for Ubuntu dependencies. Read [Architecture](docs/ARCHITECTURE.md) before changing storage, ingestion, IPC, or analysis.

Keep experiments away from your real research. Set `ACADIA_USER_DATA` to a new directory when running a manual test instance. Automated Electron tests create and remove their own temporary profiles.

## Make a reviewable change

1. Create a branch for one coherent problem.
2. Describe the expected behavior, especially how an existing project should behave after the change.
3. Implement the change and add focused regression coverage where behavior, data integrity, privacy, or portability is affected.
4. Update user-facing documentation if the workflow or requirements change.
5. Open a pull request with the problem, resulting behavior, verification performed, and any remaining platform limits.

Use screenshots for meaningful visual changes and a minimal fixture for extraction or import failures. Prefer synthetic or redistributable examples. Do not include private research, customer documents, API keys, local profiles, personal paths, or generated release binaries in a pull request.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm test` runs unit and integration checks. Native Electron scenarios require a built app; they exercise persistence, import/export, report editing, jobs, and release-display restrictions. To test a packaged executable, set `ACADIA_TEST_EXECUTABLE` to its executable path and run the same native suite.

Run checks appropriate to the change, and list what you ran. A documentation-only correction does not require a full desktop test run. Tests sharing a checkout should use separate Playwright output directories when run concurrently. Do not rebuild `out/` while a native test is loading that build.

Use the existing TypeScript, React, and Prettier conventions. `npm run format` reformats the repository; for a focused change, run Prettier only on the files you changed. Dependency changes should include the lockfile and any regenerated third-party notices (`npm run notices`).

## Behaviors to preserve

- A citation points to an immutable source version and passage, even after the working source changes.
- Failed extraction, failed model output, and cancelled work must not be presented as successful research.
- Local-analysis projects do not send content to cloud endpoints or silently switch providers.
- External discovery requires a project-owned approved plan; search results do not silently become evidence.
- AI section changes require review and must preserve untouched writing and citations.
- The Releaser display receives released revisions rather than working drafts, and cannot mutate the workspace.
- Migrations and portable imports preserve recoverable user data before replacement.
- The approved artwork remains unchanged, and new interface work fits the existing portal styling and keyboard/touch behavior.

## Review and licensing

Explain material tradeoffs rather than hiding them behind a passing test count. Maintainers may request a smaller change, additional evidence, or a different approach before merging. There is no guaranteed review time.

Submit only material you have the right to contribute. Contributions are offered under the repository's [license](LICENSE); preserve third-party attribution and do not include assets with unclear redistribution rights.
