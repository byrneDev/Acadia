// Generate distributable notices without network access or every platform's
// native binary being installed on the documentation/build host.
const fs = require("node:fs");
const path = require("node:path");
const projectRoot = path.resolve(__dirname, "..");
const packageManifest = require(path.join(projectRoot, "package.json"));
const roots = [
  ...Object.keys(packageManifest.dependencies),
  "react",
  "react-dom",
  "@xyflow/react",
  "lucide-react",
  "react-markdown",
  "remark-gfm",
  "@tiptap/react",
  "@tiptap/starter-kit",
  "@tiptap/extension-table",
  "@tiptap/extension-link",
  "@tiptap/core",
  "@tiptap/pm",
];
const supportedCanvasPackages = [
  "@napi-rs/canvas-darwin-arm64",
  "@napi-rs/canvas-linux-x64-gnu",
  "@napi-rs/canvas-win32-x64-msvc",
];
const seen = new Set();
const sections = [];
const missingLicenses = [];
const supplemental = (name) =>
  fs.readFileSync(
    path.join(projectRoot, "resources", "licenses", name),
    "utf8",
  );

function locate(name, from) {
  let directory = from;
  for (;;) {
    const candidate = path.join(
      directory,
      "node_modules",
      name,
      "package.json",
    );
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function licenseFiles(base, relative = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(base, relative), {
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink() || entry.name === "node_modules") continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...licenseFiles(base, child));
    else if (/^(licen[sc]e|copying|notice)([._-]|$)/i.test(entry.name))
      files.push(child);
  }
  return files.sort();
}

function licenseText(manifest, base) {
  const key = `${manifest.name}@${manifest.version}`;
  let text = licenseFiles(base)
    .map(
      (file) =>
        `[${file.split(path.sep).join("/")}]\n${fs.readFileSync(path.join(base, file), "utf8")}`,
    )
    .join("\n\n");
  if (!text && ["hash.js@1.1.7", "isarray@1.0.0"].includes(key)) {
    const readme = fs.readFileSync(path.join(base, "README.md"), "utf8");
    const start = readme.search(/^#{1,6}\s+LICENSE\s*$/im);
    if (start !== -1)
      text = `[README.md license section]\n${readme.slice(start)}`;
  }
  if (key === "saxes@6.0.0") text = supplemental("saxes-6.0.0-LICENSE.txt");
  if (key === "tr46@0.0.3") text = supplemental("tr46-MIT.txt");
  if (key === "@tesseract.js-data/eng@1.0.0") {
    text =
      "The npm wrapper metadata declares MIT, but its bundled .traineddata files " +
      "are distributed by naptha/tessdata under Apache-2.0. The following is " +
      "the full upstream trained-data license (see resources/licenses/README.md).\n\n" +
      supplemental("tessdata-APACHE-2.0.txt");
  }
  if (!text && manifest.name.startsWith("@napi-rs/canvas-")) {
    const parent = locate("@napi-rs/canvas", projectRoot);
    const canvasManifest = JSON.parse(
      fs.readFileSync(path.join(parent, "package.json"), "utf8"),
    );
    if (manifest.version !== canvasManifest.version)
      throw new Error(`Native canvas license version mismatch: ${key}`);
    text = fs.readFileSync(path.join(parent, "LICENSE"), "utf8");
  }
  if (!text.trim()) missingLicenses.push(key);
  return text.trim();
}

function add(manifest, text) {
  const key = `${manifest.name}@${manifest.version}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const repository =
    typeof manifest.repository === "string"
      ? manifest.repository
      : manifest.repository?.url || "";
  const license =
    manifest.name === "@tesseract.js-data/eng"
      ? "Apache-2.0 (trained data); npm wrapper metadata declares MIT"
      : manifest.license || "See included license text";
  sections.push(`${key}\nLicense: ${license}\n${repository}\n\n${text}`);
  return true;
}

function visit(name, from = projectRoot, optional = false) {
  const base = locate(name, from);
  if (!base) {
    if (!optional)
      throw new Error(`Required runtime package is missing: ${name}`);
    return;
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(base, "package.json"), "utf8"),
  );
  if (seen.has(`${manifest.name}@${manifest.version}`)) return;
  add(manifest, licenseText(manifest, base));
  for (const dependency of Object.keys(manifest.dependencies || {}))
    visit(dependency, base);
  for (const dependency of Object.keys(manifest.optionalDependencies || {}))
    visit(dependency, base, true);
}

roots.forEach((name) => visit(name));
const canvasBase = locate("@napi-rs/canvas", projectRoot);
const canvas = JSON.parse(
  fs.readFileSync(path.join(canvasBase, "package.json"), "utf8"),
);
for (const name of supportedCanvasPackages) {
  const version = canvas.optionalDependencies[name];
  if (!version || version !== canvas.version)
    throw new Error(`Review native canvas license mapping for ${name}.`);
  add(
    { ...canvas, name, version },
    fs.readFileSync(path.join(canvasBase, "LICENSE"), "utf8").trim(),
  );
}
add(
  {
    name: "Skia (native canvas dependency)",
    version: "1fdbea293a53b270e3f5e74c92cc6670d68412ff",
    license: "BSD-3-Clause",
    repository: "https://github.com/google/skia",
  },
  supplemental("skia-BSD.txt").trim(),
);

if (missingLicenses.length)
  throw new Error(
    `Missing full license text: ${missingLicenses.join(", ")}. Add verified license supplements before release.`,
  );
fs.mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
fs.writeFileSync(
  path.join(projectRoot, "docs", "THIRD-PARTY-NOTICES.txt"),
  "ACADIA — THIRD-PARTY SOFTWARE NOTICES\n\n" +
    "Electron and Chromium notices are included with the application runtime.\n" +
    "The following notices cover the application and renderer npm dependency graph, " +
    "supported native canvas packages, bundled PDF fonts/codecs, and OCR language data.\n" +
    "Verified upstream supplements and provenance are retained in resources/licenses.\n\n" +
    sections.sort().join("\n\n" + "=".repeat(78) + "\n\n") +
    "\n",
);
console.log(
  `Wrote ${sections.length} package/component notices with full license text.`,
);
