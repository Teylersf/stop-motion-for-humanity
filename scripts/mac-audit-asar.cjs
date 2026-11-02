// SPDX-License-Identifier: GPL-3.0-or-later
"use strict";
// Usage: node scripts/mac-audit-asar.cjs --app BUNDLE --output out/validation/NEW.json --core-revision COMMIT [--build-log LOG]
// Read-only packaged-code audit. No extraction to disk, app execution, build or device access.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
if (process.argv.includes("--help")) { console.log("Usage: node scripts/mac-audit-asar.cjs --app BUNDLE --output out/validation/NEW.json --core-revision COMMIT [--build-log LOG]"); process.exit(0); }
const asar = require(path.join(root, "node_modules/@electron/asar"));
function optionalValue(flag) { const index = process.argv.indexOf(flag); return index < 0 ? null : value(flag); }
function value(flag) { const index = process.argv.indexOf(flag); if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${flag}`); return process.argv[index + 1]; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function sha(data) { return crypto.createHash("sha256").update(data).digest("hex"); }
function record(file) { const data = fs.readFileSync(file); return { bytes: data.length, sha256: sha(data) }; }
function relative(file) { return path.relative(root, file).split(path.sep).join("/"); }
function display(file) { const name = relative(file); return name !== ".." && !name.startsWith("../") ? name : path.basename(file); }
function clean(value) { return String(value).split(root).join("<source-root>").split(os.homedir()).join("<home>"); }
function gitFile(revision, name) { return execFileSync("/usr/bin/git", ["show", `${revision}:${name}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 }); }
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name); assert(!item.isSymbolicLink(), "Unexpected symlink in local compiled artifacts");
    return item.isDirectory() ? walk(file) : [relative(file)];
  });
}
function main() {
  const app = path.resolve(value("--app")), output = path.resolve(value("--output"));
  const productRevision = execFileSync("/usr/bin/git", ["rev-parse", "--verify", "--end-of-options", `${value("--core-revision")}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
  const logArgument = optionalValue("--build-log"), log = logArgument ? path.resolve(logArgument) : null;
  assert(output.startsWith(path.join(root, "out/validation") + path.sep) && !fs.existsSync(output), "Receipt must be NEW below ignored out/validation");
  const allowedOutput = fs.realpathSync(path.join(root, "out/validation")), outputParent = fs.realpathSync(path.dirname(output)), appReal = fs.realpathSync(app);
  assert(outputParent === allowedOutput || outputParent.startsWith(allowedOutput + path.sep), "Receipt parent must remain below ignored out/validation");
  assert(outputParent !== appReal && !outputParent.startsWith(appReal + path.sep), "Read-only app inspection cannot write a receipt inside the application");
  const archive = path.join(app, "Contents/Resources/app.asar");
  assert(fs.lstatSync(archive).isFile() && !fs.lstatSync(archive).isSymbolicLink(), "Expected regular application ASAR");
  const result = { schemaVersion: 1, app: "Stop Motion for Humanity", status: "running", kind: "asar-to-source-binding",
    scope: ["Read-only ASAR inspection; no app execution, build, extraction to disk or camera/private-project access", "Binds packaged code to this checkout, the chosen core commit and current compiled renderer artifacts", "Run separately against each final application artifact; this receipt does not establish installation, save/quit/reopen lifecycle or UI approval"],
    coreRevision: productRevision, checkoutRevisionAtInspection: execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    applicationBundle: display(app), applicationLocation: app.startsWith(root + path.sep) ? "source-owned build artifact" : "external read-only application bundle", startedAt: new Date().toISOString(), driver: record(__filename), asarReader: { package: "@electron/asar", version: require(path.join(root, "node_modules/@electron/asar/package.json")).version },
    asarBefore: record(archive), buildLog: log ? { name: display(log), ...record(log) } : null, runtimeFiles: [], rendererFiles: [], sourceMapBindings: [] };
  const observedSources = new Map();
  function sourceBytes(name) {
    const data = fs.readFileSync(path.join(root, name));
    if (!observedSources.has(name)) observedSources.set(name, { name, ...record(path.join(root, name)) });
    return data;
  }
  function packedBytes(name) {
    const entry = asar.statFile(archive, name, false);
    assert(!entry.link && !entry.files && !entry.unpacked, `Required runtime entry is not a regular packed file: ${name}`);
    const data = asar.extractFile(archive, name, false);
    if (entry.integrity) assert(entry.integrity.algorithm === "SHA256" && entry.integrity.hash === sha(data), `ASAR integrity table differs: ${name}`);
    return data;
  }
  function exact(name, frozen) {
    const local = sourceBytes(name), packed = packedBytes(name);
    assert(local.equals(packed), `Packaged bytes differ from current artifact/source: ${name}`);
    if (frozen) assert(local.equals(gitFile(productRevision, name)), `Current source differs from product freeze: ${name}`);
    return { name, bytes: local.length, sourceSha256: sha(local), packagedSha256: sha(packed), exactByteMatch: true, ...(frozen ? { sourceMatchesProductCommit: true } : {}) };
  }
  try {
    if (log) {
      const buildText = fs.readFileSync(log, "utf8");
      assert(buildText.includes("[mac-media] Final bundled manifests/tools match exact source pins; outer app deep/strict verified"), "Build log lacks completed afterSign guard");
      result.completedBuildGuardObserved = true;
    } else result.completedBuildGuardObserved = "No build log supplied; file/source binding only";
    const all = asar.listPackage(archive).map(name => name.replace(/^\//, ""));
    assert(all.every(name => !name.startsWith("out/") && !name.includes(".humanity") && !name.includes("private-camera")), "Unexpected project/private-evidence path in ASAR");
    const runtimeNames = all.filter(name => name.startsWith("desktop/") && !asar.statFile(archive, name, false).files).sort();
    for (const name of ["desktop/main.cjs", "desktop/preload.cjs", "desktop/close.cjs", "desktop/store.cjs", "desktop/export.cjs"]) assert(runtimeNames.includes(name), `Missing required close-fix runtime: ${name}`);
    for (const name of runtimeNames) result.runtimeFiles.push(exact(name, true));
    result.profileCatalog = exact("assets/export-profiles.json", true);
    // Electron-builder deliberately removes only development fields and emits
    // JSON.stringify(..., null, 2), without a trailing newline.
    const sourcePackageBytes = sourceBytes("package.json"), packageBytes = packedBytes("package.json"), originalPackage = JSON.parse(sourcePackageBytes);
    assert(sourcePackageBytes.equals(gitFile(productRevision, "package.json")), "package.json differs from product freeze");
    const expectedPackage = { ...originalPackage }; delete expectedPackage.scripts; delete expectedPackage.devDependencies;
    const expectedBytes = Buffer.from(JSON.stringify(expectedPackage, null, 2));
    assert(packageBytes.equals(expectedBytes), "Packaged package.json differs from exact expected production transformation");
    result.packageJson = { exactRawSourceBytes: packageBytes.equals(sourcePackageBytes), exactExpectedProductionBytes: true,
      sourceSha256: sha(sourcePackageBytes), packagedSha256: sha(packageBytes), expectedProductionSha256: sha(expectedBytes),
      removedSourceFields: ["scripts", "devDependencies"], transformation: "Pinned electron-builder production metadata cleanup; JSON.stringify with two-space indent and no trailing newline",
      allOtherFieldsExactlyPreserved: true, sourceMatchesProductCommit: true };
    const localDist = walk(path.join(root, "dist")).sort();
    const packagedDist = all.filter(name => name.startsWith("dist/") && !asar.statFile(archive, name, false).files).sort();
    assert(JSON.stringify(localDist) === JSON.stringify(packagedDist), "Missing or stale extra compiled renderer artifact in ASAR");
    assert(localDist.includes("dist/index.html") && localDist.some(name => /\.js$/.test(name)) && localDist.some(name => /\.css$/.test(name)), "Incomplete current renderer artifact set");
    for (const name of localDist) result.rendererFiles.push(exact(name, false));
    result.distFileSetExactlyMatches = true;
    const index = packedBytes("dist/index.html").toString("utf8"), referenced = [...index.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
    for (const url of referenced.filter(url => /\.(?:js|css)(?:\?|$)/.test(url))) {
      const name = path.posix.normalize("dist/" + url.replace(/^\.\//, "").replace(/^\//, ""));
      assert(packagedDist.includes(name), "index.html references an absent compiled asset");
    }
    result.indexAssetReferencesResolved = true;
    for (const mapName of localDist.filter(name => name.endsWith(".js.map"))) {
      const map = JSON.parse(packedBytes(mapName)); assert(map.sources.length === map.sourcesContent.length, "Incomplete renderer source-map source content");
      for (let i = 0; i < map.sources.length; i++) {
        const resolved = path.resolve(root, path.dirname(mapName), map.sources[i]);
        if (!resolved.startsWith(root + path.sep) || resolved.includes(path.sep + "node_modules" + path.sep)) continue;
        const name = relative(resolved); if (!name.startsWith("src/") && name !== "assets/export-profiles.json") continue;
        const current = sourceBytes(name), mapped = Buffer.from(map.sourcesContent[i]);
        assert(current.equals(mapped), `Renderer source map contains stale first-party code: ${name}`);
        assert(current.equals(gitFile(productRevision, name)), `Renderer source differs from product freeze: ${name}`);
        result.sourceMapBindings.push({ name, sourceMap: mapName, bytes: current.length, sourceSha256: sha(current), sourceMapContentSha256: sha(mapped), exactSourceContentMatch: true, sourceMatchesProductCommit: true });
      }
    }
    for (const name of ["src/App.tsx", "src/components/close-save.ts", "src/core/render.ts"]) assert(result.sourceMapBindings.some(item => item.name === name), `No current source binding for critical renderer module: ${name}`);
    result.rendererSourceBindingScope = "JavaScript sourcesContent equals current/product-commit first-party modules; compiled CSS/index/JS/maps equal the current cold-build dist artifacts exactly. No independent rebuild performed.";
    result.noStaleRuntimeOrCompiledArtifactDetected = true; result.appExecuted = false; result.cameraOrPrivateProjectsAccessed = false; result.status = "passed";
  } catch (error) { result.status = "failed"; result.failure = { message: clean(error.message) }; }
  finally {
    result.driverAfter = record(__filename); result.driverUnchanged = JSON.stringify(result.driver) === JSON.stringify(result.driverAfter);
    result.asarAfter = record(archive); result.asarUnchanged = JSON.stringify(result.asarBefore) === JSON.stringify(result.asarAfter);
    result.observedSourceFiles = [...observedSources.values()];
    result.observedSourceFilesUnchanged = result.observedSourceFiles.every(item => JSON.stringify(record(path.join(root, item.name))) === JSON.stringify({ bytes: item.bytes, sha256: item.sha256 }));
    if (!result.driverUnchanged || !result.asarUnchanged || !result.observedSourceFilesUnchanged) { result.status = "failed"; result.failure = { message: "Archive or compared sources changed during inspection" }; }
    result.completedAt = new Date().toISOString(); fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, receipt: display(output), sha256: record(output).sha256, runtimeFiles: result.runtimeFiles.length, rendererFiles: result.rendererFiles.length, firstPartySourceBindings: result.sourceMapBindings.length, packageJsonExactSource: result.packageJson?.exactRawSourceBytes, packageJsonExactExpectedProduction: result.packageJson?.exactExpectedProductionBytes, failure: result.failure }));
  }
  if (result.status !== "passed") process.exitCode = 1;
}
try { main(); } catch (error) { console.error(clean(error.message)); process.exitCode = 1; }
