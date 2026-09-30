# Releasing Acadia

A release is a reproducible source revision, the packages built from it, and an honest account of what was tested. A successful cross-platform build alone is not a native runtime test. Acadia is currently an unsigned 0.x early-access application.

## Prepare the source

1. Choose the version and review the changes since the previous release. Keep `package.json`, `package-lock.json`, the visible app version, changelog, and release output directory consistent. For v0.5.0, the portable format is v4 and requires Acadia v0.5+; preserve v1/v2/v3 import and recovery guidance.
2. Use Node.js 24.x and a clean checkout. Install with `npm ci`; do not resolve a different dependency set with an unreviewed install.
3. Review dependency changes and refresh bundled license notices with `npm run notices`. Confirm the repository license and artwork/fixture redistribution rights.
4. Update affected user guides. Use screenshots from a disposable sample investigation, with the approved branding and no private research or credentials.
5. Write `docs/RELEASE-v<version>.md` for the exact tag, such as [v0.5.0 release notes](RELEASE-v0.5.0.md). The workflow publishes this file from the validated source revision. Use absolute, tag-specific links in this file so guides and validation evidence open correctly from GitHub Releases.
6. Update the release-series validation record, such as [v0.5 validation](VALIDATION-v0.5.md), and point the `extraResources` entry for `VALIDATION.md` to it. Keep earlier validation records and model evaluations labeled with their original versions. Declare the guides, sample investigations and evaluation files that belong in the package as explicit `extraResources` files.

## Validate before packaging

```sh
npm ci
node .github/scripts/release-artifacts.cjs metadata
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The native suite requires a graphical session and a built application. On Linux, follow [Ubuntu setup](LINUX.md). In automation, use the repository's configured display setup rather than changing the application to disable Chromium's sandbox.

Do not run a build while another suite is loading `out/`. If native test runs share a checkout, give each an independent output directory:

```sh
npm run test:e2e -- --output=test-results/release-source
```

Inspect failures and exported documents, not only exit codes. The checks should cover source extraction/OCR, historical citation navigation, source-only investigations, inclusion/exclusion policy, approved discovery, per-item AI summaries and human-accepted Reviewer Notes, linked board records and gap-to-deliverable navigation, report section preservation, released-window isolation, portable project round trips, and migration/recovery.

## Build and inspect each target

Use a native runner for the target where possible. Packaging commands write to the configured versioned release directory.

| Target              | Command                 | Expected result                                                             |
| ------------------- | ----------------------- | --------------------------------------------------------------------------- |
| Apple Silicon macOS | `npm run package:mac`   | `mac-arm64/Acadia.app`, then a ZIP handoff.                                 |
| Windows x64         | `npm run package:win`   | NSIS installer and its build metadata.                                      |
| Ubuntu 24.04 x64    | `npm run package:linux` | `Acadia-<version>-linux-x64.deb` and `Acadia-<version>-linux-x64.AppImage`. |

The platform preparation scripts arrange the matching native PDF canvas dependency. Confirm the finished app contains its OCR worker, recognition runtime, English language data, quick-start guide, sample investigations, current validation record, and third-party notices. The staging script checks the app's embedded name/version and compares every declared `extraResources` file byte-for-byte with the source revision. Test the artifact you will distribute, not only the development executable.

Set `ACADIA_TEST_EXECUTABLE` to the packaged executable to run the native suite against it. Use an isolated test profile and retain useful failure traces. For an AppImage or installer, also test its normal launch/install path: running an unpacked executable is a different check.

Record operating-system version, CPU architecture, package type, source revision, test results, and remaining limitations. On Linux, distinguish a container/Xvfb exercise from a physical Ubuntu desktop. Physical touch, mixed-DPI, and projector checks require the actual equipment.

## Assemble release assets

Include the platform packages actually built, a source archive if provided, release notes, and a SHA-256 checksum manifest. The editable source archive can be produced with:

```sh
python3 scripts/package-source.py
```

Review its contents before uploading. It must exclude dependencies, generated app output, test artifacts, personal IDE settings, secrets, and workspace profiles. Original approved branding and public documentation belong in the source archive.

Compute checksums after packaging is complete. Verify that the manifest matches the final uploaded bytes. Checksums are useful integrity checks; they do not replace signing or notarization. Retain required accompanying installer metadata when it is part of the selected release format.

## Repository workflows

[CI](../.github/workflows/ci.yml) runs type checks, unit/integration tests, a build, and native Electron scenarios on the configured Ubuntu, macOS, and Windows runners. Ubuntu uses D-Bus and Xvfb for the test session. A workflow definition is not a passing validation result; inspect the run for the intended revision.

[Release](../.github/workflows/release.yml) first validates package/lockfile versions, the version-specific release notes, and declared bundled files. It then builds native packages, tests the packaged executables, validates platform assets and bundled resources, and combines SHA-256 checksums. A manual branch dispatch with **publish = false** builds downloadable workflow artifacts without publishing a GitHub release. Use that path to inspect a release candidate first.

Pushing a matching `v<version>` tag triggers publication after all three native package jobs and the combined-asset verification pass. A manual publish run must select the existing version tag and set **publish = true**; publishing from a branch is rejected. Package and lockfile versions must match the tag. The publisher checks out the exact validated source revision, verifies the downloaded checksums again, and uses its reviewed `docs/RELEASE-v<version>.md` body with GitHub-generated change notes. The workflow creates a new release, so do not separately create one for that same tag before the publish job.

## Publish and verify

Before triggering publication, review the candidate's assets and prepare notes covering:

- Concrete user-facing changes and any migration/backup instructions.
- Available operating-system/architecture/package combinations.
- Checks run against each package, including whether execution was native, virtualized, or not performed.
- Known limitations, unsigned/not-notarized status, and any live model tests actually performed.

For a manual release outside the workflow, assemble and inspect a draft before publishing it. After either publishing path completes, verify the public release page, download a representative asset, and compare its checksum. A successful upload call is not sufficient evidence that all intended files are attached.

Keep earlier releases available unless a specific security or integrity problem requires withdrawal. For a bad release, explain the issue, provide a corrected version, and preserve useful migration/recovery instructions. Follow [Security](../SECURITY.md) for coordinated vulnerability disclosure.
