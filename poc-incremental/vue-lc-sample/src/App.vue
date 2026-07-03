<script setup lang="ts">
// Vue 样本：运行时解释同一份 lcSettlement PageDef + RuleSet。
//   与 React/Angular/HTML 样本证明同一件事：引擎 + PageDef + UI-IR 框架无关；
//   这里用 Vue 的响应式 + 渲染函数 kit（@udsl/ui-kit-vue）消费同一份 core 产出的 UINode。
import { computed, ref } from 'vue';
import { createSession } from '@udsl/engine';
import {
  PageDef, RuleSet, buildMeta, buildRootIR, hydratePage, lintPageDef,
} from '@udsl/ui-kit-core';
import { UiRenderer, useEngineSession } from '@udsl/ui-kit-vue';

import ruleSetJson from '../../lc-rules.json';
import commonFxJson from '../../commonFx.json';
import commonPartyJson from '../../commonParty.json';
import dataJson from '../../lc-data.json';
import pageDefJson from '../../angular-lc-sample/src/assets/pages/lcSettlement.page.json';
import { makeResolve } from './fx';

const ruleSet = ruleSetJson as unknown as RuleSet;
const pageDef = pageDefJson as unknown as PageDef;
const imports: Record<string, RuleSet> = {
  'commonFx@1.0.0': commonFxJson as unknown as RuleSet,
  'commonParty@1.0.0': commonPartyJson as unknown as RuleSet,
};
const resolve = makeResolve(600);
const meta = buildMeta(ruleSet, imports);
const lint = lintPageDef(pageDef, ruleSet, imports);
const errorCount = lint.filter((i) => i.level === 'error').length;
const warnCount = lint.filter((i) => i.level === 'warn').length;

const { ctx, getState, structVersion, version } = useEngineSession({ createSession, ruleSet, imports, data: dataJson, resolve });

const source = ref<'auto' | 'page'>('page');
const usePage = computed(() => source.value === 'page' && errorCount === 0);

// 结构变化（增删行）时重建 UI-IR；值/异步变化由 UiRenderer 内部 onTick 驱动重渲染。
const ir = computed(() => { void structVersion.value; return usePage.value ? hydratePage(pageDef, getState(), meta) : buildRootIR(getState(), meta); });

// anyPending 徽章随每次 tick 更新（读 version 建立响应式依赖）。
const pending = computed(() => { void version.value; return getState().anyPending; });
</script>

<template>
  <div class="app">
    <div class="top">🏦 <b>GlobalTrade Bank</b>
      <span class="tag">L/C 结算 · 增量引擎 · Vue 运行时解释（同一份 PageDef + RuleSet）</span>
    </div>

    <div class="feat">
      <span class="muted">运行时已加载 <code>{{ ruleSet.ruleSetId + '@' + ruleSet.version }}</code>
        · import <code>{{ Object.keys(imports).join('、') }}</code>
        · <b>Vue 渲染 kit（与 React/Angular/HTML 同一份 ui-kit-core）</b></span>
      <span :class="'status ' + (pending ? 'pending' : 'settled')">{{ pending ? '⏳ 异步取数中…' : '✅ 已结算' }}</span>
    </div>

    <div class="wrap">
      <div class="srcbar">
        <span class="lbl">界面来源：</span>
        <div class="seg">
          <button type="button" :class="source === 'auto' ? 'on' : ''" @click="source = 'auto'">模型自动生成</button>
          <button type="button" :class="source === 'page' ? 'on' : ''" @click="source = 'page'">自定义 PageDef</button>
        </div>
        <span v-if="source === 'page'" :class="'lint ' + (errorCount ? 'bad' : warnCount ? 'warn' : 'ok')">
          {{ errorCount ? `⛔ PageDef 校验 ${errorCount} 个错误 —— 已回退自动布局`
             : warnCount ? `⚠ PageDef 校验通过（${warnCount} 个提醒）` : '✔ PageDef 校验通过（lint）' }}
        </span>
        <span v-else class="muted">字段由运行时 RuleSet 的 <code>model.nodes</code> 自动生成</span>
      </div>

      <UiRenderer :ir="ir" :ctx="ctx" />
    </div>
  </div>
</template>
