const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const version = process.env.ACADIA_RELEASE_VERSION;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
  throw new Error("ACADIA_RELEASE_VERSION must be a valid release version.");
}
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

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
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
if (!["stage", "verify"].includes(command))
  throw new Error("Use stage or verify.");
(command === "stage" ? stage() : verify()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
