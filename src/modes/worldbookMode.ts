import { getContext } from '@/st/context';

/**
 * 拾帧世界书模式的柏宝绘适配层。
 *
 * 仅本模块允许改写 ST 的全局世界书挂载状态；调用方只传入书名与条目覆盖，
 * 不直接操作 world_info / selected_world_info。所有写操作串行化，并在首次接管时
 * 保存原始状态，退出时按原样恢复。设置存于独立 extension_settings 键，不污染
 * 柏宝绘原有 ImageSettings，也不覆盖其原生生图配置。
 */

export type WorldbookEntryOverrides = Record<string, Record<string, boolean>>;

export type WorldbookSceneMode = 'pair' | 'group';
export type WorldbookModeEntryBindings = Record<WorldbookSceneMode, Record<string, Record<string, boolean>>>;

export interface WorldbookModeProfile {
  profileType: 'inherit' | 'independent';
  enabled: boolean;
  mode: WorldbookSceneMode;
  coreBook: string;
  coreBooks: Record<WorldbookSceneMode, string>;
  worldviewBook: string;
  worldview: string;
  entryOverrides: WorldbookEntryOverrides;
  modeEntryBindings: WorldbookModeEntryBindings;
}

interface EntryState {
  [uid: string]: boolean;
}

interface Snapshot {
  globalSelection?: string[];
  entries: Record<string, EntryState>;
  managedBooks: string[];
}

interface PersistedWorldbookMode {
  schemaVersion: 3;
  profile: WorldbookModeProfile;
  defaultProfile: WorldbookModeProfile;
  cardProfiles: Record<string, WorldbookModeProfile>;
  activeProfileKey: string;
  snapshot: Snapshot;
}

interface WorldInfoEntry {
  disable?: boolean;
  comment?: string;
  [key: string]: unknown;
}

interface WorldInfoData {
  entries: Record<string, WorldInfoEntry>;
  [key: string]: unknown;
}

interface WorldInfoRuntime {
  selected_world_info?: string[];
  world_names?: string[];
  world_info?: { globalSelect?: string[] };
  saveWorldInfo?: (name: string, data: WorldInfoData, immediately?: boolean) => Promise<void>;
}

const STORAGE_KEY = 'baibai_image_worldbook_mode';
const WORLDVIEW_PREFIX = '世界观｜';
const DEFAULT_PROFILE: WorldbookModeProfile = {
  profileType: 'inherit',
  enabled: false,
  mode: 'pair',
  coreBook: '',
  coreBooks: { pair: '', group: '' },
  worldviewBook: '',
  worldview: '',
  entryOverrides: {},
  modeEntryBindings: { pair: {}, group: {} },
};

let runtimePromise: Promise<WorldInfoRuntime> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeProfile(input: unknown): WorldbookModeProfile {
  const source = input && typeof input === 'object' ? input as Partial<WorldbookModeProfile> : {};
  const mode: WorldbookSceneMode = source.mode === 'group' ? 'group' : 'pair';
  const legacyCore = typeof source.coreBook === 'string' ? source.coreBook : '';
  const coreBooks = {
    pair: typeof source.coreBooks?.pair === 'string' ? source.coreBooks.pair : (mode === 'pair' ? legacyCore : ''),
    group: typeof source.coreBooks?.group === 'string' ? source.coreBooks.group : (mode === 'group' ? legacyCore : ''),
  };
  const modeBindings = source.modeEntryBindings && typeof source.modeEntryBindings === 'object'
    ? source.modeEntryBindings : DEFAULT_PROFILE.modeEntryBindings;
  return {
    ...clone(DEFAULT_PROFILE),
    profileType: source.profileType === 'independent' ? 'independent' : 'inherit',
    enabled: source.enabled === true,
    mode,
    coreBook: coreBooks[mode] || legacyCore,
    coreBooks,
    worldviewBook: typeof source.worldviewBook === 'string' ? source.worldviewBook : '',
    worldview: typeof source.worldview === 'string' ? source.worldview : '',
    entryOverrides: source.entryOverrides && typeof source.entryOverrides === 'object' ? clone(source.entryOverrides) : {},
    modeEntryBindings: {
      pair: modeBindings.pair && typeof modeBindings.pair === 'object' ? clone(modeBindings.pair) : {},
      group: modeBindings.group && typeof modeBindings.group === 'object' ? clone(modeBindings.group) : {},
    },
  };
}

function currentProfileIdentity(): { key: string; name: string } | null {
  const ctx = getContext();
  if (!ctx || (ctx.groupId != null && String(ctx.groupId).trim())) return null;
  const index = Number(ctx.characterId);
  const character = Number.isInteger(index) && index >= 0 ? ctx.characters?.[index] : undefined;
  const avatar = String(character?.avatar ?? '').trim();
  if (!avatar) return null;
  return { key: avatar, name: String(character?.name ?? avatar).trim() || avatar };
}

function readPersisted(): PersistedWorldbookMode {
  const raw = getContext()?.extensionSettings?.[STORAGE_KEY];
  if (!raw || typeof raw !== 'object') {
    return {
      schemaVersion: 3,
      profile: clone(DEFAULT_PROFILE),
      defaultProfile: clone(DEFAULT_PROFILE),
      cardProfiles: {},
      activeProfileKey: currentProfileIdentity()?.key ?? '',
      snapshot: { entries: {}, managedBooks: [] },
    };
  }
  const value = raw as Partial<PersistedWorldbookMode> & { profile?: unknown; defaultProfile?: unknown; cardProfiles?: unknown };
  const defaultProfile = normalizeProfile(value.defaultProfile ?? value.profile);
  const cardProfiles: Record<string, WorldbookModeProfile> = {};
  if (value.cardProfiles && typeof value.cardProfiles === 'object') {
    for (const [key, item] of Object.entries(value.cardProfiles)) {
      if (key && item && typeof item === 'object') cardProfiles[key] = normalizeProfile(item);
    }
  }
  const identity = currentProfileIdentity();
  const stored = identity ? cardProfiles[identity.key] : undefined;
  const profile = stored?.profileType === 'independent'
    ? normalizeProfile({ ...stored, profileType: 'independent' })
    : normalizeProfile({ ...defaultProfile, profileType: 'inherit' });
  const snapshot: Snapshot = value.snapshot && typeof value.snapshot === 'object'
    ? value.snapshot
    : { entries: {}, managedBooks: [] };
  return {
    schemaVersion: 3,
    profile,
    defaultProfile,
    cardProfiles,
    activeProfileKey: identity?.key ?? '',
    snapshot: {
      globalSelection: Array.isArray(snapshot.globalSelection) ? snapshot.globalSelection.filter((x): x is string => typeof x === 'string') : undefined,
      entries: snapshot.entries && typeof snapshot.entries === 'object' ? snapshot.entries : {},
      managedBooks: Array.isArray(snapshot.managedBooks) ? snapshot.managedBooks.filter((x): x is string => typeof x === 'string') : [],
    },
  };
}

function persist(value: PersistedWorldbookMode): void {
  const ctx = getContext();
  if (!ctx?.extensionSettings) throw new Error('酒馆设置尚未就绪，无法保存世界书模式配置');
  ctx.extensionSettings[STORAGE_KEY] = clone(value);
  ctx.saveSettingsDebounced?.();
}

async function worldInfoRuntime(): Promise<WorldInfoRuntime> {
  const modulePath: string = '/scripts/world-info.js';
  runtimePromise ??= import(/* @vite-ignore */ modulePath)
    .then(module => module as unknown as WorldInfoRuntime);
  return runtimePromise;
}

async function loadBook(name: string): Promise<WorldInfoData> {
  const data = await getContext()?.loadWorldInfo?.(name);
  if (!data || !data.entries || typeof data.entries !== 'object') {
    throw new Error(`无法读取世界书「${name}」`);
  }
  return data as WorldInfoData;
}

async function saveBook(name: string, data: WorldInfoData): Promise<void> {
  const runtime = await worldInfoRuntime();
  if (typeof runtime.saveWorldInfo !== 'function') throw new Error('当前酒馆版本未提供 saveWorldInfo 接口');
  await runtime.saveWorldInfo(name, data, true);
}

function currentGlobalSelection(runtime: WorldInfoRuntime): string[] {
  const source = runtime.selected_world_info ?? runtime.world_info?.globalSelect ?? [];
  return Array.isArray(source) ? [...new Set(source.filter(x => typeof x === 'string'))] : [];
}

async function writeGlobalSelection(runtime: WorldInfoRuntime, names: string[]): Promise<void> {
  const normalized = [...new Set(names.filter(Boolean))];
  if (!runtime.world_info || !Array.isArray(runtime.selected_world_info)) {
    throw new Error('当前酒馆未提供可写入的全局世界书挂载状态');
  }
  runtime.selected_world_info.splice(0, runtime.selected_world_info.length, ...normalized);
  runtime.world_info.globalSelect = [...normalized];
  getContext()?.saveSettingsDebounced?.();
  // ST 的原生世界书选择器监听此事件刷新 UI；动态取 eventSource，避免引入第二套事件总线。
  const modulePath: string = '/script.js';
  const script = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  const source = script.eventSource as { emit?: (event: string) => Promise<void> | void } | undefined;
  const types = script.event_types as Record<string, string> | undefined;
  const event = types?.WORLDINFO_SETTINGS_UPDATED;
  if (event) await source?.emit?.(event);
}

function ensureSnapshot(snapshot: Snapshot, runtime: WorldInfoRuntime): void {
  if (!snapshot.globalSelection) snapshot.globalSelection = currentGlobalSelection(runtime);
}

async function captureBook(snapshot: Snapshot, name: string): Promise<void> {
  if (Object.prototype.hasOwnProperty.call(snapshot.entries, name)) return;
  const data = await loadBook(name);
  snapshot.entries[name] = Object.fromEntries(
    Object.entries(data.entries).map(([uid, entry]) => [uid, Boolean(entry.disable)]),
  );
}

async function applyEntryOverrides(name: string, overrides: Record<string, boolean>, snapshot: Snapshot): Promise<void> {
  if (!Object.keys(overrides).length) return;
  await captureBook(snapshot, name);
  const data = await loadBook(name);
  let changed = false;
  for (const [uid, enabled] of Object.entries(overrides)) {
    const entry = data.entries[uid];
    if (!entry) continue;
    const disable = !enabled;
    if (Boolean(entry.disable) !== disable) {
      entry.disable = disable;
      changed = true;
    }
  }
  if (changed) await saveBook(name, data);
}

async function restoreBook(name: string, snapshot: Snapshot): Promise<void> {
  const original = snapshot.entries[name];
  if (!original) return;
  const data = await loadBook(name);
  let changed = false;
  for (const [uid, disabled] of Object.entries(original)) {
    const entry = data.entries[uid];
    if (!entry || Boolean(entry.disable) === disabled) continue;
    entry.disable = disabled;
    changed = true;
  }
  if (changed) await saveBook(name, data);
  delete snapshot.entries[name];
}

/** 读取独立的世界书模式配置；不会改变当前酒馆状态。 */
export function getWorldbookModeProfile(): WorldbookModeProfile {
  return clone(readPersisted().profile);
}

/** 写入模式配置草稿；保存配置本身不会自动挂载世界书。 */
export function saveWorldbookModeProfile(profile: WorldbookModeProfile): void {
  const state = readPersisted();
  const mode: WorldbookSceneMode = profile.mode === 'group' ? 'group' : 'pair';
  const coreBook = String(profile.coreBook ?? '').trim();
  const normalized = normalizeProfile({
    ...profile,
    profileType: profile.profileType,
    enabled: profile.enabled === true,
    mode,
    coreBook,
    coreBooks: { ...profile.coreBooks, [mode]: coreBook },
    worldviewBook: String(profile.worldviewBook ?? '').trim(),
    worldview: String(profile.worldview ?? '').trim(),
    entryOverrides: clone(profile.entryOverrides ?? {}),
    modeEntryBindings: clone(profile.modeEntryBindings ?? DEFAULT_PROFILE.modeEntryBindings),
  });
  const identity = currentProfileIdentity();
  if (normalized.profileType === 'independent' && identity) {
    state.cardProfiles[identity.key] = { ...normalized, profileType: 'independent' };
  } else {
    state.defaultProfile = { ...normalized, profileType: 'inherit' };
  }
  state.profile = normalized;
  state.activeProfileKey = identity?.key ?? '';
  persist(state);
}

export function getWorldbookProfileInfo(): { available: boolean; key: string; name: string; independent: boolean } {
  const identity = currentProfileIdentity();
  if (!identity) return { available: false, key: '', name: '', independent: false };
  const state = readPersisted();
  return {
    available: true,
    key: identity.key,
    name: identity.name,
    independent: state.cardProfiles[identity.key]?.profileType === 'independent',
  };
}

/** 为当前角色卡创建/删除独立配置；创建时以当前编辑草稿为初始值。 */
export function setWorldbookProfileIndependent(enabled: boolean, draft?: WorldbookModeProfile): void {
  const identity = currentProfileIdentity();
  if (!identity) throw new Error('当前为群聊或角色身份不可用，无法设置角色卡独立世界书配置');
  const state = readPersisted();
  if (enabled) {
    const source = draft ?? state.defaultProfile;
    state.cardProfiles[identity.key] = normalizeProfile({ ...source, profileType: 'independent' });
  } else {
    delete state.cardProfiles[identity.key];
  }
  state.profile = enabled
    ? normalizeProfile({ ...state.cardProfiles[identity.key], profileType: 'independent' })
    : normalizeProfile({ ...state.defaultProfile, profileType: 'inherit' });
  state.activeProfileKey = identity.key;
  persist(state);
}

/** 当前可选世界书名称，使用 ST 已加载的书名列表，不另发自定义 API。 */
export async function listWorldbooks(): Promise<string[]> {
  const runtime = await worldInfoRuntime();
  const names = runtime.world_names ?? getContext()?.getWorldInfoNames?.();
  return Array.isArray(names) ? [...new Set(names.filter((x): x is string => typeof x === 'string'))].sort((a, b) => a.localeCompare(b, 'zh')) : [];
}

/** 读取指定世界书的条目列表与当前启用状态，用于模式内逐条绑定。 */
export async function listWorldbookEntries(bookName: string): Promise<Array<{ uid: string; title: string; enabled: boolean; worldview: boolean }>> {
  const name = bookName.trim();
  if (!name) return [];
  const data = await loadBook(name);
  return Object.entries(data.entries)
    .sort((a, b) => Number(a[1].order ?? 100) - Number(b[1].order ?? 100))
    .map(([uid, entry]) => ({
      uid,
      title: String(entry.comment ?? '').trim() || (Array.isArray(entry.key) ? entry.key.join('、') : '') || `UID ${uid}`,
      enabled: !Boolean(entry.disable),
      worldview: String(entry.comment ?? '').trim().startsWith(WORLDVIEW_PREFIX),
    }));
}

async function applyModeEntryBindings(
  name: string,
  mode: WorldbookSceneMode,
  profile: WorldbookModeProfile,
  snapshot: Snapshot,
): Promise<void> {
  if (!name) return;
  await captureBook(snapshot, name);
  const data = await loadBook(name);
  const bindings = profile.modeEntryBindings[mode][name] ?? (profile.modeEntryBindings[mode][name] = {});
  let changed = false;
  for (const [uid, entry] of Object.entries(data.entries)) {
    if (typeof bindings[uid] !== 'boolean') bindings[uid] = !Boolean(entry.disable);
    const disable = !bindings[uid];
    if (Boolean(entry.disable) !== disable) {
      entry.disable = disable;
      changed = true;
    }
  }
  if (changed) await saveBook(name, data);
}

/** 读取世界观特化书中以「世界观｜」开头的条目名称。 */
export async function listWorldviews(bookName: string): Promise<string[]> {
  const name = bookName.trim();
  if (!name) return [];
  const data = await loadBook(name);
  return Object.values(data.entries)
    .map(entry => String(entry.comment ?? '').trim())
    .filter(comment => comment.startsWith(WORLDVIEW_PREFIX))
    .map(comment => comment.slice(WORLDVIEW_PREFIX.length).trim())
    .filter(Boolean);
}

/**
 * 应用当前世界书模式。仅接管核心书和世界观书；其他全局书保持原样。
 * 重复应用是幂等的。切换书籍时先恢复上一轮由本模块修改的条目和挂载状态。
 */
export function applyWorldbookMode(): Promise<void> {
  return serialize(async () => {
    const state = readPersisted();
    const { profile, snapshot } = state;
    if (!profile.enabled) throw new Error('世界书模式尚未启用');
    const core = (profile.coreBooks[profile.mode] || profile.coreBook).trim();
    profile.coreBook = core;
    profile.coreBooks[profile.mode] = core;
    const worldviewBook = profile.worldviewBook.trim();
    const worldview = profile.worldview.trim();
    if (!core || !worldviewBook || !worldview) throw new Error('请先选择核心世界书、世界观特化书和世界观');
    if (core === worldviewBook) throw new Error('核心世界书与世界观特化书不能是同一本');
    const available = new Set(await listWorldbooks());
    for (const name of [core, worldviewBook]) if (!available.has(name)) throw new Error(`世界书「${name}」不存在，请刷新酒馆世界书列表`);
    const worldviews = await listWorldviews(worldviewBook);
    if (!worldviews.includes(worldview)) throw new Error(`世界观「${worldview}」不在「${worldviewBook}」中`);

    const runtime = await worldInfoRuntime();
    ensureSnapshot(snapshot, runtime);

    try {
      // 将恢复上一轮接管状态也纳入事务；恢复任一本失败时，统一走下方回滚路径。
      const previousManaged = new Set(snapshot.managedBooks);
      for (const name of Object.keys(snapshot.entries)) await restoreBook(name, snapshot);
      const current = currentGlobalSelection(runtime);
      const next = current.filter(name => !previousManaged.has(name));
      for (const name of [core, worldviewBook]) if (!next.includes(name)) next.push(name);

      // 在任何全局挂载或条目写入前持久化完整恢复点，避免中途异常后丢失回滚依据。
      await captureBook(snapshot, core);
      await captureBook(snapshot, worldviewBook);
      snapshot.managedBooks = [...new Set([...snapshot.managedBooks, core, worldviewBook])];
      state.snapshot = snapshot;
      persist(state);

      await writeGlobalSelection(runtime, next);
      await applyEntryOverrides(core, profile.entryOverrides[core] ?? {}, snapshot);
      await applyEntryOverrides(worldviewBook, profile.entryOverrides[worldviewBook] ?? {}, snapshot);
      await applyModeEntryBindings(core, profile.mode, profile, snapshot);

      // 自动世界观单选：只有符合命名约定的条目才由此功能管理。
      await captureBook(snapshot, worldviewBook);
      const data = await loadBook(worldviewBook);
      let changed = false;
      for (const [uid, entry] of Object.entries(data.entries)) {
        const comment = String(entry.comment ?? '').trim();
        if (!comment.startsWith(WORLDVIEW_PREFIX)) continue;
        const entryName = comment.slice(WORLDVIEW_PREFIX.length).trim();
        const hasOverride = Object.prototype.hasOwnProperty.call(profile.entryOverrides[worldviewBook] ?? {}, uid);
        if (hasOverride) continue;
        const disable = entryName !== worldview;
        if (Boolean(entry.disable) !== disable) {
          entry.disable = disable;
          changed = true;
        }
      }
      if (changed) await saveBook(worldviewBook, data);

      state.snapshot = snapshot;
      persist(state);
    } catch (error) {
      // 任一世界书写入失败时，尽力恢复接管前的挂载和条目状态，避免半应用状态残留。
      try {
        if (snapshot.globalSelection) await writeGlobalSelection(runtime, snapshot.globalSelection);
        for (const name of Object.keys(snapshot.entries)) await restoreBook(name, snapshot);
        snapshot.managedBooks = [];
        snapshot.globalSelection = undefined;
        profile.enabled = false;
        state.snapshot = snapshot;
        persist(state);
      } catch (rollbackError) {
        // 恢复失败时保留完整快照，后续可由用户切回原生模式或重启恢复。
        state.snapshot = snapshot;
        persist(state);
        console.warn('[柏宝绘] 世界书模式应用失败，自动回滚未完全成功；恢复快照已保留。', rollbackError);
      }
      throw error;
    }
  });
}

/** 退出世界书模式，恢复本模块接管前的挂载状态和条目 disable 状态。 */
export function restoreWorldbookMode(disableProfile = true): Promise<void> {
  return serialize(async () => {
    const state = readPersisted();
    const runtime = await worldInfoRuntime();
    const { snapshot } = state;
    const current = currentGlobalSelection(runtime);
    const managed = new Set(snapshot.managedBooks);
    if (snapshot.globalSelection) {
      // 恢复原始列表顺序；保留模式运行期间用户新增的非托管书，尊重用户移除的非托管书。
      const restored = snapshot.globalSelection.filter(name => managed.has(name) || current.includes(name));
      for (const name of current) {
        if (!managed.has(name) && !restored.includes(name)) restored.push(name);
      }
      await writeGlobalSelection(runtime, restored);
    }
    for (const name of Object.keys(snapshot.entries)) await restoreBook(name, snapshot);
    snapshot.managedBooks = [];
    snapshot.globalSelection = undefined;
    if (disableProfile) state.profile.enabled = false;
    state.snapshot = snapshot;
    persist(state);
  });
}


let lifecycleBound = false;
let activeProfileKey = '';

/** Bind chat/character changes so card-specific worldbook profiles never leak across chats. */
export function bindWorldbookModeLifecycle(): boolean {
  if (lifecycleBound) return true;
  const ctx = getContext();
  if (!ctx?.eventSource || !ctx.eventTypes) return false;
  lifecycleBound = true;
  activeProfileKey = currentProfileIdentity()?.key ?? '';
  const onProfileChange = async () => {
    const previousKey = activeProfileKey;
    let nextKey = currentProfileIdentity()?.key ?? '';
    for (let attempt = 0; attempt < 20 && nextKey === previousKey; attempt++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      nextKey = currentProfileIdentity()?.key ?? '';
    }
    if (nextKey === previousKey) return;
    activeProfileKey = nextKey;
    try {
      await restoreWorldbookMode(false);
      if (getWorldbookModeProfile().enabled) await applyWorldbookMode();
    } catch (error) {
      console.warn('[柏宝绘] 切换角色卡世界书配置失败；保留恢复快照供下次重试。', error);
      activeProfileKey = previousKey;
    }
  };
  const chatChanged = ctx.eventTypes.CHAT_CHANGED;
  const characterSelected = ctx.eventTypes.CHARACTER_SELECTED;
  if (chatChanged) ctx.eventSource.on(chatChanged, onProfileChange);
  if (characterSelected) ctx.eventSource.on(characterSelected, onProfileChange);
  if (getWorldbookModeProfile().enabled) {
    void applyWorldbookMode().catch(error => console.warn('[柏宝绘] 启动时恢复世界书模式失败。', error));
  }
  return true;
}
