// Native PDF support must be present when building a Windows installer on macOS.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const version = require("@napi-rs/canvas/package.json").version;
const packageName = "@napi-rs/canvas-win32-x64-msvc";
const destination = path.join(process.cwd(), "node_modules", packageName);
const installed = path.join(destination, "package.json");
if (
  !fs.existsSync(installed) ||
  JSON.parse(fs.readFileSync(installed, "utf8")).version !== version
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
console.log(`Windows PDF native dependency ready: ${packageName}@${version}`);
