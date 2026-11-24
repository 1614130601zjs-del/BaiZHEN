<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import Icon from '@/components/Icon.vue';
import { requestViaMainApi } from '@/api/client';
import { collectWorldInfoText, buildWorldbookTagMessages, cleanWorldbookTagOutput } from '@/autoTag/worldbookTag';
import { getContext } from '@/st/context';

const description = ref('');
const result = ref('');
const status = ref('');
const loading = ref(false);
const useWorldInfo = ref(true);
const worldNames = ref<string[]>([]);
const hasWorldInfoApi = computed(() => typeof getContext()?.getWorldInfoPrompt === 'function');
const canConvert = computed(() => !!description.value.trim() && !loading.value);

onMounted(() => {
  const ctx = getContext();
  worldNames.value = ctx?.getWorldInfoNames?.() ?? [];
});

async function convert() {
  if (!description.value.trim() || loading.value) return;
  loading.value = true;
  status.value = '正在读取世界书并转换…';
  try {
    const ctx = getContext();
    let worldInfo = '';
    if (useWorldInfo.value && ctx?.getWorldInfoPrompt) {
      try {
        const activated = await ctx.getWorldInfoPrompt([description.value.trim()], 1_000_000_000, true);
        worldInfo = collectWorldInfoText(activated);
      } catch (error) {
        status.value = '世界书读取失败，将仅使用输入描述继续转换…';
        console.warn('[柏宝绘] 世界书转 Tag：读取世界书失败', error);
      }
    }
    const messages = buildWorldbookTagMessages(description.value, worldInfo);
    const raw = await requestViaMainApi(messages, { source: '世界书转 Tag' });
    const cleaned = cleanWorldbookTagOutput(raw);
    if (!cleaned) throw new Error('模型没有返回有效 Tag');
    result.value = cleaned;
    status.value = worldInfo
      ? '转换完成，已参考本次描述实际触发的世界书内容。'
      : useWorldInfo.value
        ? '转换完成；本轮没有取得可用的世界书内容。'
        : '转换完成，未使用世界书。';
  } catch (error) {
    status.value = '转换失败：' + (error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

async function copyResult() {
  if (!result.value) return;
  const ctx = getContext() as { copyTextToClipboard?: (value: string) => Promise<void> } | undefined;
  if (ctx?.copyTextToClipboard) await ctx.copyTextToClipboard(result.value);
  else await navigator.clipboard?.writeText(result.value);
}
function applyToPrompt() {
  const field = document.querySelector<HTMLTextAreaElement>('#bbi-prompt, #ql-prompt, textarea[name="prompt"]');
  if (!field || !result.value) {
    status.value = '已转换；当前页面没有可识别的提示词输入框，请复制后手动粘贴。';
    return;
  }
  field.value = result.value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  status.value = '已将 Tag 填入当前可识别的提示词输入框。';
}
</script>

<template>
  <section class="bbi-page">
    <div class="bbi-page-head"><h2 class="bbi-title bbi-title-sub">世界书转 Tag</h2></div>
    <hr class="bbi-rule" />
    <p class="bbi-field-hint">将中文画面描述转换为 Danbooru 风格生图 Tag。默认只读取本次描述实际触发的世界书条目，不会把整本世界书无差别塞进请求。</p>
    <div class="wb-info">
      <span>当前可见世界书：{{ worldNames.length }} 本</span>
      <span v-if="!hasWorldInfoApi">当前酒馆未提供世界书扫描接口</span>
      <span v-else>扫描接口可用</span>
    </div>
    <label class="bbi-field">
      <span class="bbi-field-label">中文画面描述</span>
      <BbiTextarea v-model="description" :rows="7" placeholder="例如：雨夜的街道上，一名穿黑色风衣的女孩撑着透明雨伞，霓虹灯倒映在积水中……" />
    </label>
    <label class="wb-toggle"><input v-model="useWorldInfo" type="checkbox" />参考本次描述触发的世界书（推荐）</label>
    <div class="wb-actions">
      <button class="bbi-btn bbi-btn-primary" type="button" :disabled="!canConvert" @click="convert"><Icon name="prompt" />{{ loading ? '转换中…' : '转换为 Tag' }}</button>
      <button class="bbi-btn" type="button" :disabled="!description.trim()" @click="description = ''; result = ''; status = ''">清空描述</button>
    </div>
    <label class="bbi-field">
      <span class="bbi-field-label">转换结果</span>
      <BbiTextarea v-model="result" :rows="7" placeholder="转换后的 Tag 会显示在这里，可编辑后复制或应用。" />
    </label>
    <div class="wb-actions">
      <button class="bbi-btn" type="button" :disabled="!result" @click="copyResult"><Icon name="copy" />复制 Tag</button>
      <button class="bbi-btn bbi-btn-primary" type="button" :disabled="!result" @click="applyToPrompt">应用到提示词</button>
    </div>
    <p v-if="status" class="bbi-field-hint" role="status">{{ status }}</p>
  </section>
</template>

<style scoped>
.wb-info{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;color:var(--bbi-ink-soft);font-size:12px}
.wb-toggle{display:flex;gap:8px;align-items:center;margin:12px 0;color:var(--bbi-ink)}
.wb-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
</style>
