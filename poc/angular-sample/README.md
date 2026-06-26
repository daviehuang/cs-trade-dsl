# Angular 接入示例 —— 运行时动态加载 RuleSet（参数化系统）

演示 **参数化系统** 的正确接入方式：**规则不编译进前端包**，而是在页面加载时按"功能(feature)"
**运行时从规则仓库动态拉取 RuleSet**；表单再依据 `ruleSet.model` **动态生成**。
改规则只需更新规则仓库，前端无需重新编译。

## 运行

```bash
cd poc/angular-sample
npm install
npm start          # http://localhost:4200
```

页面顶部可切换「功能」：
- **FX 报价** —— 主记录 + 子项（有 children），多条校验/计算；
- **贷款手续费** —— 单记录（无 children），字段完全不同。

切换功能时，会**重新拉取对应 RuleSet 并重建表单**——同一套代码、零改动适配不同规则。

## 这版如何满足"参数化 + 运行时加载"

### 1. 规则不进包，运行时拉取（`rule-repository.service.ts`）

```ts
@Injectable({ providedIn: 'root' })
export class RuleRepositoryService {
  private http = inject(HttpClient);
  load(featureId: string): Observable<RuleSet> {
    return this.http.get<RuleSet>(`assets/rules/${featureId}.json`);
    // 生产：`${API}/rulesets/${featureId}@active`（带版本/缓存/灰度）
  }
}
```

> 已验证：构建产物 `main.js` 中**不含**规则内容（`totalPipeline`/`E_CHARGE_CEILING` 等 grep 计数为 0），
> 规则只存在于 `assets/rules/*.json`，运行时经 HTTP 获取。

### 2. 表单依据 model 动态生成（`app.component.ts` 的 `buildForm`）

不再为某个功能写死字段。拿到 RuleSet 后：
- 读 `model.nodes[root].fields` → 非 `computed` 字段生成输入框、`computed` 字段只读展示；
- 若有 `children` → 生成可增删的子项表格，列同样由子节点字段推导。

所以**换功能 = 换 RuleSet = 换表单**，组件代码一行不改。

### 3. 引擎仍是同一个（`dsl-engine.service.ts`）

```ts
this.result = this.dsl.run(this.ruleSet, this.form.getRawValue());
```

控件名与字段名一致、子数组名与 `model.children.name` 一致 → 表单值直接喂引擎。

## 数据流

```
选择功能 featureId
      │  HttpClient
      ▼
规则仓库 assets/rules/{featureId}.json  ──► RuleSet（运行时获取，不在包里）
      │
      ▼  buildForm(ruleSet.model)
动态表单（字段由 model 推导）
      │  valueChanges
      ▼  DslEngineService.run(ruleSet, formValue)
引擎（同一份内核）──► { tree 计算结果, validations 校验 } ──► 绑定到界面
```

## 文件结构

```
angular-sample/
├── src/assets/rules/             # ★ 运行时拉取的规则（不编译进包）
│   ├── fxTradeRules.json         #   功能A：主+子
│   ├── fxTradeRules.sample.json  #   功能A 初始数据
│   ├── loanFee.json              #   功能B：单记录
│   └── loanFee.sample.json
├── src/app/
│   ├── dsl/{kernel.js,engine.js,engine.d.ts}   # 真实内核（单源）
│   ├── rule-repository.service.ts   # ★ 运行时拉取 RuleSet
│   ├── dsl-engine.service.ts        # 封装引擎
│   └── app.component.ts             # ★ 依据 model 动态建表单 + 实时计算校验
└── src/main.ts                      # provideHttpClient()
```

## 重要约定（后续所有示例都以此为前提）

> **RuleSet 永远是运行时数据，不是编译期常量。**
> 任何 UI（HTML/第三方/Angular/React/…）都应：① 按 featureId 从规则仓库拉取 RuleSet；
> ② 依 `model` 动态渲染；③ 调用引擎。规则的增改与前端发布解耦。
