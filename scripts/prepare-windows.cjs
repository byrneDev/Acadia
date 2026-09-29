// Native PDF support must be present when building a Windows installer on macOS.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const packageName = "@napi-rs/canvas-win32-x64-msvc";
const binaryName = "skia.win32-x64-msvc.node";

function validateWindowsPackage(directory, expectedVersion) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const binary = path.join(directory, binaryName);
  const invalid = () => {
    throw new Error(
      "Windows PDF dependency must be a matching x64 PE prebuild.",
    );
  };
  if (
    manifest.name !== packageName ||
    manifest.version !== expectedVersion ||
    !manifest.os?.includes("win32") ||
    !manifest.cpu?.includes("x64") ||
    !fs.existsSync(binary)
  )
    invalid();
  const descriptor = fs.openSync(binary, "r");
  try {
    const size = fs.fstatSync(descriptor).size;
    const dos = Buffer.alloc(64);
    if (
      size < dos.length ||
      fs.readSync(descriptor, dos, 0, dos.length, 0) !== dos.length ||
      dos.toString("ascii", 0, 2) !== "MZ"
    )
      invalid();
    const offset = dos.readUInt32LE(0x3c);
    const pe = Buffer.alloc(6);
    if (
      offset < dos.length ||
      offset > size - pe.length ||
      fs.readSync(descriptor, pe, 0, pe.length, offset) !== pe.length ||
      !pe.subarray(0, 4).equals(Buffer.from([0x50, 0x45, 0, 0])) ||
      pe.readUInt16LE(4) !== 0x8664
    )
      invalid();
  } finally {
    fs.closeSync(descriptor);
  }
}

function prepareWindowsPdfDependency() {
  const version = require("@napi-rs/canvas/package.json").version;
  const destination = path.join(process.cwd(), "node_modules", packageName);
  const installed = path.join(destination, "package.json");
  if (
    !fs.existsSync(installed) ||
    JSON.parse(fs.readFileSync(installed, "utf8")).version !== version ||
    !fs.existsSync(path.join(destination, binaryName))
  ) {
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "acadia-windows-pdf-"),
    );
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
  validateWindowsPackage(destination, version);
  if (process.platform === "win32" && process.arch === "x64") {
    const canvas = require("@napi-rs/canvas");
    if (!canvas.createCanvas(2, 2).getContext("2d"))
      throw new Error("Windows PDF canvas failed its native load check.");
  }
  console.log(`Windows PDF native dependency ready: ${packageName}@${version}`);
}

module.exports = { validateWindowsPackage };
if (require.main === module) prepareWindowsPdfDependency();
