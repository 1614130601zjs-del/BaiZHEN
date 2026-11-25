<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import Icon from '@/components/Icon.vue';
import { requestViaMainApi } from '@/api/client';
import { fetchTriggeredWorldInfo, fetchScopedWorldNames, buildWorldbookTagMessages, cleanWorldbookTagOutput } from '@/autoTag/worldbookTag';
import { getContext } from '@/st/context';

const description = ref('');
const result = ref('');
const status = ref('');
const loading = ref(false);
const useWorldInfo = ref(true);
const worldNames = ref<string[]>([]);
const excludedWorlds = ref<string[]>([]);
const excludedEntries = ref<string[]>([]);
const worldEntries = ref<Array<{ key: string; world: string; uid: string; comment: string }>>([]);
const hasWorldInfoApi = computed(() => typeof getContext()?.getWorldInfoPrompt === 'function');
const canConvert = computed(() => !!description.value.trim() && !loading.value);

onMounted(async () => {
  const ctx = getContext();
  worldNames.value = await fetchScopedWorldNames();
  if (!worldNames.value.length) worldNames.value = ctx?.getWorldInfoNames?.() ?? [];
  if (!ctx?.loadWorldInfo) return;
  const loaded = await Promise.allSettled(worldNames.value.map(async world => {
    const data = await ctx.loadWorldInfo?.(world);
    const entries = data?.entries;
    if (!entries || typeof entries !== 'object') return [];
    return Object.entries(entries as Record<string, unknown>).flatMap(([uid, raw]) => {
      if (!raw || typeof raw !== 'object') return [];
      const entry = raw as { uid?: string | number; comment?: string; disable?: boolean };
      if (entry.disable) return [];
      const id = String(entry.uid ?? uid);
      return [{ key: world + '::' + id, world, uid: id, comment: String(entry.comment || ('条目 ' + id)) }];
    });
  }));
  worldEntries.value = loaded.flatMap(item => item.status === 'fulfilled' ? item.value : []);
});

async function convert() {
  if (!description.value.trim() || loading.value) return;
  loading.value = true;
  status.value = '正在读取世界书并转换…';
  try {
    const ctx = getContext();
    let worldInfo = '';
    if (useWorldInfo.value) worldInfo = await fetchTriggeredWorldInfo(description.value, excludedWorlds.value, excludedEntries.value, value => ctx?.substituteParams?.(value) ?? value);
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
    <label class="wb-toggle"><input v-model="useWorldInfo" type="checkbox" />参考本次描述实际触发的世界书（按拾帧规则扫描）</label>
    <div v-if="useWorldInfo && worldNames.length" class="wb-exclusions">
      <span class="bbi-field-label">排除不参与转换的世界书</span>
      <label v-for="name in worldNames" :key="name" class="wb-toggle"><input v-model="excludedWorlds" type="checkbox" :value="name" />{{ name }}</label>
      <div v-if="worldEntries.length" class="wb-entry-exclusions">
        <span class="bbi-field-label">单条目排除</span>
        <label v-for="entry in worldEntries" :key="entry.key" class="wb-toggle">
          <input v-model="excludedEntries" type="checkbox" :value="entry.key" />
          <span>{{ entry.world }} · {{ entry.comment }}</span>
        </label>
      </div>
    </div>
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
.wb-exclusions{display:grid;gap:6px;margin:12px 0;padding:12px;border:1px solid var(--bbi-line);border-radius:10px}.wb-entry-exclusions{display:grid;gap:4px;margin-top:8px;padding-top:8px;border-top:1px solid var(--bbi-line);max-height:220px;overflow:auto}
.wb-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
</style>
