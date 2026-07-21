// 种子脚本：把仓库外现有的规则/库/页面/数据落进 store/，让文件式仓库开箱即有一笔完整交易。
//   直接运行：node seed-store.mjs        （幂等：覆盖写）
//   也被 store-server.js 在 store/ 为空时自动调用。
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const STORE_ROOT = join(HERE, "store");
export const SUBDIRS = ["libraries", "rulesets", "pages", "data", "features"];

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, o) => writeFile(p, JSON.stringify(o, null, 2) + "\n", "utf8");

export async function ensureDirs(root = STORE_ROOT) {
  for (const d of SUBDIRS) await mkdir(join(root, d), { recursive: true });
}

// store/ 是否已有 feature（判定"空库"用）
export async function isEmpty(root = STORE_ROOT) {
  try { return (await readdir(join(root, "features"))).filter((f) => f.endsWith(".json")).length === 0; }
  catch { return true; }
}

// 把 poc-incremental 下现有 JSON 铺进仓库
export async function seedStore(root = STORE_ROOT) {
  await ensureDirs(root);

  // 1) 公共库（ref = ruleSetId@version，取自文件内容）
  const libFiles = ["commonFx.json", "commonParty.json", "commonMixPayment.json", "commonCharge.json"];
  const libRefs = [];
  for (const f of libFiles) {
    const lib = await readJson(join(HERE, f));
    const ref = `${lib.ruleSetId}@${lib.version}`;
    await writeJson(join(root, "libraries", `${ref}.json`), lib);
    libRefs.push(ref);
  }

  // 2) 场景规则集
  const rs = await readJson(join(HERE, "lc-rules.json"));
  const rsRef = `${rs.ruleSetId}@${rs.version}`;
  await writeJson(join(root, "rulesets", `${rsRef}.json`), rs);

  // 3) 交易页面 PageDef（沿用 angular 样本里那份，模拟"页面编辑器产出"）
  const page = await readJson(join(HERE, "angular-lc-sample/src/assets/pages/lcSettlement.page.json"));
  const pageId = rs.ruleSetId;                       // 用规则集 id 作页面 id（一笔交易一页）
  await writeJson(join(root, "pages", `${pageId}.json`), page);

  // 4) 交易初始/测试数据
  const data = await readJson(join(HERE, "lc-data.json"));
  await writeJson(join(root, "data", `${pageId}.json`), data);

  // 5) feature 清单（"按 feature 拉取"的装配单元）
  const feature = {
    featureId: rs.ruleSetId,
    title: page.title || `${rs.ruleSetId} 交易`,
    ruleSet: rsRef,
    page: pageId,
    data: pageId,
  };
  await writeJson(join(root, "features", `${feature.featureId}.json`), feature);

  // 6) 计费示例 feature（多字段取数：commonCharge.chargeCalc → chargeService 一次返回 base/tax/fee）
  const chgRs = await readJson(join(HERE, "chargeDemo-rules.json"));
  const chgRef = `${chgRs.ruleSetId}@${chgRs.version}`;
  await writeJson(join(root, "rulesets", `${chgRef}.json`), chgRs);
  await writeJson(join(root, "pages", `${chgRs.ruleSetId}.json`), await readJson(join(HERE, "chargeDemo-page.json")));
  await writeJson(join(root, "data", `${chgRs.ruleSetId}.json`), await readJson(join(HERE, "chargeDemo-data.json")));
  await writeJson(join(root, "features", `${chgRs.ruleSetId}.json`), {
    featureId: chgRs.ruleSetId, title: "计费示例（多字段取数）", ruleSet: chgRef, page: chgRs.ruleSetId, data: chgRs.ruleSetId,
    mocks: { chargeService: { delayMs: 400, rows: [
      { when: { productType: "LC", tier: "gold" }, values: { base: "120.00", tax: "60.00", fee: "15.00" } },
      { when: { productType: "LC", tier: "silver" }, values: { base: "100.00", tax: "60.00", fee: "15.00" } },
      { when: { productType: "LC" }, values: { base: "80.00", tax: "60.00", fee: "15.00" } },
    ] } },
  });

  return { libRefs, ruleSet: rsRef, page: pageId, feature: feature.featureId, extraFeatures: [chgRs.ruleSetId] };
}

// 作为脚本直接运行
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedStore().then((r) => {
    console.log("✅ 已种子化仓库 store/：");
    console.log("   库     ", r.libRefs.join("、"));
    console.log("   规则集 ", r.ruleSet);
    console.log("   页面   ", r.page, " 数据 ", r.page);
    console.log("   feature", r.feature);
  }).catch((e) => { console.error("种子化失败：", e); process.exit(1); });
}
