const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const packageInfo = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const version = process.env.ACADIA_RELEASE_VERSION || packageInfo.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
  throw new Error("The release version must be a valid semantic version.");
}
if (
  packageInfo.version !== version ||
  lock.version !== version ||
  lock.packages?.[""]?.version !== version
)
  throw new Error("Release, package and lockfile versions must match.");
const releaseNotes = `docs/RELEASE-v${version}.md`;
const directory = path.resolve("release-assets");
const names = {
  "linux-x64": [
    `Acadia-${version}-linux-x64.deb`,
    `Acadia-${version}-linux-x64.AppImage`,
  ],
  "macos-arm64": [`Acadia-${version}-macOS-arm64.zip`],
  "windows-x64": [`Acadia-${version}-Windows-x64.exe`],
};
const manifestName = (platform) => `SHA256SUMS-${platform}.txt`;

function resourceFiles() {
  const resources = packageInfo.build?.extraResources;
  if (!Array.isArray(resources) || !resources.length)
    throw new Error("The release must declare its bundled guides and samples.");
  for (const resource of resources) {
    if (
      !resource ||
      typeof resource.from !== "string" ||
      typeof resource.to !== "string" ||
      path.isAbsolute(resource.from) ||
      path.isAbsolute(resource.to) ||
      /(^|[\\/])\.\.([\\/]|$)/.test(resource.from) ||
      /(^|[\\/])\.\.([\\/]|$)/.test(resource.to) ||
      !fs.lstatSync(resource.from).isFile()
    )
      throw new Error(
        "Release extraResources must name existing explicit files within the repository.",
      );
  }
  const validation = resources.find(
    (resource) => resource.to === "VALIDATION.md",
  );
  const series = version.split(".").slice(0, 2).join(".");
  if (validation?.from !== `docs/VALIDATION-v${series}.md`)
    throw new Error(
      "The bundled VALIDATION.md must identify this release series.",
    );
  return resources;
}

function metadata() {
  resourceFiles();
  if (
    !fs.existsSync(releaseNotes) ||
    !fs.lstatSync(releaseNotes).isFile() ||
    fs.statSync(releaseNotes).size < 100 ||
    !fs.readFileSync(releaseNotes, "utf8").includes(version)
  )
    throw new Error(
      `Write reviewed release notes for this version at ${releaseNotes}.`,
    );
  const tag = `v${version}`;
  const publish = process.env.REQUEST_PUBLISH === "true";
  if (
    (publish || process.env.GITHUB_REF_TYPE === "tag") &&
    process.env.GITHUB_REF !== `refs/tags/${tag}`
  )
    throw new Error(
      `Select or push the existing ${tag} tag. Branch dispatches only build artifacts.`,
    );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\ntag=${tag}\npublish=${publish}\nnotes=${releaseNotes}\n`,
    );
  console.log(
    `Validated ${tag}, ${releaseNotes}, and its declared bundled resources.`,
  );
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function validateBundledResources(releaseDirectory, platform) {
  const resourcesDirectory = path.join(
    releaseDirectory,
    {
      "linux-x64": "linux-unpacked/resources",
      "macos-arm64": "mac-arm64/Acadia.app/Contents/Resources",
      "windows-x64": "win-unpacked/resources",
    }[platform],
  );
  const { extractFile } = require("@electron/asar");
  const embedded = JSON.parse(
    extractFile(
      path.join(resourcesDirectory, "app.asar"),
      "package.json",
    ).toString("utf8"),
  );
  if (embedded.name !== packageInfo.name || embedded.version !== version)
    throw new Error(
      "The packaged application's identity/version differs from the release source.",
    );
  const resources = resourceFiles();
  for (const resource of resources) {
    const bundled = path.join(resourcesDirectory, resource.to);
    if (
      !fs.existsSync(bundled) ||
      !fs.lstatSync(bundled).isFile() ||
      (await digest(bundled)) !== (await digest(resource.from))
    )
      throw new Error(
        `Bundled resource is missing or differs from the release source: ${resource.to}`,
      );
  }
  console.log(
    `Verified packaged app v${version} and ${resources.length} bundled resources.`,
  );
}

function validateLinuxPackages(releaseDirectory) {
  const [debName, appImageName] = names["linux-x64"];
  const deb = path.join(releaseDirectory, debName);
  for (const [field, expected] of [
    ["Package", "acadia"],
    ["Version", version],
    ["Architecture", "amd64"],
  ]) {
    const actual = execFileSync("dpkg-deb", ["--field", deb, field], {
      encoding: "utf8",
    }).trim();
    if (actual !== expected)
      throw new Error(`Unexpected Debian ${field}: ${actual}`);
  }
  const image = path.join(releaseDirectory, appImageName);
  const header = Buffer.alloc(20);
  const descriptor = fs.openSync(image, "r");
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (
    header.subarray(0, 4).toString("hex") !== "7f454c46" ||
    header.readUInt16LE(18) !== 62
  ) {
    throw new Error("The AppImage is not a Linux x64 ELF executable.");
  }
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "acadia-appimage-check-"),
  );
  try {
    execFileSync(image, ["--appimage-extract"], {
      cwd: temporary,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const extracted = path.join(temporary, "squashfs-root");
    const desktopFiles = fs
      .readdirSync(extracted)
      .filter((name) => name.endsWith(".desktop"));
    if (!desktopFiles.length)
      throw new Error("AppImage desktop entry is missing.");
    for (const name of desktopFiles) {
      const desktop = fs.readFileSync(path.join(extracted, name), "utf8");
      if (/^Exec=.*--no-sandbox\b/m.test(desktop)) {
        throw new Error(
          "AppImage launcher must preserve the Chromium sandbox.",
        );
      }
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function stage() {
  const platform = process.env.ACADIA_RELEASE_PLATFORM;
  const native = {
    "linux-x64": "linux-x64",
    "macos-arm64": "darwin-arm64",
    "windows-x64": "win32-x64",
  };
  if (native[platform] !== `${process.platform}-${process.arch}`) {
    throw new Error(
      `Release assets must be built and tested natively: ${platform}`,
    );
  }
  const releaseDirectory = path.resolve("release", `v${version}`);
  await validateBundledResources(releaseDirectory, platform);
  if (platform === "linux-x64") validateLinuxPackages(releaseDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const lines = [];
  for (const name of names[platform]) {
    let source = path.join(releaseDirectory, name);
    if (platform === "windows-x64" && !fs.existsSync(source)) {
      const installers = fs
        .readdirSync(releaseDirectory)
        .filter((entry) => entry.endsWith(".exe"));
      if (installers.length !== 1)
        throw new Error("Expected exactly one Windows installer.");
      source = path.join(releaseDirectory, installers[0]);
    }
    if (!fs.statSync(source).isFile() || fs.statSync(source).size < 1024) {
      throw new Error(`Release artifact is missing or empty: ${source}`);
    }
    const destination = path.join(directory, name);
    fs.copyFileSync(source, destination);
    lines.push(`${await digest(destination)}  ${name}`);
  }
  fs.writeFileSync(
    path.join(directory, manifestName(platform)),
    `${lines.join("\n")}\n`,
  );
  console.log(
    `Staged ${lines.length} native ${platform} download(s) with SHA-256 checksums.`,
  );
}

async function verify() {
  const expectedFiles = Object.values(names).flat();
  const expectedManifests = Object.keys(names).map(manifestName);
  const actualFiles = fs.readdirSync(directory).sort();
  const expected = [...expectedFiles, ...expectedManifests].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expected)) {
    throw new Error(
      "Distribution must contain exactly the downloads and manifests from all three platforms.",
    );
  }
  const combined = [];
  for (const [platform, artifacts] of Object.entries(names)) {
    const lines = fs
      .readFileSync(path.join(directory, manifestName(platform)), "utf8")
      .trim()
      .split("\n");
    if (lines.length !== artifacts.length)
      throw new Error(`Incomplete ${platform} checksum manifest.`);
    const seen = new Set();
    for (const line of lines) {
      const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
      if (!match || !artifacts.includes(match[2]) || seen.has(match[2])) {
        throw new Error(
          `Invalid or duplicate entry in the ${platform} checksum manifest.`,
        );
      }
      const [, expectedDigest, name] = match;
      const file = path.join(directory, name);
      if (
        !fs.lstatSync(file).isFile() ||
        (await digest(file)) !== expectedDigest
      ) {
        throw new Error(`Release checksum mismatch: ${name}`);
      }
      seen.add(name);
      combined.push(line);
    }
  }
  fs.writeFileSync(
    path.join(directory, "SHA256SUMS.txt"),
    `${combined.sort().join("\n")}\n`,
  );
  console.log("Verified all four native downloads; wrote SHA256SUMS.txt.");
}

const command = process.argv[2];
if (!["metadata", "stage", "verify"].includes(command))
  throw new Error("Use metadata, stage or verify.");
Promise.resolve()
  .then(() => ({ metadata, stage, verify })[command]())
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
