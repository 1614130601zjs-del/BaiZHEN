<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getContext } from '@/st/context';
import {
  applyWorldbookMode,
  getWorldbookModeProfile,
  getWorldbookEntryBaseline,
  getWorldbookProfileInfo,
  setWorldbookProfileIndependent,
  listWorldbooks,
  listWorldbookEntries,
  listWorldviews,
  restoreWorldbookMode,
  saveWorldbookModeProfile,
  type WorldbookModeProfile,
} from '@/modes/worldbookMode';

const profile = ref<WorldbookModeProfile>(getWorldbookModeProfile());
const profileInfo = ref(getWorldbookProfileInfo());
const selectedMode = ref<'native' | 'worldbook'>(profile.value.enabled ? 'worldbook' : 'native');
const books = ref<string[]>([]);
const worldviews = ref<string[]>([]);
const coreEntries = ref<Array<{ uid: string; title: string; enabled: boolean }>>([]);
const worldviewEntries = ref<Array<{ uid: string; title: string; enabled: boolean; baselineEnabled: boolean; worldview: boolean }>>([]);
const loading = ref(false);
const busy = ref(false);
const message = ref('');
const error = ref(false);
const mode = computed<'native' | 'worldbook'>(() => selectedMode.value);

async function refreshBooks() {
  const revision = profileRefreshRevision;
  loading.value = true;
  try {
    const nextBooks = await listWorldbooks();
    if (revision !== profileRefreshRevision) return;
    books.value = nextBooks;
    await refreshWorldviews(revision);
    if (revision !== profileRefreshRevision) return;
    await refreshEntryLists(revision);
    if (revision !== profileRefreshRevision) return;
    message.value = books.value.length ? `已读取 ${books.value.length} 本世界书` : '当前未发现已加载的世界书';
    error.value = false;
  } catch (e) {
    if (revision === profileRefreshRevision) {
      message.value = e instanceof Error ? e.message : String(e);
      error.value = true;
    }
  } finally {
    if (revision === profileRefreshRevision) loading.value = false;
  }
}

async function refreshEntryLists(revision = profileRefreshRevision) {
  const core = profile.value.coreBook;
  const world = profile.value.worldviewBook;
  const mode = profile.value.mode;
  const [coreData, worldData] = await Promise.all([
    core ? listWorldbookEntries(core) : Promise.resolve([]),
    world ? listWorldbookEntries(world) : Promise.resolve([]),
  ]);
  // Do not let a slow response for the previous card overwrite the newly selected card.
  if (revision !== profileRefreshRevision
    || core !== profile.value.coreBook
    || world !== profile.value.worldviewBook
    || mode !== profile.value.mode) return;

  const coreBindings = core ? (profile.value.modeEntryBindings[mode][core] ||= {}) : {};
  for (const entry of coreData) {
    if (typeof coreBindings[entry.uid] !== 'boolean') coreBindings[entry.uid] = entry.enabled;
  }
  const worldOverrides = world
    ? (profile.value.worldviewEntryOverrides[world] ||= profile.value.entryOverrides[world] || {})
    : {};
  coreEntries.value = coreData.map(entry => ({
    uid: entry.uid,
    title: entry.title,
    enabled: coreBindings[entry.uid],
  }));
  worldviewEntries.value = worldData.map(entry => ({
    ...entry,
    baselineEnabled: getWorldbookEntryBaseline(world, entry.uid) ?? entry.enabled,
    enabled: typeof worldOverrides[entry.uid] === 'boolean' ? worldOverrides[entry.uid] : entry.enabled,
  }));
}

function changeCoreMode(event: Event) {
  const next = (event.target as HTMLSelectElement).value === 'group' ? 'group' : 'pair';
  const current = profile.value.mode;
  profile.value.coreBooks[current] = profile.value.coreBook;
  profile.value.mode = next;
  profile.value.coreBook = profile.value.coreBooks[next] || '';
  void refreshEntryLists(profileRefreshRevision);
}

function setCoreEntry(uid: string, event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  const mode = profile.value.mode;
  const book = profile.value.coreBook;
  if (!book) return;
  const byBook = profile.value.modeEntryBindings[mode][book] ||= {};
  byBook[uid] = enabled;
  const item = coreEntries.value.find(entry => entry.uid === uid);
  if (item) item.enabled = enabled;
}

function setWorldviewEntry(book: string, uid: string, event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  const overrides = profile.value.worldviewEntryOverrides[book] ||= {};
  overrides[uid] = enabled;
  const item = worldviewEntries.value.find(entry => entry.uid === uid);
  if (item) item.enabled = enabled;
}

function clearWorldviewEntryOverride(book: string, uid: string) {
  const overrides = profile.value.worldviewEntryOverrides[book];
  if (overrides) {
    delete overrides[uid];
    if (!Object.keys(overrides).length) delete profile.value.worldviewEntryOverrides[book];
  }
  // 旧版把世界观覆盖保存在 entryOverrides；清除时一并移除，避免旧值继续生效。
  const legacy = profile.value.entryOverrides[book];
  if (legacy) {
    delete legacy[uid];
    if (!Object.keys(legacy).length) delete profile.value.entryOverrides[book];
  }
  const item = worldviewEntries.value.find(entry => entry.uid === uid);
  if (item) {
    const prefix = '世界观｜';
    const comment = item.title.trim();
    const worldviewName = comment.startsWith(prefix) ? comment.slice(prefix.length).trim() : '';
    item.enabled = item.worldview && worldviewName
      ? worldviewName === profile.value.worldview
      : (getWorldbookEntryBaseline(book, uid) ?? item.baselineEnabled);
  }
}

async function refreshWorldviews(revision = profileRefreshRevision) {
  const book = profile.value.worldviewBook;
  const nextWorldviews = book ? await listWorldviews(book) : [];
  if (revision !== profileRefreshRevision || book !== profile.value.worldviewBook) return;
  worldviews.value = nextWorldviews;
  if (!worldviews.value.includes(profile.value.worldview)) profile.value.worldview = '';
}

watch(() => profile.value.worldviewBook, () => {
  const revision = profileRefreshRevision;
  void refreshWorldviews(revision);
  void refreshEntryLists(revision);
});
watch(() => profile.value.coreBook, () => { void refreshEntryLists(profileRefreshRevision); });

function changeProfileScope(enabled: boolean): void {
  try {
    setWorldbookProfileIndependent(enabled, profile.value);
    profile.value = getWorldbookModeProfile();
    profileInfo.value = getWorldbookProfileInfo();
    message.value = enabled ? '已为当前角色卡创建独立世界书配置' : '当前角色卡已恢复继承通用配置';
    error.value = false;
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : String(cause);
    error.value = true;
  }
}

async function chooseMode(next: 'native' | 'worldbook') {
  if (next === 'native') {
    busy.value = true;
    try {
      await restoreWorldbookMode();
      profile.value = getWorldbookModeProfile();
      selectedMode.value = 'native';
      message.value = '已切回柏宝绘原生模式，世界书状态已恢复';
      error.value = false;
    } catch (e) {
      message.value = e instanceof Error ? e.message : String(e);
      error.value = true;
    } finally { busy.value = false; }
    return;
  }
  selectedMode.value = 'worldbook';
  message.value = '已选择拾帧世界书模式；配置完成后点击「应用模式」';
  error.value = false;
}

async function applyMode() {
  busy.value = true;
  try {
    profile.value.enabled = true;
    profile.value.coreBooks[profile.value.mode] = profile.value.coreBook;
    saveWorldbookModeProfile(profile.value);
    await applyWorldbookMode();
    await refreshEntryLists();
    selectedMode.value = 'worldbook';
    message.value = '拾帧世界书模式已应用';
    error.value = false;
  } catch (e) {
    // 应用中途失败时立即尝试回滚；若宿主也无法恢复，则保留持久化快照供后续手动恢复。
    try { await restoreWorldbookMode(); } catch { /* keep the persisted recovery snapshot */ }
    profile.value = getWorldbookModeProfile();
    profile.value.enabled = false;
    saveWorldbookModeProfile(profile.value);
    message.value = e instanceof Error ? e.message : String(e);
    error.value = true;
  } finally { busy.value = false; }
}

let profileRefreshRevision = 0;
const profileChangeHandler = () => {
  const revision = ++profileRefreshRevision;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (revision !== profileRefreshRevision) return;
    // The settings page can remain mounted while ST switches chats or characters.
    // Reload the active profile instead of accidentally saving the previous card's draft
    // into the newly selected card.
    profile.value = getWorldbookModeProfile();
    profileInfo.value = getWorldbookProfileInfo();
    selectedMode.value = profile.value.enabled ? 'worldbook' : 'native';
    void refreshBooks();
  }));
};
const profileEventBindings: Array<[string, () => void]> = [];

onMounted(() => {
  void refreshBooks();
  const context = getContext();
  if (!context?.eventSource || !context.eventTypes) return;
  for (const event of [context.eventTypes.CHAT_CHANGED, context.eventTypes.CHARACTER_SELECTED]) {
    if (!event) continue;
    context.eventSource.on(event, profileChangeHandler);
    profileEventBindings.push([event, profileChangeHandler]);
  }
});

onUnmounted(() => {
  profileRefreshRevision++;
  const eventSource = getContext()?.eventSource;
  for (const [event, handler] of profileEventBindings) eventSource?.off?.(event, handler);
  profileEventBindings.length = 0;
});
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

    <section v-if="profileInfo.available" class="mode-card">
      <div class="mode-heading">角色卡世界书配置</div>
      <p class="mode-hint">当前角色卡：{{ profileInfo.name }}</p>
      <button v-if="!profileInfo.independent" class="bbi-btn" type="button" :disabled="busy" @click="changeProfileScope(true)">为当前角色卡创建独立配置</button>
      <button v-else class="bbi-btn" type="button" :disabled="busy" @click="changeProfileScope(false)">恢复继承通用配置</button>
      <p class="mode-hint">独立配置只影响当前角色卡；群聊和未识别角色继续使用通用配置。</p>
    </section>

    <section v-if="mode === 'worldbook'" class="mode-card">
      <div class="mode-heading">世界书配置</div>
      <label class="mode-field">
        <span>场景模式</span>
        <select :value="profile.mode" @change="changeCoreMode">
          <option value="pair">双人模式</option>
          <option value="group">群像模式</option>
        </select>
      </label>
      <label class="mode-field">
        <span>{{ profile.mode === 'pair' ? '双人' : '群像' }}核心世界书</span>
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
      <div v-if="coreEntries.length" class="mode-entry-group">
        <strong>{{ profile.mode === 'pair' ? '双人' : '群像' }}核心书条目绑定</strong>
        <label v-for="entry in coreEntries" :key="entry.uid" class="mode-entry">
          <input type="checkbox" :checked="entry.enabled" @change="setCoreEntry(entry.uid, $event)" />
          <span>{{ entry.title }}</span>
        </label>
      </div>
      <div v-if="worldviewEntries.length" class="mode-entry-group">
        <strong>世界观特化书条目覆盖</strong>
        <label v-for="entry in worldviewEntries" :key="entry.uid" class="mode-entry">
          <input type="checkbox" :checked="entry.enabled" @change="setWorldviewEntry(profile.worldviewBook, entry.uid, $event)" />
          <span>{{ entry.title }}<small v-if="entry.worldview">世界观条目；清除手动覆盖后恢复自动单选</small></span>
          <button v-if="Object.prototype.hasOwnProperty.call(profile.worldviewEntryOverrides[profile.worldviewBook] || {}, entry.uid) || Object.prototype.hasOwnProperty.call(profile.entryOverrides[profile.worldviewBook] || {}, entry.uid)" class="bbi-btn" type="button" :disabled="busy" @click="clearWorldviewEntryOverride(profile.worldviewBook, entry.uid)">清除覆盖</button>
        </label>
      </div>
      <p class="mode-hint">双人和群像分别保存核心书及逐条目启用状态。世界观特化书需使用「世界观｜名称」作为条目备注前缀。应用时只接管指定书籍，不卸载其他全局世界书；退出时恢复接管前的挂载与条目状态。</p>
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
.mode-entry-group { display: grid; gap: 7px; padding: 10px; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius-sm); }
.mode-entry-group > strong { color: var(--bbi-ink); font-size: 12px; }
.mode-entry { display: flex; align-items: flex-start; gap: 8px; color: var(--bbi-ink-soft); font-size: 12px; }
.mode-entry input { margin-top: 3px; }
.mode-entry span { display: grid; gap: 2px; }
.mode-entry small { color: var(--bbi-ink-soft); opacity: .75; }
.mode-message { color: var(--bbi-ink-soft); font-size: 12px; }
.mode-message.danger { color: var(--bbi-danger, #c44); }
@media (max-width: 480px) { .mode-options { grid-template-columns: 1fr; } }
</style>
