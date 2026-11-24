import { reactive } from 'vue';
import { getContext } from '@/st/context';

export interface PromptLibraryEntry {
  id: string;
  name: string;
  category: string;
  promptEn: string;
  promptZh: string;
  source: 'original' | 'other';
  sourceNote: string;
  imagePath: string;
  createdAt: number;
  updatedAt: number;
}
export interface WorkLibraryEntry {
  id: string;
  name: string;
  canonical: string;
  work: string;
}
interface LibraryStore {
  schemaVersion: 1;
  prompts: PromptLibraryEntry[];
  works: WorkLibraryEntry[];
  workDisplayNames: Record<string, string>;
}
const STORE_KEY = 'baibai_image_libraries';
const DEFAULT_CATEGORY = '其他';
const store = reactive<LibraryStore>({
  schemaVersion: 1,
  prompts: [],
  works: [],
  workDisplayNames: {},
});
let initialized = false;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
function normalizePrompt(value: unknown, index: number): PromptLibraryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<PromptLibraryEntry>;
  const name = cleanString(item.name);
  const promptEn = cleanString(item.promptEn);
  if (!name || !promptEn) return null;
  return {
    id: cleanString(item.id) || `prompt_legacy_${index}_${makeId('p')}`,
    name,
    category: cleanString(item.category) || DEFAULT_CATEGORY,
    promptEn,
    promptZh: cleanString(item.promptZh),
    source: item.source === 'other' ? 'other' : 'original',
    sourceNote: cleanString(item.sourceNote),
    imagePath: cleanString(item.imagePath),
    createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
  };
}
export function normalizeWorkEntries(raw: unknown): WorkLibraryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkLibraryEntry[] = [];
  const seen = new Set<string>();
  raw.forEach((value, index) => {
    if (!value || typeof value !== 'object') return;
    const item = value as Partial<WorkLibraryEntry>;
    const name = cleanString(item.name);
    const canonical = cleanString(item.canonical);
    const work = cleanString(item.work);
    if (!name || !canonical) return;
    const key = `${normalizeWorkName(name)}@@${normalizeWorkName(work)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: cleanString(item.id) || `work_legacy_${index}_${makeId('w')}`, name, canonical, work });
  });
  return out;
}
export function normalizeWorkName(value: string): string {
  return value.trim().toLowerCase().replace(/[\\s_]+/g, ' ');
}
export function parseWorkLibraryText(text: string): Array<Omit<WorkLibraryEntry, 'id'>> {
  const out: Array<Omit<WorkLibraryEntry, 'id'>> = [];
  for (const raw of String(text || '').split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    const canonical = line.slice(eq + 1).trim();
    if (!name || !canonical) continue;
    const match = canonical.match(/^([\\s\\S]+?)\\(([^()]+)\\)\\s*$/);
    out.push({ name, canonical, work: match ? match[2].trim() : '' });
  }
  return out;
}
export function parseWorkLibraryJson(text: string): Array<Omit<WorkLibraryEntry, 'id'>> {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('不是有效的 JSON'); }
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries) ? (data as { entries: unknown[] }).entries : null;
  if (!rows) throw new Error('JSON 里没找到 entries 数组');
  return rows.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const name = cleanString(item.name);
    const canonical = cleanString(item.canonical);
    return name && canonical ? [{ name, canonical, work: cleanString(item.work) }] : [];
  });
}
export function importWorkEntries(existing: WorkLibraryEntry[], incoming: Array<Omit<WorkLibraryEntry, 'id'>>): { entries: WorkLibraryEntry[]; added: number; skipped: number } {
  const entries = [...existing];
  const seen = new Set(entries.map(item => `${normalizeWorkName(item.name)}@@${normalizeWorkName(item.work)}`));
  let added = 0;
  let skipped = 0;
  for (const item of incoming) {
    const name = cleanString(item.name);
    const canonical = cleanString(item.canonical);
    const work = cleanString(item.work);
    if (!name || !canonical) continue;
    const key = `${normalizeWorkName(name)}@@${normalizeWorkName(work)}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    entries.push({ id: makeId('work'), name, canonical, work });
    added++;
  }
  return { entries, added, skipped };
}
export function findWorkEntry(entries: WorkLibraryEntry[], name: string): WorkLibraryEntry | undefined {
  const needle = normalizeWorkName(name);
  if (!needle) return undefined;
  for (const entry of entries) {
    const aliases = entry.name.split('|').map(value => normalizeWorkName(value)).filter(Boolean);
    const bare = normalizeWorkName(entry.canonical.replace(/\\([^()]*\\)\\s*$/, ''));
    if (bare) aliases.push(bare);
    if (aliases.includes(needle)) return entry;
  }
  return undefined;
}
export const libraries = store;

export function initLibraries(): void {
  if (initialized) return;
  const ctx = getContext();
  if (!ctx?.extensionSettings) return;
  initialized = true;
  const raw = ctx.extensionSettings[STORE_KEY] as Partial<LibraryStore> | undefined;
  if (!raw || typeof raw !== 'object') return;
  store.prompts = Array.isArray(raw.prompts) ? raw.prompts.map(normalizePrompt).filter((item): item is PromptLibraryEntry => !!item) : [];
  store.works = normalizeWorkEntries(raw.works);
  store.workDisplayNames = raw.workDisplayNames && typeof raw.workDisplayNames === 'object' && !Array.isArray(raw.workDisplayNames)
    ? Object.fromEntries(Object.entries(raw.workDisplayNames).filter(([key, value]) => !!cleanString(key) && typeof value === 'string'))
    : {};
}
export function persistLibraries(): void {
  const ctx = getContext();
  if (!ctx?.extensionSettings) return;
  const snapshot: LibraryStore = {
    schemaVersion: 1,
    prompts: JSON.parse(JSON.stringify(store.prompts)) as PromptLibraryEntry[],
    works: JSON.parse(JSON.stringify(store.works)) as WorkLibraryEntry[],
    workDisplayNames: { ...store.workDisplayNames },
  };
  ctx.extensionSettings[STORE_KEY] = snapshot;
  ctx.saveSettingsDebounced?.();
}
export function newPromptEntry(): PromptLibraryEntry {
  const now = Date.now();
  return { id: makeId('prompt'), name: '', category: DEFAULT_CATEGORY, promptEn: '', promptZh: '', source: 'original', sourceNote: '', imagePath: '', createdAt: now, updatedAt: now };
}
export function upsertPromptEntry(entry: PromptLibraryEntry): void {
  const normalized = normalizePrompt(entry, store.prompts.length);
  if (!normalized) throw new Error('名称和画面提示词不能为空');
  normalized.updatedAt = Date.now();
  const index = store.prompts.findIndex(item => item.id === normalized.id);
  if (index >= 0) store.prompts.splice(index, 1, normalized);
  else store.prompts.unshift(normalized);
  persistLibraries();
}
export function removePromptEntries(ids: string[]): PromptLibraryEntry[] {
  const selected = new Set(ids);
  const removed = store.prompts.filter(item => selected.has(item.id));
  store.prompts = store.prompts.filter(item => !selected.has(item.id));
  persistLibraries();
  return removed;
}
export function upsertWorkEntry(entry: WorkLibraryEntry): void {
  const normalized = normalizeWorkEntries([entry])[0];
  if (!normalized) throw new Error('中文名称和英文 Tag 不能为空');
  const index = store.works.findIndex(item => item.id === normalized.id);
  if (index >= 0) store.works.splice(index, 1, normalized);
  else store.works.push(normalized);
  persistLibraries();
}
export function removeWorkEntry(id: string): void {
  store.works = store.works.filter(item => item.id !== id);
  persistLibraries();
}
export function importWorks(incoming: Array<Omit<WorkLibraryEntry, 'id'>>): { added: number; skipped: number } {
  const result = importWorkEntries(store.works, incoming);
  store.works = result.entries;
  persistLibraries();
  return { added: result.added, skipped: result.skipped };
}
export function renameWorkDisplayName(work: string, displayName: string): void {
  if (!work) return;
  const next = { ...store.workDisplayNames };
  const value = displayName.trim();
  if (value) next[work] = value;
  else delete next[work];
  store.workDisplayNames = next;
  persistLibraries();
}
