import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");
const assets = {};
const catalogText = await readFile(resolve(root, "data/catalog.json"), "utf8");
const catalog = JSON.parse(catalogText);

assets["/catalog.js"] = {
  kind: "text",
  type: "text/javascript; charset=utf-8",
  body: `window.TABI_CATALOG = ${JSON.stringify(catalog)};`,
};

for (const name of ["index.html", "style.css", "app.js"]) {
  assets[`/${name}`] = {
    kind: "text",
    type: name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
    body: await readFile(resolve(root, "web", name), "utf8"),
  };
}
for (const name of ["tokyo.jpg", "osaka.jpg"]) {
  assets[`/${name}`] = { kind: "base64", type: "image/jpeg", body: (await readFile(resolve(root, "web", name))).toString("base64") };
}

const runtime = await readFile(resolve(root, "worker/runtime.js"), "utf8");
const manifest = await readFile(resolve(root, ".openai/hosting.json"), "utf8");
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
await writeFile(resolve(dist, "server/index.js"), `const ASSETS = ${JSON.stringify(assets)};\nconst CATALOG = ${JSON.stringify(catalog)};\n${runtime}`);
await writeFile(resolve(dist, ".openai/hosting.json"), manifest);
console.log(`Built ${dist}`);
