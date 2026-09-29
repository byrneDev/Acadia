// Ubuntu x64 uses the GNU/Linux canvas prebuild, regardless of the build host.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const version = require("@napi-rs/canvas/package.json").version;
const packageName = "@napi-rs/canvas-linux-x64-gnu";
const destination = path.join(process.cwd(), "node_modules", packageName);
const manifestPath = path.join(destination, "package.json");
const binaryPath = path.join(destination, "skia.linux-x64-gnu.node");
const installed = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : undefined;

if (installed?.version !== version || !fs.existsSync(binaryPath)) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "acadia-linux-pdf-"));
  try {
    const result = JSON.parse(
      execFileSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        [
          "pack",
          `${packageName}@${version}`,
          "--json",
          "--pack-destination",
          temporary,
        ],
        { encoding: "utf8" },
      ),
    );
    fs.mkdirSync(destination, { recursive: true });
    execFileSync("tar", [
      "-xzf",
      path.join(temporary, result[0].filename),
      "--strip-components=1",
      "-C",
      destination,
    ]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const header = Buffer.alloc(20);
const descriptor = fs.openSync(binaryPath, "r");
try {
  fs.readSync(descriptor, header, 0, header.length, 0);
} finally {
  fs.closeSync(descriptor);
}
if (
  manifest.name !== packageName ||
  manifest.version !== version ||
  !manifest.os?.includes("linux") ||
  !manifest.cpu?.includes("x64") ||
  !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
  header[4] !== 2 ||
  header[5] !== 1 ||
  header.readUInt16LE(18) !== 62
) {
  throw new Error("Linux PDF dependency must be a matching x64 ELF prebuild.");
}

if (process.platform === "linux" && process.arch === "x64") {
  const canvas = require("@napi-rs/canvas");
  if (!canvas.createCanvas(2, 2).getContext("2d")) {
    throw new Error("Linux PDF canvas failed its native load check.");
  }
}
console.log(`Linux PDF native dependency ready: ${packageName}@${version}`);
