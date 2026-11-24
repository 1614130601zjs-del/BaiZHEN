<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  applyWorldbookMode,
  getWorldbookModeProfile,
  listWorldbooks,
  listWorldviews,
  restoreWorldbookMode,
  saveWorldbookModeProfile,
  type WorldbookModeProfile,
} from '@/modes/worldbookMode';

const profile = ref<WorldbookModeProfile>(getWorldbookModeProfile());
const books = ref<string[]>([]);
const worldviews = ref<string[]>([]);
const loading = ref(false);
const busy = ref(false);
const message = ref('');
const error = ref(false);
const mode = computed<'native' | 'worldbook'>(() => profile.value.enabled ? 'worldbook' : 'native');

async function refreshBooks() {
  loading.value = true;
  try {
    books.value = await listWorldbooks();
    await refreshWorldviews();
    message.value = books.value.length ? `已读取 ${books.value.length} 本世界书` : '当前未发现已加载的世界书';
    error.value = false;
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e);
    error.value = true;
  } finally {
    loading.value = false;
  }
}

async function refreshWorldviews() {
  worldviews.value = profile.value.worldviewBook
    ? await listWorldviews(profile.value.worldviewBook)
    : [];
  if (!worldviews.value.includes(profile.value.worldview)) profile.value.worldview = '';
}

watch(() => profile.value.worldviewBook, () => { void refreshWorldviews(); });

async function chooseMode(next: 'native' | 'worldbook') {
  if (next === 'native') {
    busy.value = true;
    try {
      await restoreWorldbookMode();
      profile.value = getWorldbookModeProfile();
      message.value = '已切回柏宝绘原生模式，世界书状态已恢复';
      error.value = false;
    } catch (e) {
      message.value = e instanceof Error ? e.message : String(e);
      error.value = true;
    } finally { busy.value = false; }
    return;
  }
  profile.value.enabled = true;
  saveWorldbookModeProfile(profile.value);
  message.value = '已选择拾帧世界书模式；配置完成后点击「应用模式」';
  error.value = false;
}

async function applyMode() {
  busy.value = true;
  try {
    profile.value.enabled = true;
    saveWorldbookModeProfile(profile.value);
    await applyWorldbookMode();
    message.value = '拾帧世界书模式已应用';
    error.value = false;
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e);
    error.value = true;
  } finally { busy.value = false; }
}

onMounted(() => { void refreshBooks(); });
</script>

<template>
  <section class="bbi-page">
    <div class="bbi-page-head">
      <h2 class="bbi-title bbi-title-sub">生图模式</h2>
      <button class="bbi-btn" type="button" :disabled="loading || busy" @click="refreshBooks">
        {{ loading ? '刷新中…' : '刷新世界书' }}
      </button>
    </div>
    <hr class="bbi-rule" />

    <section class="mode-card">
      <div class="mode-heading">选择生图模式</div>
      <div class="mode-options">
        <button type="button" class="mode-option" :class="{ active: mode === 'native' }" :disabled="busy" @click="chooseMode('native')">
          <strong>柏宝绘原生模式</strong>
          <span>使用柏宝绘现有自动分析、角色上下文与漫画引擎。</span>
        </button>
        <button type="button" class="mode-option" :class="{ active: mode === 'worldbook' }" :disabled="busy" @click="chooseMode('worldbook')">
          <strong>拾帧世界书模式</strong>
          <span>按指定核心世界书与世界观条目管理生图上下文。</span>
        </button>
      </div>
    </section>

    <section v-if="mode === 'worldbook'" class="mode-card">
      <div class="mode-heading">世界书配置</div>
      <label class="mode-field">
        <span>核心世界书</span>
        <select v-model="profile.coreBook">
          <option value="">请选择核心世界书</option>
          <option v-for="book in books" :key="book" :value="book">{{ book }}</option>
        </select>
      </label>
      <label class="mode-field">
        <span>世界观特化世界书</span>
        <select v-model="profile.worldviewBook">
          <option value="">请选择世界观特化世界书</option>
          <option v-for="book in books" :key="book" :value="book">{{ book }}</option>
        </select>
      </label>
      <label class="mode-field">
        <span>当前世界观</span>
        <select v-model="profile.worldview" :disabled="!worldviews.length">
          <option value="">请选择世界观条目</option>
          <option v-for="worldview in worldviews" :key="worldview" :value="worldview">{{ worldview }}</option>
        </select>
      </label>
      <p class="mode-hint">世界观特化书需使用「世界观｜名称」作为条目备注前缀。应用时只切换这两本书，不会卸载其他全局世界书；退出模式时恢复接管前的挂载与条目状态。</p>
      <button class="bbi-btn bbi-btn-primary" type="button" :disabled="busy || loading" @click="applyMode">
        {{ busy ? '处理中…' : '保存并应用模式' }}
      </button>
    </section>

    <p v-if="message" class="mode-message" :class="{ danger: error }" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.mode-card { display: grid; gap: 14px; padding: 16px; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius); background: var(--bbi-surface); }
.mode-heading { color: var(--bbi-ink); font-size: 14px; font-weight: 650; }
.mode-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.mode-option { display: grid; gap: 7px; padding: 13px; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius); background: var(--bbi-surface-2); color: var(--bbi-ink); text-align: left; cursor: pointer; }
.mode-option.active { border-color: var(--bbi-accent); box-shadow: inset 0 0 0 1px var(--bbi-accent); }
.mode-option span, .mode-hint { color: var(--bbi-ink-soft); font-size: 12px; line-height: 1.6; }
.mode-field { display: grid; gap: 6px; color: var(--bbi-ink-soft); font-size: 12px; }
.mode-field select { width: 100%; min-height: 38px; padding: 6px 10px; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius-sm); background: var(--bbi-surface-2); color: var(--bbi-ink); }
.mode-message { color: var(--bbi-ink-soft); font-size: 12px; }
.mode-message.danger { color: var(--bbi-danger, #c44); }
@media (max-width: 480px) { .mode-options { grid-template-columns: 1fr; } }
</style>
