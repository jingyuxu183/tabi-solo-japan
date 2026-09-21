import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [source, manifest] = await Promise.all([
  readFile(resolve(root, "dist/server/index.js"), "utf8"),
  readFile(resolve(root, "dist/.openai/hosting.json"), "utf8"),
]);
JSON.parse(manifest);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(typeof workerModule.default?.fetch, "function");
console.log("Artifact is valid ESM and exports default.fetch");
