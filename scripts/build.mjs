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

for (const name of ["index.html", "home.css", "home.js", "memo-example.js", "classic.html", "style.css", "app.js"]) {
  assets[`/${name}`] = {
    kind: "text",
    type: name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
    body: await readFile(resolve(root, "web", name), "utf8"),
  };
}
for (const name of ["tokyo.jpg", "osaka.jpg"]) {
  assets[`/${name}`] = { kind: "base64", type: "image/jpeg", body: (await readFile(resolve(root, "web", name))).toString("base64") };
}

// shared/memo.js 是浏览器与 Worker 共用的备忘整理逻辑：页面以 /memo-shared.js 加载，Worker 直接拼接在前面。
const shared = await readFile(resolve(root, "shared/memo.js"), "utf8");
assets["/memo-shared.js"] = { kind: "text", type: "text/javascript; charset=utf-8", body: shared };
const runtime = await readFile(resolve(root, "worker/runtime.js"), "utf8");
const manifest = await readFile(resolve(root, ".openai/hosting.json"), "utf8");
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
await writeFile(resolve(dist, "server/index.js"), `const ASSETS = ${JSON.stringify(assets)};\nconst CATALOG = ${JSON.stringify(catalog)};\n${shared}\n${runtime}`);
await writeFile(resolve(dist, ".openai/hosting.json"), manifest);
// dist/public：同一批页面资源的文件版本。部署到 Cloudflare 时由平台直接提供，页面请求不经过 Worker；
// Worker 里内嵌的那份仍然保留，本地 dev-server 和 Codex Sites 用它。
await mkdir(resolve(dist, "public"), { recursive: true });
for (const [path, asset] of Object.entries(assets)) await writeFile(resolve(dist, "public", path.slice(1)), asset.kind === "base64" ? Buffer.from(asset.body, "base64") : asset.body);
console.log(`Built ${dist}`);
