import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { validateWindowsPackage } =
  require("../scripts/prepare-windows.cjs") as {
    validateWindowsPackage(directory: string, expectedVersion: string): void;
  };
const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "acadia-pe-check-"));
  directories.push(directory);
  const manifest = {
    name: "@napi-rs/canvas-win32-x64-msvc",
    version: "0.1.80",
    os: ["win32"],
    cpu: ["x64"],
  };
  const bytes = Buffer.alloc(256);
  bytes.write("MZ");
  bytes.writeUInt32LE(128, 0x3c);
  bytes.write("PE\0\0", 128);
  bytes.writeUInt16LE(0x8664, 132);
  const binary = join(directory, "skia.win32-x64-msvc.node");
  writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
  writeFileSync(binary, bytes);
  return { directory, manifest, bytes, binary };
}
describe("Windows PDF prebuild validation", () => {
  it("accepts a matching x64 PE package without loading native code or using the network", () => {
    const { directory } = fixture();
    expect(() => validateWindowsPackage(directory, "0.1.80")).not.toThrow();
  });
  it("rejects a missing binary even when the manifest matches", () => {
    const { directory, binary } = fixture();
    rmSync(binary);
    expect(() => validateWindowsPackage(directory, "0.1.80")).toThrow(/x64 PE/);
  });
  it("rejects ARM64 or x86 native code disguised as an x64 package", () => {
    const { directory, binary, bytes } = fixture();
    for (const architecture of [0xaa64, 0x14c]) {
      bytes.writeUInt16LE(architecture, 132);
      writeFileSync(binary, bytes);
      expect(() => validateWindowsPackage(directory, "0.1.80")).toThrow(
        /x64 PE/,
      );
    }
  });
  it("rejects invalid signatures, truncated files and out-of-range PE offsets", () => {
    const { directory, binary, bytes } = fixture();
    for (const bad of [
      Buffer.alloc(0),
      Buffer.alloc(128),
      Buffer.from(bytes),
    ]) {
      if (bad.length === 256) bad.writeUInt32LE(0xffffffff, 0x3c);
      writeFileSync(binary, bad);
      expect(() => validateWindowsPackage(directory, "0.1.80")).toThrow(
        /x64 PE/,
      );
    }
    bytes.write("XX", 128);
    writeFileSync(binary, bytes);
    expect(() => validateWindowsPackage(directory, "0.1.80")).toThrow(/x64 PE/);
  });
  it("rejects stale version and incorrect package/platform metadata", () => {
    const { directory, manifest } = fixture();
    expect(() => validateWindowsPackage(directory, "0.1.81")).toThrow(/x64 PE/);
    for (const wrong of [
      { ...manifest, name: "wrong" },
      { ...manifest, os: ["linux"] },
      { ...manifest, cpu: ["arm64"] },
    ]) {
      writeFileSync(join(directory, "package.json"), JSON.stringify(wrong));
      expect(() => validateWindowsPackage(directory, "0.1.80")).toThrow(
        /x64 PE/,
      );
    }
  });
});
