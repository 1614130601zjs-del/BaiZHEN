<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import { confirmDialog } from '@/components/confirm';
import { getContext } from '@/st/context';
import { deleteUserImage, uploadUserImage } from '@/st/images';
import { makeJpegThumbnail, readFileAsDataUrl } from '@/st/imageFile';
import {
  importWorks, initLibraries, libraries, newPromptEntry,
  removePromptEntries, removeWorkEntry, renameWorkDisplayName,
  upsertPromptEntry, upsertWorkEntry, parseWorkLibraryJson, parseWorkLibraryText,
  type PromptLibraryEntry, type WorkLibraryEntry,
} from '@/state/libraries';

type Tab = 'prompts' | 'works';
const tab = ref<Tab>('prompts');
const promptFilter = ref('');
const promptSearch = ref('');
const workFilter = ref('');
const workSearch = ref('');
const editingPrompt = ref<PromptLibraryEntry | null>(null);
const editingWork = ref<WorkLibraryEntry | null>(null);
const previewData = ref('');
const imageInput = ref<HTMLInputElement | null>(null);
const workFile = ref<HTMLInputElement | null>(null);
const importText = ref('');
const importStatus = ref('');
const selectedPromptIds = ref(new Set<string>());
const bulkMode = ref(false);
const saving = ref(false);
const customWorkName = ref('');
const categories = computed(() => [...new Set(libraries.prompts.map(item => item.category).filter(Boolean))].sort());
const works = computed(() => [...new Set(libraries.works.map(item => item.work || '（未分类）'))].sort());
const filteredPrompts = computed(() => libraries.prompts.filter(item => {
  const categoryOk = !promptFilter.value || item.category === promptFilter.value;
  const q = promptSearch.value.trim().toLowerCase();
  return categoryOk && (!q || [item.name, item.promptEn, item.promptZh, item.sourceNote].some(value => value.toLowerCase().includes(q)));
}));
const filteredWorks = computed(() => libraries.works.filter(item => {
  const workOk = !workFilter.value || (item.work || '（未分类）') === workFilter.value;
  const q = workSearch.value.trim().toLowerCase();
  return workOk && (!q || [item.name, item.canonical, item.work].some(value => value.toLowerCase().includes(q)));
}));
onMounted(() => {
  initLibraries();
});
watch(workFilter, value => {
  customWorkName.value = value && value !== '（未分类）' ? (libraries.workDisplayNames[value] || '') : '';
});

function editPrompt(item?: PromptLibraryEntry) {
  editingPrompt.value = item ? { ...item } : newPromptEntry();
  previewData.value = '';
}
function cancelPrompt() {
  editingPrompt.value = null;
  previewData.value = '';
}
function pickImage() { imageInput.value?.click(); }
async function onImageChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file || !editingPrompt.value) return;
  try {
    const data = await readFileAsDataUrl(file);
    previewData.value = await makeJpegThumbnail(data, 640, 0.86);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '读取预览图失败');
  }
}
async function savePrompt() {
  const draft = editingPrompt.value;
  if (!draft || saving.value) return;
  if (!draft.name.trim() || !draft.promptEn.trim()) {
    toastr.warning('请填写名称和画面提示词', '提示词库');
    return;
  }
  saving.value = true;
  try {
    const next = { ...draft, name: draft.name.trim(), category: draft.category.trim() || '其他', promptEn: draft.promptEn.trim(), promptZh: draft.promptZh.trim(), sourceNote: draft.source === 'other' ? draft.sourceNote.trim() : '', updatedAt: Date.now() };
    const previousImagePath = next.imagePath;
    if (previewData.value) {
      const base64 = previewData.value.split(',')[1] || '';
      const oldPath = next.imagePath;
      next.imagePath = await uploadUserImage('柏宝绘_提示词库', next.id + '.jpg', base64, 'jpg');
      if (oldPath && oldPath !== next.imagePath) void deleteUserImage(oldPath).catch(() => {});
    }
    upsertPromptEntry(next);
    if (previousImagePath && previousImagePath !== next.imagePath) void deleteUserImage(previousImagePath).catch(() => {});
    editingPrompt.value = null;
    previewData.value = '';
    toastr.success('提示词已保存', '提示词库');
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : String(error), '保存失败');
  } finally { saving.value = false; }
}
async function deletePrompt(item: PromptLibraryEntry) {
  if (!await confirmDialog({ title: '删除提示词', text: '删除「' + item.name + '」？关联的生成图片不会删除。', confirmText: '删除', tone: 'danger' })) return;
  const removed = removePromptEntries([item.id]);
  for (const entry of removed) if (entry.imagePath) void deleteUserImage(entry.imagePath).catch(() => {});
}
async function deleteSelectedPrompts() {
  const ids = [...selectedPromptIds.value];
  if (!ids.length) return;
  if (!await confirmDialog({ title: '批量删除提示词', text: '确定删除所选的 ' + ids.length + ' 条提示词？图片作品不会删除。', confirmText: '删除', tone: 'danger' })) return;
  const removed = removePromptEntries(ids);
  for (const entry of removed) if (entry.imagePath) void deleteUserImage(entry.imagePath).catch(() => {});
  selectedPromptIds.value = new Set();
  bulkMode.value = false;
}
function togglePrompt(id: string) {
  const next = new Set(selectedPromptIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  selectedPromptIds.value = next;
}
function startWork(item?: WorkLibraryEntry) {
  editingWork.value = item ? { ...item } : { id: '', name: '', canonical: '', work: '' };
}
function saveWork() {
  if (!editingWork.value) return;
  try {
    upsertWorkEntry(editingWork.value);
    editingWork.value = null;
    toastr.success('作品词条已保存', '作品库');
  } catch (error) { toastr.warning(error instanceof Error ? error.message : String(error), '作品库'); }
}
async function deleteWork(item: WorkLibraryEntry) {
  if (!await confirmDialog({ title: '删除作品词条', text: '删除「' + item.name + '」？', confirmText: '删除', tone: 'danger' })) return;
  removeWorkEntry(item.id);
}
function importWorkText() {
  try {
    const entries = parseWorkLibraryText(importText.value);
    const result = importWorks(entries);
    importStatus.value = '导入完成：新增 ' + result.added + ' 条，跳过重复 ' + result.skipped + ' 条。';
    importText.value = '';
  } catch (error) { importStatus.value = error instanceof Error ? error.message : String(error); }
}
async function importWorkFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const entries = /\.json$/i.test(file.name) ? parseWorkLibraryJson(text) : parseWorkLibraryText(text);
    const result = importWorks(entries);
    importStatus.value = '导入完成：新增 ' + result.added + ' 条，跳过重复 ' + result.skipped + ' 条。';
  } catch (error) { importStatus.value = '导入失败：' + (error instanceof Error ? error.message : String(error)); }
}
function exportWorks() {
  const data = JSON.stringify({ schemaVersion: 1, entries: libraries.works }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = '柏宝绘-作品库.json'; a.click();
  URL.revokeObjectURL(url);
}
function saveWorkDisplayName() {
  if (!workFilter.value || workFilter.value === '（未分类）') return;
  renameWorkDisplayName(workFilter.value, customWorkName.value);
  toastr.success('作品显示名称已保存', '作品库');
}
function copyText(text: string) {
  const ctx = getContext() as { copyTextToClipboard?: (value: string) => Promise<void> } | undefined;
  if (ctx?.copyTextToClipboard) void ctx.copyTextToClipboard(text);
  else void navigator.clipboard?.writeText(text);
}
</script>

<template>
  <section class="bbi-page">
    <div class="bbi-page-head">
      <h2 class="bbi-title bbi-title-sub">素材库</h2>
      <span class="bbi-count">{{ libraries.prompts.length + libraries.works.length }}</span>
    </div>
    <hr class="bbi-rule" />
    <div class="lib-tabs" role="tablist" aria-label="素材库分类">
      <button type="button" :class="{ active: tab === 'prompts' }" @click="tab = 'prompts'">提示词库 <span>{{ libraries.prompts.length }}</span></button>
      <button type="button" :class="{ active: tab === 'works' }" @click="tab = 'works'">作品库 <span>{{ libraries.works.length }}</span></button>
    </div>

    <template v-if="tab === 'prompts'">
      <div class="lib-toolbar">
        <input v-model="promptSearch" class="bbi-input" type="search" placeholder="搜索名称、提示词或 Tag…" />
        <select v-model="promptFilter" class="bbi-input"><option value="">全部分类</option><option v-for="category in categories" :key="category" :value="category">{{ category }}</option></select>
        <button class="bbi-btn bbi-btn-primary" type="button" @click="editPrompt()"><Icon name="plus" /> 添加提示词</button>
        <button class="bbi-btn" type="button" @click="bulkMode = !bulkMode; selectedPromptIds = new Set()">{{ bulkMode ? '退出选择' : '批量管理' }}</button>
      </div>
      <div v-if="bulkMode" class="lib-bulk">
        <span>已选 {{ selectedPromptIds.size }} 条</span>
        <button class="bbi-btn bbi-btn-danger bbi-btn-sm" type="button" :disabled="!selectedPromptIds.size" @click="deleteSelectedPrompts">删除所选</button>
      </div>
      <div v-if="filteredPrompts.length" class="lib-prompt-grid">
        <article v-for="item in filteredPrompts" :key="item.id" class="lib-prompt-card">
          <label v-if="bulkMode" class="lib-check"><input type="checkbox" :checked="selectedPromptIds.has(item.id)" @change="togglePrompt(item.id)" />选择</label>
          <button type="button" class="lib-prompt-image" @click="bulkMode ? togglePrompt(item.id) : editPrompt(item)">
            <img v-if="item.imagePath" :src="item.imagePath" :alt="item.name" loading="lazy" />
            <span v-else>无预览图</span>
          </button>
          <div class="lib-prompt-info"><strong>{{ item.name }}</strong><span>{{ item.category }}</span></div>
          <p v-if="item.promptZh" class="lib-tags">{{ item.promptZh }}</p>
          <div class="lib-card-actions"><button class="bbi-btn bbi-btn-sm" type="button" @click="copyText(item.promptEn)"><Icon name="copy" />复制提示词</button><button class="bbi-btn bbi-btn-sm" type="button" @click="editPrompt(item)">编辑</button><button class="bbi-btn bbi-btn-sm bbi-btn-danger" type="button" @click="deletePrompt(item)">删除</button></div>
        </article>
      </div>
      <p v-else class="bbi-field-hint">还没有提示词。可以先添加常用画面提示词、Tag 和预览图。</p>

      <div v-if="editingPrompt" class="lib-editor">
        <div class="bbi-field-head"><strong>{{ libraries.prompts.some(item => item.id === editingPrompt?.id) ? '编辑提示词' : '新建提示词' }}</strong><button class="bbi-icon-mini" type="button" @click="cancelPrompt"><Icon name="close" /></button></div>
        <label class="bbi-field"><span class="bbi-field-label">画面提示词（英文）</span><BbiTextarea v-model="editingPrompt.promptEn" :rows="5" placeholder="1girl, cinematic lighting, …" /></label>
        <div class="lib-form-row">
          <label class="bbi-field"><span class="bbi-field-label">名称</span><input v-model="editingPrompt.name" class="bbi-input" placeholder="例如：雨夜街景" /></label>
          <label class="bbi-field"><span class="bbi-field-label">分类</span><input v-model="editingPrompt.category" class="bbi-input" list="lib-categories" placeholder="单人 / 双人 / BG…" /><datalist id="lib-categories"><option v-for="category in categories" :key="category" :value="category" /></datalist></label>
        </div>
        <label class="bbi-field"><span class="bbi-field-label">自定义 Tag</span><BbiTextarea v-model="editingPrompt.promptZh" :rows="2" placeholder="用逗号、顿号或空格分隔" /></label>
        <div class="lib-form-row">
          <label class="bbi-field"><span class="bbi-field-label">来源</span><select v-model="editingPrompt.source" class="bbi-input"><option value="original">原创</option><option value="other">他人的</option></select></label>
          <label v-if="editingPrompt.source === 'other'" class="bbi-field"><span class="bbi-field-label">出处 / 原帖链接</span><input v-model="editingPrompt.sourceNote" class="bbi-input" placeholder="作者、链接或出处说明" /></label>
        </div>
        <div class="lib-preview-edit"><div><span class="bbi-field-label">预览图</span><img v-if="previewData || editingPrompt.imagePath" :src="previewData || editingPrompt.imagePath" alt="提示词预览" /><span v-else class="bbi-field-hint">尚未添加预览图</span></div><div><input ref="imageInput" type="file" accept="image/*" hidden @change="onImageChange" /><button class="bbi-btn" type="button" @click="pickImage">选择图片</button><button v-if="editingPrompt.imagePath || previewData" class="bbi-btn" type="button" @click="previewData = ''; editingPrompt!.imagePath = ''">移除预览</button></div></div>
        <div class="lib-actions"><button class="bbi-btn" type="button" @click="cancelPrompt">取消</button><button class="bbi-btn bbi-btn-primary" type="button" :disabled="saving" @click="savePrompt">保存提示词</button></div>
      </div>
    </template>

    <template v-else>
      <div class="lib-toolbar">
        <input v-model="workSearch" class="bbi-input" type="search" placeholder="搜索中文名、英文 Tag 或作品…" />
        <select v-model="workFilter" class="bbi-input"><option value="">全部作品</option><option v-for="work in works" :key="work" :value="work">{{ libraries.workDisplayNames[work] || work }} · {{ libraries.works.filter(item => (item.work || '（未分类）') === work).length }}</option></select>
        <button class="bbi-btn bbi-btn-primary" type="button" @click="startWork()"><Icon name="plus" /> 新建词条</button>
        <button class="bbi-btn" type="button" @click="exportWorks"><Icon name="download" /> 导出</button>
      </div>
      <div class="lib-import">
        <details><summary>批量导入作品词条</summary>
          <p class="bbi-field-hint">兼容拾帧文本格式：每行「中文名=英文 Tag (作品名)」，也支持 JSON 的 entries 数组。</p>
          <BbiTextarea v-model="importText" :rows="4" placeholder="角色名=character name (作品名)" />
          <div class="lib-actions"><button class="bbi-btn" type="button" @click="importWorkText">导入文本</button><input ref="workFile" type="file" accept=".txt,.json,application/json,text/plain" @change="importWorkFile" /></div>
          <p v-if="importStatus" class="bbi-field-hint">{{ importStatus }}</p>
        </details>
      </div>
      <div v-if="workFilter && workFilter !== '（未分类）'" class="lib-work-rename"><span>作品中文显示名</span><input v-model="customWorkName" class="bbi-input" :placeholder="workFilter" /><button class="bbi-btn bbi-btn-sm" type="button" @click="saveWorkDisplayName">保存</button></div>
      <div v-if="editingWork" class="lib-editor">
        <div class="bbi-field-head"><strong>{{ editingWork.id ? '编辑作品词条' : '新建作品词条' }}</strong><button class="bbi-icon-mini" type="button" @click="editingWork = null"><Icon name="close" /></button></div>
        <div class="lib-form-row"><label class="bbi-field"><span class="bbi-field-label">中文名称 / 别名（多个用 | 分隔）</span><input v-model="editingWork.name" class="bbi-input" placeholder="角色名|别名" /></label><label class="bbi-field"><span class="bbi-field-label">作品名称</span><input v-model="editingWork.work" class="bbi-input" placeholder="作品名" /></label></div>
        <label class="bbi-field"><span class="bbi-field-label">英文 Danbooru Tag</span><input v-model="editingWork.canonical" class="bbi-input" placeholder="character name (copyright name)" /></label>
        <div class="lib-actions"><button class="bbi-btn" type="button" @click="editingWork = null">取消</button><button class="bbi-btn bbi-btn-primary" type="button" @click="saveWork">保存词条</button></div>
      </div>
      <div v-if="filteredWorks.length" class="lib-work-list">
        <article v-for="item in filteredWorks" :key="item.id" class="lib-work-row"><div><strong>{{ item.name }}</strong><small>{{ item.canonical }}</small><span>{{ item.work || '未分类' }}</span></div><div><button class="bbi-btn bbi-btn-sm" type="button" @click="copyText(item.canonical)"><Icon name="copy" />复制</button><button class="bbi-btn bbi-btn-sm" type="button" @click="startWork(item)">编辑</button><button class="bbi-btn bbi-btn-sm bbi-btn-danger" type="button" @click="deleteWork(item)">删除</button></div></article>
      </div>
      <p v-else class="bbi-field-hint">作品库为空。可导入拾帧已有的作品词条，或手动新增。</p>
    </template>
  </section>
</template>

<style scoped>
.lib-tabs{display:flex;gap:6px;margin:12px 0 16px;border-bottom:1px solid var(--bbi-line);padding-bottom:8px}
.lib-tabs button{border:1px solid var(--bbi-line);border-radius:var(--bbi-radius-pill);background:var(--bbi-surface);color:var(--bbi-ink-soft);padding:7px 14px;cursor:pointer}
.lib-tabs button.active{background:var(--bbi-accent);border-color:var(--bbi-accent);color:white}
.lib-tabs span{font-size:11px;opacity:.8;margin-left:5px}
.lib-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.lib-toolbar input[type=search]{flex:1 1 180px}
.lib-toolbar select{flex:0 1 170px}
.lib-bulk,.lib-work-rename{display:flex;align-items:center;gap:8px;margin:8px 0;padding:9px 11px;background:var(--bbi-surface-2);border-radius:var(--bbi-radius-sm)}
.lib-prompt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.lib-prompt-card{min-width:0;border:1px solid var(--bbi-line);border-radius:var(--bbi-radius-md);padding:9px;background:var(--bbi-surface)}
.lib-prompt-image{width:100%;aspect-ratio:4/3;border:0;border-radius:var(--bbi-radius-sm);background:var(--bbi-surface-2);display:grid;place-items:center;overflow:hidden;color:var(--bbi-ink-soft);cursor:pointer}
.lib-prompt-image img{width:100%;height:100%;object-fit:cover}
.lib-prompt-info{display:flex;justify-content:space-between;gap:6px;margin-top:8px}
.lib-prompt-info strong{overflow-wrap:anywhere}
.lib-prompt-info span,.lib-work-row small,.lib-work-row span{color:var(--bbi-ink-soft);font-size:11px}
.lib-tags{font-size:12px;color:var(--bbi-ink-soft);white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}
.lib-card-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.lib-check{display:flex;gap:5px;align-items:center;margin-bottom:6px}
.lib-editor{margin-top:16px;padding:14px;border:1px solid var(--bbi-line-strong);border-radius:var(--bbi-radius-md);background:var(--bbi-surface)}
.lib-form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.lib-preview-edit{display:flex;gap:16px;align-items:center;justify-content:space-between;margin:10px 0}
.lib-preview-edit img{display:block;max-width:180px;max-height:140px;object-fit:contain;margin-top:6px;border-radius:var(--bbi-radius-sm)}
.lib-preview-edit>div:last-child{display:flex;gap:7px;flex-wrap:wrap}
.lib-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.lib-import{margin:10px 0;padding:10px;border:1px solid var(--bbi-line);border-radius:var(--bbi-radius-sm)}
.lib-import summary{cursor:pointer;font-weight:600}
.lib-work-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--bbi-line)}
.lib-work-row>div:first-child{display:grid;gap:3px;min-width:0}
.lib-work-row strong,.lib-work-row small{overflow-wrap:anywhere}
.lib-work-row>div:last-child{display:flex;gap:5px;flex-wrap:wrap}
.lib-work-rename input{flex:1;min-width:0}
@media(max-width:560px){.lib-form-row{grid-template-columns:1fr}.lib-work-row{align-items:flex-start;flex-direction:column}.lib-preview-edit{align-items:flex-start;flex-direction:column}}
</style>