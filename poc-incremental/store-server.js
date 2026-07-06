// 文件式规则仓库服务（纯 Node，无第三方依赖）—— 编辑器产出 ↔ 仓库文件 ↔ 运行时页 的中枢。
//   规则/库/页面/数据/feature 各以 JSON 文件存于 store/ 子目录；catalog 由扫目录得出（无 index，免漂移）。
//   与 bff（:8787 中台校验）职责分离，本服务只管存取。
import { createServer } from "node:http";
import { readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STORE_ROOT, ensureDirs, isEmpty, seedStore } from "./seed-store.mjs";

const PORT = 8788;
const HERE = dirname(fileURLToPath(import.meta.url));

// 资源名 → 子目录
const DIRS = { library: "libraries", ruleset: "rulesets", page: "pages", data: "data", feature: "features" };

// 文件名白名单：先解码（ref 里的 @ 可能被编码成 %40），只放行字母数字与 @._-（ref 如 commonFx@1.0.0）；拒绝路径穿越
const safeName = (x) => {
  let s; try { s = decodeURIComponent(String(x ?? "")); } catch { return null; }
  return (/^[\w@.\-]+$/.test(s) && !s.includes("..")) ? s : null;
};

const fileOf = (kind, id) => join(STORE_ROOT, DIRS[kind], `${id}.json`);
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, o) => writeFile(p, JSON.stringify(o, null, 2) + "\n", "utf8");
const listIds = async (kind) => {
  try { return (await readdir(join(STORE_ROOT, DIRS[kind]))).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)); }
  catch { return []; }
};

// 汇总目录清单（读每个文件抽取摘要）
async function buildCatalog() {
  const summ = async (kind, pick) => {
    const out = [];
    for (const id of await listIds(kind)) {
      try { out.push({ id, ...pick(await readJson(fileOf(kind, id))) }); }
      catch { out.push({ id, broken: true }); }
    }
    return out;
  };
  return {
    libraries: await summ("library", (o) => ({ ruleSetId: o.ruleSetId, version: o.version, status: o.status ?? "—", modules: Object.keys(o.modules ?? {}) })),
    rulesets: await summ("ruleset", (o) => ({ ruleSetId: o.ruleSetId, version: o.version, status: o.status ?? "—", rules: (o.rules ?? []).length })),
    pages: await summ("page", (o) => ({ title: o.title ?? "", ruleSetRef: o.ruleSetRef ?? "" })),
    features: await summ("feature", (o) => ({ title: o.title ?? "", ruleSet: o.ruleSet, page: o.page, data: o.data })),
  };
}

// 运行时一次拉齐：feature → ruleSet → 解析 imports → page + data
async function buildBundle(featureId) {
  const feature = await readJson(fileOf("feature", featureId));
  const ruleSet = await readJson(fileOf("ruleset", feature.ruleSet));
  const imports = {};
  for (const imp of ruleSet.imports ?? []) {
    const ref = safeName(imp.ref);
    if (!ref) continue;
    imports[imp.ref] = await readJson(fileOf("library", imp.ref));
  }
  const pageDef = await readJson(fileOf("page", feature.page));
  const data = await readJson(fileOf("data", feature.data));
  return { feature, ruleSet, imports, pageDef, data };
}

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => resolve(b)); req.on("error", reject);
});

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);       // ["api", <kind>, <id?>]
  try {
    if (parts[0] !== "api") return json(res, 404, { error: "not found" });

    // GET /api/catalog
    if (parts[1] === "catalog" && req.method === "GET") return json(res, 200, await buildCatalog());

    // GET /api/bundle/:featureId
    if (parts[1] === "bundle" && req.method === "GET") {
      const id = safeName(parts[2]);
      if (!id) return json(res, 400, { error: "bad feature id" });
      return json(res, 200, await buildBundle(id));
    }

    // /api/<kind>/<id>
    const kind = Object.keys(DIRS).find((k) => k === parts[1]);
    if (kind) {
      const id = safeName(parts[2]);
      if (!id) return json(res, 400, { error: "bad id" });
      const path = fileOf(kind, id);
      if (req.method === "GET") return json(res, 200, await readJson(path));
      if (req.method === "PUT") {
        const obj = JSON.parse(await readBody(req));
        await writeJson(path, obj);
        console.log(`[${new Date().toISOString()}] PUT ${kind}/${id}`);
        return json(res, 200, { ok: true, kind, id });
      }
      if (req.method === "DELETE") {
        await unlink(path).catch(() => {});
        console.log(`[${new Date().toISOString()}] DELETE ${kind}/${id}`);
        return json(res, 200, { ok: true, kind, id });
      }
    }
    return json(res, 404, { error: "not found", path: url.pathname });
  } catch (e) {
    const code = e?.code === "ENOENT" ? 404 : 400;
    return json(res, code, { error: String(e?.message || e) });
  }
});

// 启动：确保目录存在；若空库则自动种子化，让开箱即用
await ensureDirs();
if (await isEmpty()) {
  const r = await seedStore();
  console.log("🌱 空库，已自动种子化：", r.feature, "+", r.libRefs.length, "个库");
}
server.listen(PORT, () => {
  console.log(`🗄️  规则仓库服务已启动 → http://localhost:${PORT}/api/catalog`);
  console.log(`   store 根目录：${join(HERE, "store")}`);
});
