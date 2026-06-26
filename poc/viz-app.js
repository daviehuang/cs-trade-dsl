// 可视化 UI 应用（浏览器端）。
// 直接调用内联进页面的真实内核 runRuleSet —— 与 PoC / BFF 用的是同一份 engine.js。
(function () {
  const RULESET = window.__RULESET__;
  const INIT = window.__INIT__;
  const $ = (s) => document.querySelector(s);
  const num = (x) => (x === null || x === undefined ? "—" : x);

  const PARENT_FIELDS = [
    { f: "limit", label: "额度 limit", type: "num" },
    { f: "maxCharge", label: "单笔上限 maxCharge", type: "num" },
    { f: "taxRate", label: "税率 taxRate", type: "num" },
    { f: "status", label: "状态 status", type: "text" },
    { f: "tier", label: "等级 tier", type: "text" },
  ];

  const state = { parent: {}, children: [] };
  PARENT_FIELDS.forEach((p) => (state.parent[p.f] = INIT[p.f] ?? ""));
  state.children = (INIT.children || []).map((c) => ({ amount: c.amount, rate: c.rate }));

  function buildRaw() {
    const raw = {};
    PARENT_FIELDS.forEach((p) => (raw[p.f] = state.parent[p.f]));
    raw.children = state.children.map((c) => ({ amount: c.amount, rate: c.rate }));
    return raw;
  }

  // ── 父字段表单 ──
  function renderParent() {
    $("#parent").innerHTML = PARENT_FIELDS.map(
      (p) => `<label class="field"><span>${p.label}</span>
        <input data-pfield="${p.f}" value="${state.parent[p.f] ?? ""}" /></label>`
    ).join("");
    $("#parent").querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", (e) => {
        state.parent[e.target.dataset.pfield] = e.target.value;
        updateOutputs();
      })
    );
  }

  // ── 子项表格 ──
  function renderChildren() {
    const rows = state.children
      .map(
        (c, i) => `<tr data-row="${i}">
        <td class="idx">${i + 1}</td>
        <td><input class="cinput" data-idx="${i}" data-field="amount" value="${c.amount}" /></td>
        <td><input class="cinput" data-idx="${i}" data-field="rate" value="${c.rate}" /></td>
        <td class="comp" data-idx="${i}" data-kind="charge">—</td>
        <td class="comp" data-idx="${i}" data-kind="fee">—</td>
        <td><button class="del" data-idx="${i}">✕</button></td>
      </tr>`
      )
      .join("");
    $("#childBody").innerHTML = rows;
    $("#childBody").querySelectorAll(".cinput").forEach((inp) =>
      inp.addEventListener("input", (e) => {
        state.children[+e.target.dataset.idx][e.target.dataset.field] = e.target.value;
        updateOutputs();
      })
    );
    $("#childBody").querySelectorAll(".del").forEach((b) =>
      b.addEventListener("click", (e) => {
        state.children.splice(+e.target.dataset.idx, 1);
        renderChildren();
        updateOutputs();
      })
    );
  }

  // ── 跑内核、刷新所有输出（不重建输入，保持焦点）──
  function updateOutputs() {
    let res;
    try {
      res = runRuleSet(RULESET, buildRaw());
    } catch (e) {
      $("#error").textContent = "求值错误: " + e.message;
      return;
    }
    $("#error").textContent = "";
    const tree = res.tree;

    // 子项计算列 + 超限高亮
    tree.children.forEach((c, i) => {
      const chargeCell = document.querySelector(`.comp[data-idx="${i}"][data-kind="charge"]`);
      const feeCell = document.querySelector(`.comp[data-idx="${i}"][data-kind="fee"]`);
      if (chargeCell) chargeCell.textContent = num(c.charge);
      if (feeCell) feeCell.textContent = num(c.fee);
      const row = document.querySelector(`tr[data-row="${i}"]`);
      if (row) {
        const over =
          c.charge !== null &&
          tree.maxCharge !== null &&
          new Decimal(c.charge).gt(new Decimal(tree.maxCharge));
        row.classList.toggle("overlimit", over);
      }
    });

    // 合计
    $("#total").textContent = num(tree.total);

    // 校验清单
    renderValidations(res.validations);
    if (res.warnings && res.warnings.length)
      $("#warnings").textContent = "告警: " + res.warnings.join(", ");
    else $("#warnings").textContent = "";

    // ── 中台复算（同一内核 = 路线 B）──
    const res2 = runRuleSet(RULESET, buildRaw());
    const consistent = JSON.stringify(res) === JSON.stringify(res2);
    const rejected = res2.validations.some((v) => !v.ok && v.severity === "error");
    $("#serverTotal").textContent = num(res2.tree.total);
    $("#serverVerdict").innerHTML = rejected
      ? '<span class="badge fail">拒绝交易</span>'
      : '<span class="badge pass">通过</span>';
    $("#consistency").innerHTML = consistent
      ? '<span class="badge pass">UI = 中台 · 零 drift ✅</span>'
      : '<span class="badge fail">检测到 drift ❌</span>';
  }

  function renderValidations(vals) {
    $("#validations").innerHTML = vals
      .map((v) => {
        const cls = v.ok ? "pass" : v.severity === "error" ? "fail" : "warn";
        const icon = v.ok ? "✅" : v.severity === "error" ? "❌" : "⚠️";
        return `<li class="vrow ${cls}">
          <span class="badge ${cls}">${icon} ${v.severity}</span>
          <code>${v.id}</code> <span class="scope">[${v.scope}]</span>
          ${v.ok ? '<span class="ok-text">通过</span>' : `<span class="msg">${v.message || ""}</span>`}
        </li>`;
      })
      .join("");
  }

  // ── 初始化 ──
  $("#addChild").addEventListener("click", () => {
    state.children.push({ amount: "0", rate: "0" });
    renderChildren();
    updateOutputs();
  });
  $("#rulesetDump").textContent = JSON.stringify(RULESET, null, 2);

  renderParent();
  renderChildren();
  updateOutputs();
})();
