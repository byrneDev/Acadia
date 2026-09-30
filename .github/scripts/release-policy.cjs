const path = require("node:path");
const { execFileSync } = require("node:child_process");

function releasePolicy(version, signCandidate = false) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("Invalid release version.");
  const prerelease = version.includes("-");
  const production = Number(version.split(".")[0]) >= 1 && !prerelease;
  return {
    prerelease,
    production,
    signingRequired: production || signCandidate,
  };
}
function debianVersion(version) {
  releasePolicy(version);
  return version.replace(/-/g, "~");
}
const acceptanceChecks = [
  "monday",
  "jira",
  "planner",
  "powerBi",
  "macCleanInstall",
  "macUpgrade",
  "windowsInstaller",
  "windowsUpgrade",
  "ubuntuDebInstall",
  "ubuntuAppImageLaunch",
  "ubuntuUpgrade",
  "physicalTwoDisplays",
  "physicalTouchscreen",
  "mixedDpi",
  "keyboardNavigation",
  "screenReader",
];
function validateAcceptance(value, version, sourceCommit) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.version !== version ||
    value.sourceCommit !== sourceCommit ||
    !/^[a-f0-9]{40}$/.test(sourceCommit || "")
  )
    throw new Error(
      "Production acceptance must identify the exact release version and source commit.",
    );
  if (
    typeof value.reviewedBy !== "string" ||
    !value.reviewedBy.trim() ||
    !Number.isFinite(Date.parse(value.reviewedAt))
  )
    throw new Error(
      "Production acceptance needs an identified reviewer and review date.",
    );
  for (const key of acceptanceChecks) {
    const check = value.checks?.[key];
    if (
      check?.status !== "passed" ||
      typeof check.evidence !== "string" ||
      check.evidence.trim().length < 12 ||
      typeof check.environment !== "string" ||
      !check.environment.trim()
    )
      throw new Error(
        `Production acceptance is missing passing evidence and environment for ${key}.`,
      );
  }
  if (
    !Array.isArray(value.testers) ||
    value.testers.length < 5 ||
    new Set(value.testers.map((t) => t.id)).size !== value.testers.length
  )
    throw new Error(
      "Production acceptance requires at least five distinct tester records.",
    );
  for (const tester of value.testers)
    if (
      typeof tester.id !== "string" ||
      !tester.id.trim() ||
      tester.status !== "passed" ||
      typeof tester.evidence !== "string" ||
      tester.evidence.trim().length < 12 ||
      typeof tester.platform !== "string" ||
      !tester.platform.trim()
    )
      throw new Error(
        "Every tester must record a platform, passing result and evidence.",
      );
  const evidence = (item) =>
    item?.status === "passed" &&
    typeof item.evidence === "string" &&
    item.evidence.trim().length >= 12;
  for (const tester of value.testers)
    for (const workflow of ["software", "curriculum"])
      if (!evidence(tester.workflows?.[workflow]))
        throw new Error(
          `Tester ${tester.id} must retain passing ${workflow} workflow evidence.`,
        );
  const blockers = value.blockers;
  if (
    !blockers ||
    typeof blockers.reviewedBy !== "string" ||
    !blockers.reviewedBy.trim() ||
    typeof blockers.evidence !== "string" ||
    blockers.evidence.trim().length < 12 ||
    ["dataLoss", "privacy", "citationIntegrity", "coreWorkflow"].some(
      (key) => blockers[key] !== 0,
    )
  )
    throw new Error(
      "Production release requires reviewed evidence of zero open data-loss, privacy, citation-integrity and core-workflow blockers.",
    );
  const scale = value.scale;
  if (
    !evidence(scale) ||
    ["os", "cpu", "memory", "storage"].some(
      (key) =>
        typeof scale.referenceMachine?.[key] !== "string" ||
        !scale.referenceMachine[key].trim(),
    )
  )
    throw new Error(
      "Scale acceptance must identify the actual reference machine and passing evidence.",
    );
  for (const key of [
    "sources",
    "passages",
    "boardCards",
    "searchP95Ms",
    "projectOpenP95Ms",
  ]) {
    const target = scale.targets?.[key],
      observed = scale.observed?.[key];
    if (
      typeof target !== "number" ||
      !Number.isFinite(target) ||
      target <= 0 ||
      typeof observed !== "number" ||
      !Number.isFinite(observed) ||
      observed < 0 ||
      (["sources", "passages", "boardCards"].includes(key)
        ? observed < target
        : observed > target)
    )
      throw new Error(
        `Scale acceptance does not meet the declared ${key} target.`,
      );
  }
  if (
    scale.targets.sources < 1000 ||
    scale.targets.passages < 100000 ||
    scale.targets.boardCards < 500 ||
    scale.targets.searchP95Ms > 1000 ||
    scale.targets.projectOpenP95Ms > 5000
  )
    throw new Error(
      "Scale targets must retain the v1 population floor and one-second search/five-second opening ceilings.",
    );
  if (
    scale.referenceMachine.memoryGiB !== 16 ||
    scale.referenceMachine.ssd !== true
  )
    throw new Error(
      "Scale qualification requires the declared 16 GiB/SSD reference machine; larger-host observations are separate evidence.",
    );
  for (const key of ["interactionP95Ms", "peakMemoryMiB"])
    if (
      typeof scale.observed[key] !== "number" ||
      !Number.isFinite(scale.observed[key]) ||
      scale.observed[key] < 0
    )
      throw new Error(
        `Record observed ${key} separately without an invented acceptance deadline.`,
      );
  if (
    !Array.isArray(value.advertisedModels) ||
    !value.advertisedModels.length ||
    value.advertisedModels.some(
      (model) => typeof model !== "string" || !model.trim(),
    ) ||
    new Set(value.advertisedModels).size !== value.advertisedModels.length ||
    !Array.isArray(value.modelEvaluations)
  )
    throw new Error(
      "Declare every advertised model and its reviewed quality evaluation.",
    );
  for (const model of value.advertisedModels) {
    const evaluation = value.modelEvaluations.find(
      (item) => item.model === model,
    );
    if (
      !evidence(evaluation) ||
      typeof evaluation.reviewedBy !== "string" ||
      !evaluation.reviewedBy.trim() ||
      !Number.isFinite(Date.parse(evaluation.reviewedAt)) ||
      typeof evaluation.provider !== "string" ||
      !evaluation.provider.trim() ||
      typeof evaluation.fixture !== "string" ||
      !evaluation.fixture.trim() ||
      !Number.isInteger(evaluation.runs) ||
      evaluation.runs < 3 ||
      [
        "retrieval",
        "supportReview",
        "contradictionHandling",
        "abstention",
        "quotationValidity",
        "responseReliability",
      ].some((key) => !evidence(evaluation.dimensions?.[key]))
    )
      throw new Error(
        `Advertised model ${model} needs a separately reviewed, repeated evaluation of retrieval, support, contradiction handling, abstention, quotation validity and response reliability.`,
      );
  }
  return value;
}
function verifyNativeSigning(directory, platform, installer) {
  if (platform === "linux-x64") return { status: "not-applicable", checks: [] };
  if (platform === "macos-arm64") {
    const app = path.join(directory, "mac-arm64", "Acadia.app");
    execFileSync(
      "codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", app],
      { stdio: "pipe" },
    );
    // codesign writes display metadata to stderr even on success.
    const result = require("node:child_process").spawnSync(
      "codesign",
      ["-d", "--verbose=4", app],
      { encoding: "utf8" },
    );
    const details = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (
      result.status !== 0 ||
      !/^Authority=Developer ID Application:/m.test(details) ||
      !/^TeamIdentifier=[A-Z0-9]{10}$/m.test(details) ||
      !/flags=.*runtime/.test(details)
    )
      throw new Error(
        "Production macOS requires Developer ID Application signing and hardened runtime; development/ad-hoc signatures are rejected.",
      );
    execFileSync("xcrun", ["stapler", "validate", app], { stdio: "pipe" });
    execFileSync(
      "spctl",
      ["--assess", "--type", "execute", "--verbose=2", app],
      { stdio: "pipe" },
    );
    return {
      status: "verified",
      checks: [
        "Developer ID Application",
        "codesign deep strict",
        "hardened runtime",
        "stapled notarization ticket",
        "Gatekeeper assessment",
      ],
    };
  }
  if (platform === "windows-x64") {
    const script = `$ErrorActionPreference='Stop'; $result = @($env:ACADIA_VERIFY_APP, $env:ACADIA_VERIFY_INSTALLER) | ForEach-Object { $s=Get-AuthenticodeSignature -LiteralPath $_; if ($s.Status -ne 'Valid' -or !$s.SignerCertificate -or !$s.TimeStamperCertificate) { throw 'A valid timestamped Authenticode signature is required on both app and installer.' }; [PSCustomObject]@{Subject=$s.SignerCertificate.Subject; Status=$s.Status.ToString()} }; if ($result[0].Subject -ne $result[1].Subject) { throw 'App and installer publishers must match.' }; $result | ConvertTo-Json -Compress`;
    const result = JSON.parse(
      execFileSync(
        "pwsh",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            ACADIA_VERIFY_APP: path.join(
              directory,
              "win-unpacked",
              "Acadia.exe",
            ),
            ACADIA_VERIFY_INSTALLER: installer,
          },
        },
      ),
    );
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      result.some((r) => r.Status !== "Valid")
    )
      throw new Error(
        "Windows signature verification did not return both valid signatures.",
      );
    return {
      status: "verified",
      checks: [
        "app Authenticode",
        "installer Authenticode",
        "trusted timestamp",
        "matching publisher",
      ],
    };
  }
  throw new Error("Unknown signing platform.");
}
module.exports = {
  releasePolicy,
  debianVersion,
  validateAcceptance,
  acceptanceChecks,
  verifyNativeSigning,
};
