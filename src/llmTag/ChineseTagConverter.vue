<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import { convertChineseToTags, type PresetBorrowEntry, type TagWorldbookEntry } from './converter';
import { charTagLib, buildEntryTag } from '@/state/charTags';
import { settings } from '@/state/settings';
import { getContext } from '@/st/context';
import { copyText } from '@/st/clipboard';

const PREF_KEY = 'baibai_image_llm_tag_preferences';
const prefsReady = ref(false);
const emit = defineEmits<{ (e:'close'):void; (e:'converted', value:string):void }>();
const open = ref(false);
const description = ref('');
const result = ref('');
const busy = ref(false);
const error = ref('');
const useWorldbook = ref(true);
const extraRules = ref('');
const channelId = ref(settings.assignments.tagGen || '');
const worldbooks = ref<Array<{name:string; entries:TagWorldbookEntry[]}>>([]);
const excludedWorlds = ref<string[]>([]);
const excludedEntries = ref<string[]>([]);
const presets = ref<PresetBorrowEntry[]>([]);
const borrowedPresetIds = ref<string[]>([]);
const canUseMain = computed(() => typeof getContext()?.generateRaw === 'function');
const roster = computed(() => charTagLib.entries.map(entry => {
  const tags = buildEntryTag(entry);
  return tags ? `${entry.name}: ${tags}` : '';
}).filter(Boolean).join('\n'));

function presetRows(): PresetBorrowEntry[] {
  const raw = getContext()?.chatCompletionSettings as {prompts?:Array<Record<string,unknown>>;prompt_order?:Array<{character_id?:string|number;order?:Array<{identifier:string;enabled?:boolean}>}>}|undefined;
  if (!raw || !Array.isArray(raw.prompts)) return [];
  const orderList = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
  const order = orderList.find(item => String(item.character_id) === '100000')?.order ?? orderList[0]?.order ?? [];
  const byId = new Map(raw.prompts.map(item => [String(item.identifier ?? ''), item] as const));
  const ids = new Set<string>();
  const rows: PresetBorrowEntry[] = [];
  for (const item of order) {
    const id = String(item.identifier ?? '');
    const prompt = byId.get(id);
    if (!prompt || ids.has(id)) continue;
    ids.add(id);
    const content = String(prompt.content ?? '');
    if (content.trim()) rows.push({id,name:String(prompt.name ?? id),content,marker:!!prompt.marker});
  }
  for (const prompt of raw.prompts) {
    const id = String(prompt.identifier ?? '');
    if (!id || ids.has(id)) continue;
    const content = String(prompt.content ?? '');
    if (content.trim()) rows.push({id,name:String(prompt.name ?? id),content,marker:!!prompt.marker});
  }
  return rows;
}
async function loadSources(): Promise<void> {
  const ctx = getContext();
  presets.value = presetRows();
  const names = ctx?.getWorldInfoNames?.() ?? [];
  const books: Array<{name:string;entries:TagWorldbookEntry[]}> = [];
  for (const name of [...new Set(names)]) {
    try {
      const data = await ctx?.loadWorldInfo?.(name);
      const entries = Object.values((data?.entries ?? {}) as Record<string,Record<string,unknown>>)
        .filter(entry => entry && entry.uid !== undefined)
        .map(entry => ({
          world:name, uid:entry.uid as number|string, comment:String(entry.comment ?? ''),
          content:String(entry.content ?? ''),
        }));
      if (entries.length) books.push({name,entries});
    } catch (e) { console.warn('[柏宝绘] 读取世界书条目失败', name, e); }
  }
  worldbooks.value = books;
}
function toggleEntry(key:string, checked:boolean):void {
  excludedEntries.value = checked ? excludedEntries.value.filter(item=>item!==key) : [...excludedEntries.value,key];
}
async function convert():Promise<void> {
  if (busy.value || !description.value.trim()) return;
  busy.value = true; error.value = ''; result.value = '';
  try {
    const channel = settings.channels.find(item=>item.id===channelId.value) ?? null;
    const value = await convertChineseToTags(description.value, {
      channel, useWorldbook:useWorldbook.value, excludedWorlds:excludedWorlds.value,
      excludedEntries:excludedEntries.value, presetEntries:presets.value,
      borrowedPresetIds:borrowedPresetIds.value, roster:roster.value, extraRules:extraRules.value,
    });
    result.value = value;
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; }
}
function apply():void { if (result.value) emit('converted',result.value); }
function copyResult():void { if (result.value) void copyText(result.value, '已复制'); }
watch([useWorldbook, excludedWorlds, excludedEntries, borrowedPresetIds, extraRules], () => {
  if (!prefsReady.value) return;
  const ctx = getContext();
  if (!ctx?.extensionSettings) return;
  ctx.extensionSettings[PREF_KEY] = {
    useWorldbook: useWorldbook.value,
    excludedWorlds: [...excludedWorlds.value],
    excludedEntries: [...excludedEntries.value],
    borrowedPresetIds: [...borrowedPresetIds.value],
    extraRules: extraRules.value,
  };
  ctx.saveSettingsDebounced?.();
}, { deep: true });
onMounted(()=>{
  const raw = getContext()?.extensionSettings?.[PREF_KEY] as {
    useWorldbook?:unknown; excludedWorlds?:unknown; excludedEntries?:unknown;
    borrowedPresetIds?:unknown; extraRules?:unknown;
  } | undefined;
  if (raw && typeof raw === 'object') {
    if (typeof raw.useWorldbook === 'boolean') useWorldbook.value = raw.useWorldbook;
    if (Array.isArray(raw.excludedWorlds)) excludedWorlds.value = raw.excludedWorlds.filter((v):v is string=>typeof v==='string');
    if (Array.isArray(raw.excludedEntries)) excludedEntries.value = raw.excludedEntries.filter((v):v is string=>typeof v==='string');
    if (Array.isArray(raw.borrowedPresetIds)) borrowedPresetIds.value = raw.borrowedPresetIds.filter((v):v is string=>typeof v==='string');
    if (typeof raw.extraRules === 'string') extraRules.value = raw.extraRules;
  }
  prefsReady.value = true;
  void loadSources();
  requestAnimationFrame(()=>{open.value=true;});
});
</script>

<template>
  <ModalMask :open="open" top-layer @close="emit('close')">
    <section class="bbi-modal bbi-tag-converter" role="dialog" aria-modal="true" aria-label="中文转 Tag">
      <header class="bbi-modal-head">
        <span class="bbi-modal-title">中文转 Tag</span>
        <button class="bbi-icon-mini" type="button" title="关闭" @click="emit('close')"><Icon name="close" /></button>
      </header>
      <p class="bbi-field-hint">把中文画面描述转换为 Danbooru 英文 tag。角色名单优先，世界书只读取本次描述实际触发的条目。</p>
      <div class="bbi-modal-field">
        <label class="bbi-modal-label" for="bbi-tag-description">中文画面描述</label>
        <BbiTextarea id="bbi-tag-description" v-model="description" :rows="5" :max-rows="12" placeholder="例如：小雪穿着白色连衣裙，站在窗边，手里拿着一把透明雨伞……" />
      </div>
      <div class="bbi-modal-field">
        <label class="bbi-modal-label" for="bbi-tag-channel">转换 API</label>
        <select id="bbi-tag-channel" v-model="channelId" class="bbi-input">
          <option value="" :disabled="!canUseMain">跟随主 API</option>
          <option v-for="channel in settings.channels" :key="channel.id" :value="channel.id">{{ channel.name || channel.model }}</option>
        </select>
      </div>
      <div class="bbi-modal-field">
        <label class="bbi-check"><input v-model="useWorldbook" type="checkbox"> 参考本次描述触发的世界书条目</label>
        <div v-if="useWorldbook && worldbooks.length" class="bbi-tag-source-list">
          <details v-for="book in worldbooks" :key="book.name">
            <summary><label @click.stop><input v-model="excludedWorlds" type="checkbox" :value="book.name"> 排除整本</label> {{ book.name }}（{{ book.entries.length }} 条）</summary>
            <label v-for="entry in book.entries" :key="String(entry.uid)" class="bbi-check bbi-tag-entry">
              <input type="checkbox" :checked="!excludedEntries.includes(book.name+'::'+entry.uid) && !excludedWorlds.includes(book.name)" :disabled="excludedWorlds.includes(book.name)" @change="toggleEntry(book.name+'::'+entry.uid,($event.target as HTMLInputElement).checked)">
              {{ entry.comment || ('UID '+entry.uid) }}
            </label>
          </details>
        </div>
        <span v-else-if="useWorldbook" class="bbi-field-hint">当前未发现可列出的世界书；转换时仍会尝试读取实际触发条目。</span>
      </div>
      <div class="bbi-modal-field">
        <span class="bbi-modal-label">借用当前预设条目（可选）</span>
        <div v-if="presets.length" class="bbi-tag-source-list">
          <label v-for="entry in presets" :key="entry.id" class="bbi-check">
            <input v-model="borrowedPresetIds" type="checkbox" :value="entry.id" :disabled="entry.marker">
            {{ entry.name }} <span class="bbi-field-hint">{{ entry.marker ? '（标记条目，不可借用）' : '' }}</span>
          </label>
        </div>
        <span v-else class="bbi-field-hint">当前读取不到聊天补全预设条目。</span>
      </div>
      <details class="bbi-modal-field">
        <summary class="bbi-modal-label">补充转换规则（可选）</summary>
        <BbiTextarea v-model="extraRules" :rows="2" :max-rows="8" placeholder="填写本次转换额外遵循的要求" />
      </details>
      <div v-if="roster" class="bbi-field-hint">已载入 {{ charTagLib.entries.length }} 条角色外貌资料，将作为名单优先依据。</div>
      <div class="bbi-modal-field">
        <div class="bbi-tag-result-head"><span class="bbi-modal-label">转换结果</span><button class="bbi-btn bbi-btn-sm" type="button" :disabled="!result" @click="copyResult">复制</button></div>
        <BbiTextarea v-model="result" :rows="4" :max-rows="12" mono placeholder="转换结果会显示在这里，也可以手动微调。" />
      </div>
      <p v-if="error" class="bbi-editor-error">{{ error }}</p>
      <footer class="bbi-modal-foot">
        <button class="bbi-btn" type="button" :disabled="busy" @click="emit('close')">取消</button>
        <button class="bbi-btn bbi-btn-primary" type="button" :disabled="busy || !description.trim() || (!channelId && !canUseMain)" @click="convert">
          <span v-if="busy" class="bbi-rewrite-spin" /> {{ busy ? '转换中…' : '开始转换' }}
        </button>
        <button class="bbi-btn" type="button" :disabled="!result" @click="apply">应用到提示词</button>
      </footer>
    </section>
  </ModalMask>
</template>

<style scoped>
.bbi-tag-converter{width:min(720px,calc(100vw - 28px));max-height:88vh;overflow:auto;gap:12px}
.bbi-tag-source-list{display:grid;gap:6px;max-height:180px;overflow:auto;padding:8px;border:1px solid var(--bbi-line);border-radius:var(--bbi-radius-sm)}
.bbi-tag-source-list details{display:grid;gap:6px}
.bbi-tag-entry{padding-left:18px}
.bbi-tag-result-head{display:flex;justify-content:space-between;align-items:center}
.bbi-check{display:flex;align-items:center;gap:7px;font-size:12px}
.bbi-tag-converter .bbi-modal-field{margin:0}
</style>
