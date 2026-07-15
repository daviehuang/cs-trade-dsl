// BFF（Node）—— 中台校验服务。前端提交交易 → 这里重算并裁决是否接受。
// 注：本 BFF 用 Node 跑【同一份引擎】做权威重算（ADR-1 路线 B：UI/BFF 共用同一 JS 内核）。
//     生产中若权威方为 Java 中台，则把同一内核编译到 JVM 复算，结论一致。
// 【动态规则】：不写死某套规则——按提交里的 ruleSetId 运行时从规则仓库拉取并现场编译校验
//     （见 validate.js）。与前端各端「运行时按 feature 加载」对称：规则不编译进服务端。
import { createServer } from "http";
import { validateSubmission } from "./validate.js";

const PORT = 8787;

const server = createServer(async (req, res) => {
  // 允许 file:// 页面跨源调用
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "POST" && req.url === "/api/settle") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const result = await validateSubmission(payload);
        const tag = result.verdict === "ACCEPT" ? "✅ ACCEPT" : "⛔ " + result.verdict;
        console.log(`[${new Date().toISOString()}] /api/settle [${result.ruleSetId}] → ${tag}` +
          (result.divergences.length ? `  篡改字段: ${result.divergences.map((d) => d.field).join(", ")}` : ""));
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: String(e && e.message || e) }));
      }
    });
    return;
  }
  res.writeHead(404); res.end("not found");
});

server.listen(PORT, () => {
  console.log(`🏦 BFF 中台校验服务已启动 → http://localhost:${PORT}/api/settle`);
  console.log("   等待前端提交…（前端用同一引擎计算，本服务用原始输入权威重算并比对）");
});
