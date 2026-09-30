# Releasing Acadia

A release is a reproducible source revision, the packages built from it, and an honest account of what was tested. A successful cross-platform build alone is not a native runtime test. Historical v0.x releases were unsigned early-access builds. A v1 prerelease may remain unsigned and must be labeled as such. A stable v1+ release is blocked until distribution signing, notarization, native tests, and external acceptance evidence pass.

## Prepare the source

1. Choose the version and review the changes since the previous release. Keep `package.json`, `package-lock.json`, the visible app version, changelog, and release output directory consistent. For v1, the portable format is v5; preserve legacy import and recovery guidance and make the minimum compatible application version explicit.
2. Use Node.js 24.x and a clean checkout. Install with `npm ci`; do not resolve a different dependency set with an unreviewed install.
3. Review dependency changes and refresh bundled license notices with `npm run notices`. Confirm the repository license and artwork/fixture redistribution rights.
4. Update affected user guides. Use screenshots from a disposable sample investigation, with the approved branding and no private research or credentials.
5. Write `docs/RELEASE-v<version>.md` for the exact tag, such as [v1.0.0-rc.1 candidate notes](RELEASE-v1.0.0-rc.1.md). The workflow publishes this file from the validated source revision. Use absolute, tag-specific links in this file so guides and validation evidence open correctly from GitHub Releases.
6. Update the release-series validation record, such as [v1 candidate validation](VALIDATION-v1.0.md), and point the `extraResources` entry for `VALIDATION.md` to it. Keep earlier validation records and model evaluations labeled with their original versions. Declare the guides, sample investigations and evaluation files that belong in the package as explicit `extraResources` files.

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

Include the platform packages actually built, a source archive if provided, release notes, platform assurance records, and a SHA-256 checksum manifest. The editable source archive can be produced with:

```sh
python3 scripts/package-source.py
```

Review its contents before uploading. It must exclude dependencies, generated app output, test artifacts, personal IDE settings, secrets, and workspace profiles. Original approved branding and public documentation belong in the source archive.

Compute checksums after packaging is complete. Verify that the manifest matches the final uploaded bytes. Checksums are useful integrity checks; they do not replace signing or notarization. Retain required accompanying installer metadata when it is part of the selected release format.

## Repository workflows

[CI](../.github/workflows/ci.yml) runs type checks, unit/integration tests, a build, and native Electron scenarios on the configured Ubuntu, macOS, and Windows runners. Ubuntu uses D-Bus and Xvfb for the test session. A workflow definition is not a passing validation result; inspect the run for the intended revision.

[Release](../.github/workflows/release.yml) first validates package/lockfile versions, the version-specific release notes, and declared bundled files. It then builds native packages, tests the packaged executables, validates platform assets and bundled resources, and combines SHA-256 checksums. A manual branch dispatch with **publish = false** builds downloadable workflow artifacts without publishing a GitHub release. Use that path to inspect a release candidate first. A semver prerelease such as `1.0.0-rc.1` is published only with GitHub `--prerelease --latest=false` if publication is later requested; a branch build alone does not publish it. The optional **sign_candidate** input exercises the signing gates on a prerelease.

Pushing a matching `v<version>` tag triggers publication after all three native package jobs, required acceptance, and combined-asset verification pass. Stable versions with major number 1 or greater always require the production gates below; neither an unsigned build nor an absent attestation can publish through this workflow. A manual publish run must select the existing version tag and set **publish = true**; publishing from a branch is rejected. Package and lockfile versions must match the tag. The publisher checks out the exact validated source revision, verifies downloaded artifact and assurance checksums again, and uses its reviewed `docs/RELEASE-v<version>.md` body with GitHub-generated change notes. The workflow creates a new release, so do not separately create one for that same tag before the publish job.

## Distribution signing and notarization

Create protected GitHub environments named `release-candidate` and `production-release`. Restrict production tags and require an independent reviewer on `production-release`; the repository workflow cannot create or verify those settings itself. Configure secrets privately in the relevant environment. Never commit certificates, passwords, private keys, or signing receipts containing credentials.

| Platform | Required configuration                                                                                                                                                                | Automated gate                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | `MAC_CSC_LINK` (Developer ID Application certificate as base64 or supported certificate location), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Force signing and hardened runtime, require notarization, then verify deep/strict signature, Developer ID Application authority, hardened runtime, stapled ticket, and Gatekeeper acceptance. |
| Windows  | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` for an organization-approved compatible Authenticode credential                                                                                | Force signing, then verify trusted timestamped Authenticode signatures on both app and installer and matching publishers.                                                                     |
| Ubuntu   | No macOS/Windows credential is applied                                                                                                                                                | Native package metadata, sandbox-preserving launch, installed application tests, and checksums.                                                                                               |

The signing branch explicitly overrides the development `mac.identity: null` setting with automatic distribution identity selection. Apple Development and ad-hoc identities fail the post-build gate; they must not be used as public distribution signing. The workflow's certificate-file Windows setup is only suitable if the certificate provider permits that CI use. Hardware-token or cloud-signing deployments need a reviewed provider-specific adapter before production use; do not weaken `forceCodeSigning` or the verification gate to accommodate a missing credential.

The locked Electron Builder v26 configuration supports these environment variables and signing controls. Consult the official [v26 macOS configuration](https://www.electron.build/v26/docs/mac/), [Windows signing configuration](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowssigntoolconfiguration/), and [notarization guidance](https://www.electron.build/docs/notarization/) when configuring credentials. A workflow definition and local policy tests do not establish that signing or Apple submission has been successfully exercised.

`ASSURANCE-<platform>.json` records the exact version/commit and the checks that ran. Unsigned candidates explicitly record `not-required`; that status is rejected for macOS and Windows production verification. The records are included in the checksummed distribution. A successful signer proves package identity/integrity, not usability or analytical correctness.

## External production acceptance

Set environment variable **`ACADIA_RELEASE_ACCEPTANCE`** in the protected `production-release` environment to a reviewed JSON record. It must identify the final tag's exact `version` and 40-character `sourceCommit`, `schemaVersion: 1`, `reviewedBy`, and an ISO `reviewedAt`. Use pseudonymous tester IDs and durable evidence references; avoid private tenant content or personal information because workflow evidence may be downloadable.

Its `checks` object must contain each of the following keys with `{ "status": "passed", "environment": "actual platform / tenant and version", "evidence": "durable test record reference" }`:

- `monday`, `jira`, `planner`: authorized live test-tenant import, field mapping, IDs, dependencies, dates/owners, and repeated/interrupted-import behavior.
- `powerBi`: native Windows Power BI Desktop import, declared types and relationships, refresh, and checks against source totals.
- `macCleanInstall`, `macUpgrade`, `windowsInstaller`, `windowsUpgrade`, `ubuntuDebInstall`, `ubuntuAppImageLaunch`, `ubuntuUpgrade`: clean launch/install and migration of recoverable prior-version work on the actual release platforms. A packaged executable test does not replace an installer/AppImage check.
- `physicalTwoDisplays`, `physicalTouchscreen`, `mixedDpi`, `keyboardNavigation`, `screenReader`: physical display/privacy and accessibility acceptance on recorded hardware and operating systems.

The `testers` array must contain at least five distinct `{ "id": "tester alias", "platform": "actual platform", "status": "passed", "evidence": "durable acceptance record reference", "workflows": { "software": { "status": "passed", "evidence": "software completion record" }, "curriculum": { "status": "passed", "evidence": "curriculum completion record" } } }` records. Each person must complete both investigation types. These represent independent human acceptance, not five automated profiles. Retain each tester's task outcomes, failures, follow-up fixes and retest evidence with the referenced record.

Also supply these separately reviewed acceptance records:

- `blockers`: `dataLoss`, `privacy`, `citationIntegrity` and `coreWorkflow` must each be `0`, with `reviewedBy` and an `evidence` reference for the final blocker review. A successful automated suite alone is not that review.
- `scale`: `status: "passed"`, `evidence`, and `referenceMachine` identifying `os`, `cpu`, `memory`, `storage`, `memoryGiB: 16` and `ssd: true`. Record numeric `targets` and `observed` for `sources`, `passages`, `boardCards`, `searchP95Ms` and `projectOpenP95Ms`. Targets cannot relax the minimum 1,000 sources / 100,000 passages / 500 cards, the one-second indexed-search ceiling or the five-second project-opening ceiling. Observed populations must meet the declared target; observed p95 timings must not exceed it. Record `observed.interactionP95Ms` and `observed.peakMemoryMiB` separately; no unapproved timing or memory threshold is invented. Measurements on a larger host remain useful evidence but do not qualify the 16 GiB/SSD reference machine. Document repetitions, warm/cold state and timing boundaries in the evidence.
- `advertisedModels`: the exact nonempty list of provider/model configurations advertised as tested. Each requires a matching `modelEvaluations` entry with `model`, `provider`, fixed `fixture`, `runs` of at least three, `status: "passed"`, `evidence`, `reviewedBy` and `reviewedAt`. Its `dimensions` must separately contain `retrieval`, `supportReview`, `contradictionHandling` and `abstention`, each with passing status and its own evidence reference. Preserve failure outcomes and limitations; a connection check, mocked response or single accepted draft does not qualify a model.

Policy test fixtures use fictional machines, models and evidence strings solely to test validation. They are not release attestations or measured performance results.

No passing attestation is supplied by default. Missing checks, either missing tester workflow, relaxed or failed scale targets, unreviewed advertised models, open critical blockers, blank evidence, fewer than five testers, mismatched versions/commits or absent signing credentials stop production. The JSON validator confirms the record's completeness and identity; a protected-environment reviewer must verify that the referenced real-world work actually occurred. Changing the release commit invalidates the old attestation until its evidence and review are updated. Earlier unsigned v0.x publication is historical evidence, not satisfaction of this gate.

## Publish and verify

Before triggering publication, review the candidate's assets and prepare notes covering:

- Concrete user-facing changes and any migration/backup instructions.
- Available operating-system/architecture/package combinations.
- Checks run against each package, including whether execution was native, virtualized, or not performed.
- Known limitations, unsigned/not-notarized status, and any live model tests actually performed.

For a manual release outside the workflow, assemble and inspect a draft before publishing it. After either publishing path completes, verify the public release page, download a representative asset, and compare its checksum. A successful upload call is not sufficient evidence that all intended files are attached.

Keep earlier releases available unless a specific security or integrity problem requires withdrawal. For a bad release, explain the issue, provide a corrected version, and preserve useful migration/recovery instructions. Follow [Security](../SECURITY.md) for coordinated vulnerability disclosure.
