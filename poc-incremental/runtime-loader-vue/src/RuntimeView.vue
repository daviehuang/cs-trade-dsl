<script setup lang="ts">
// 拿到运行时 bundle 后才建引擎会话（与 React runtime-loader 的 RuntimeView 等价）。
//   父组件用 :key=featureId 保证换 feature 时本组件重挂 → useEngineSession 重跑。
import { computed } from 'vue';
import { createSession } from '@udsl/engine';
import { PageDef, RuleSet, buildMeta, buildRootIR, hydratePage, lintPageDef } from '@udsl/ui-kit-core';
import { UiRenderer, useEngineSession } from '@udsl/ui-kit-vue';
import { makeResolve } from './fx';

interface Bundle { feature: any; ruleSet: RuleSet; imports: Record<string, RuleSet>; pageDef: PageDef; data: any; }
const props = defineProps<{ bundle: Bundle }>();

const resolve = makeResolve(600);
const { ruleSet, imports, pageDef, data } = props.bundle;
const rsRef = ruleSet.ruleSetId + '@' + (ruleSet as any).version;

const { ctx, getState, structVersion, version } = useEngineSession({ createSession, ruleSet, imports, data, resolve });
const meta = buildMeta(ruleSet, imports);
const lint = lintPageDef(pageDef, ruleSet, imports);
const errorCount = lint.filter((i) => i.level === 'error').length;
const warnCount = lint.filter((i) => i.level === 'warn').length;
const usePage = errorCount === 0;

// 结构变化（增删行）时重建 UI-IR；值/异步变化由 UiRenderer 内部 onTick 驱动重渲染。
const ir = computed(() => { void structVersion.value; return usePage ? hydratePage(pageDef, getState(), meta) : buildRootIR(getState(), meta); });
const pending = computed(() => { void version.value; return getState().anyPending; });
</script>

<template>
  <div class="wrap">
    <div class="feat" style="margin:0 auto 10px">
      <span class="muted">运行时已从仓库加载 <code>{{ rsRef }}</code>
        · import <code>{{ Object.keys(imports).join('、') || '无' }}</code>
        · 页面 <code>{{ bundle.feature?.page }}</code></span>
      <span :class="'status ' + (pending ? 'pending' : 'settled')" style="margin-left:auto">{{ pending ? '⏳ 异步取数中…' : '✅ 已结算' }}</span>
    </div>
    <div class="srcbar">
      <span :class="usePage ? ('lint ' + (warnCount ? 'warn' : 'ok')) : 'lint bad'">
        {{ usePage ? (warnCount ? `⚠ PageDef 校验通过（${warnCount} 提醒）` : '✔ PageDef 校验通过（lint）')
           : `⛔ PageDef ${errorCount} 个错误 —— 已回退模型自动布局` }}
      </span>
    </div>
    <UiRenderer :ir="ir" :ctx="ctx" />
  </div>
</template>
