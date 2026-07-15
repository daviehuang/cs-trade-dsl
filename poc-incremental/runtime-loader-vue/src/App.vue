<script setup lang="ts">
// 运行时加载器（Vue）：启动即从规则仓库拉目录，按 feature 一次拉齐 bundle。
//   本文件【零静态规则 import】——ruleSet/库/页面/数据全在运行时 fetch。
//   拿到 bundle 后交给 RuntimeView（:key=featureId 强制重挂 → 换 feature 即重建会话）。
import { markRaw, onMounted, ref } from 'vue';
import type { RuleSet, PageDef } from '@udsl/ui-kit-core';
import RuntimeView from './RuntimeView.vue';

interface FeatureSummary { id: string; title: string; page: string; }
interface Bundle { feature: FeatureSummary; ruleSet: RuleSet; imports: Record<string, RuleSet>; pageDef: PageDef; data: any; }

const api = (p: string) => fetch(p).then((r) => { if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`); return r.json(); });

const features = ref<FeatureSummary[]>([]);
const featureId = ref('');
const bundle = ref<Bundle | null>(null);
const error = ref('');

async function loadFeature(id: string) {
  bundle.value = null; error.value = '';
  // markRaw：bundle 是引擎/core 的纯数据输入，不能被 Vue 深度响应式代理包裹
  //   （代理会让 buildMeta 取不到 model 字段的 label，导致标签回落成字段名）。
  try { bundle.value = markRaw(await api('/api/bundle/' + encodeURIComponent(id)) as Bundle); }
  catch (e: any) { error.value = `加载 feature「${id}」失败：${e.message}`; }
}
function onSelect(e: Event) { featureId.value = (e.target as HTMLSelectElement).value; loadFeature(featureId.value); }

onMounted(async () => {
  try {
    const cat = await api('/api/catalog');
    features.value = cat.features ?? [];
    if (features.value[0]) { featureId.value = features.value[0].id; loadFeature(featureId.value); }
  } catch (e: any) {
    error.value = '加载仓库目录失败：' + e.message + '（store-server 是否已启动？node store-server.js）';
  }
});
</script>

<template>
  <div class="app">
    <div class="top">🛰️ <b>运行时加载器 · Vue</b>
      <span class="tag">启动即从规则仓库按 feature 拉取 · 零静态 import · ui-kit-vue 渲染</span>
    </div>

    <div class="feat">
      <span class="srcbar" style="margin:0"><span class="lbl">交易 feature：</span>
        <span class="seg">
          <select :value="featureId" @change="onSelect">
            <option v-if="!features.length" value="">（无）</option>
            <option v-for="f in features" :key="f.id" :value="f.id">{{ f.title || f.id }}</option>
          </select>
        </span>
      </span>
    </div>

    <div v-if="error" class="err">⛔ {{ error }}</div>
    <div v-else-if="!bundle" class="loading">⏳ 正在从仓库拉取规则与页面…</div>
    <RuntimeView v-else :key="featureId" :bundle="bundle" />
  </div>
</template>
