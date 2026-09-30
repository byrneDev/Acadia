# Repository automation

CI checks types, unit/research acceptance tests, the build, and native Electron scenarios on Ubuntu 24.04 x64, macOS 15 Apple Silicon, and Windows 2025 x64. Each test owns a disposable research profile. Ubuntu uses Xvfb and a path-scoped AppArmor user-namespace allowance for the two test executable locations; Electron's sandbox stays enabled. This CI-only setup does not modify production launch arguments or disable AppArmor globally.

The Release workflow builds and tests native packages on the same three platforms. On Ubuntu it installs the `.deb`, checks desktop integration and the installed sandbox profile, then runs the native suite against `/opt/Acadia/acadia`. Each job stages a checksum manifest; a separate job verifies the complete distribution before publication. The only job with `contents: write` downloads verified artifacts and publishes the release. It does not install dependencies or execute application code.

Use **Run workflow** with **publish** left unchecked to build downloadable workflow artifacts without publishing. Push a `vX.Y.Z` tag matching both package files to publish after every check succeeds. A manual publish run must select that existing version tag. Published releases are not overwritten; a failed publication can be investigated before a new run.

Each version has reviewed release notes in `docs/RELEASE-vX.Y.Z.md`. Publication uses the notes from the tagged source revision. Package validation checks the embedded application version and the bundled guides, samples and evaluation records before staging downloads.

Action revisions are pinned to full commit hashes from official release tags. Dependabot proposes updates weekly. GitHub's generated release-note categories are configured in `release.yml`.

Automated display and simulated touch checks do not establish physical monitor, touchscreen, mixed-DPI, signing, or notarization validation. See the project validation guide for those boundaries.
