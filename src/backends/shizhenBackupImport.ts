import type { NaiVibeData } from '@/state/settings';
import { parseShizhenVibeJson } from '@/backends/shizhenVibeImport';
import { clampVibeStrength } from '@/backends/vibeStore';

export interface ShizhenImportArtist {
  name: string;
  prompt: string;
  quality: string;
  negative: string;
}
export interface ShizhenImportTarget { comboIndex: number; size: string }
export interface ShizhenImportBinding {
  characterIndex: string;
  characterName: string;
  body: ShizhenImportTarget;
  statusBar: ShizhenImportTarget;
  egg: ShizhenImportTarget;
}
export interface ShizhenImportVibe {
  sourcePoolId: string;
  name: string;
  group: string;
  strength: number;
  data: NaiVibeData;
}
export interface ShizhenBackupPlan {
  artists: ShizhenImportArtist[];
  combos: Array<{ name: string; artistIndex: number; vibeIndex: number }>;
  vibeGroups: string[];
  global: { body: ShizhenImportTarget; statusBar: ShizhenImportTarget; egg: ShizhenImportTarget };
  bindings: ShizhenImportBinding[];
  vibes: ShizhenImportVibe[];
  unsupportedVibes: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function index(value: unknown): number {
  const n = Number(value ?? -1);
  return Number.isInteger(n) && n >= 0 ? n : -1;
}
function size(value: unknown): string {
  return typeof value === 'string' && /^\d{2,4}\s*[x×]\s*\d{2,4}$/i.test(value.trim()) ? value.trim() : '';
}
function target(combo: unknown, dimension: unknown): ShizhenImportTarget {
  return { comboIndex: index(combo), size: size(dimension) };
}
function strength(value: unknown, fallback = 0.6): number {
  return clampVibeStrength(value, fallback);
}

/** Parse the exact Shizhen full-backup schema without mutating either source or destination. */
export function parseShizhenFullBackup(input: unknown, currentModelKey: string): ShizhenBackupPlan {
  const root = record(input);
  const data = record(root.data ?? input);
  if (root.format !== 'shizhen-lite-full-backup' && !Array.isArray(data.presets) && !Array.isArray(data.combinations)) {
    throw new Error('这不是可识别的拾帧完整备份；请使用拾帧「导出设置 JSON」生成的文件。');
  }

  const presets = Array.isArray(data.presets) ? data.presets : [];
  const artists = presets.map((raw, i) => {
    const item = record(raw);
    return {
      name: String(item.name ?? `画师串 ${i + 1}`).trim() || `画师串 ${i + 1}`,
      prompt: String(item.positive ?? item.prompt ?? ''),
      quality: String(item.quality ?? ''),
      negative: String(item.negative ?? ''),
    };
  });
  const combinations = Array.isArray(data.combinations) ? data.combinations : [];
  const combos = combinations.map((raw, i) => {
    const item = record(raw);
    return {
      name: String(item.name ?? `组合 ${i + 1}`).trim() || `组合 ${i + 1}`,
      artistIndex: index(item.artistIndex),
      vibeIndex: index(item.vibeIndex),
    };
  });

  const sourceGroups = Array.isArray(data.vibes) ? data.vibes : [];
  const groups = sourceGroups.map((raw, i) => {
    const item = record(raw);
    return { raw: item, name: String(item.name ?? item.title ?? `Vibe 组 ${i + 1}`).trim() || `Vibe 组 ${i + 1}` };
  });
  const vibeGroups = groups.map(group => group.name);
  const pool = Array.isArray(data.vibePool) ? data.vibePool : [];
  const poolById = new Map<string, Record<string, unknown>>();
  for (const raw of pool) {
    const item = record(raw);
    if (typeof item.id === 'string' && item.id) poolById.set(item.id, item);
  }

  const vibes: ShizhenImportVibe[] = [];
  let unsupportedVibes = 0;
  const consumedPoolIds = new Set<string>();
  const appendVibe = (raw: Record<string, unknown>, groupName: string, refStrength?: unknown, refInfo?: unknown) => {
    const parsed = parseShizhenVibeJson(raw, currentModelKey, String(raw.name ?? raw.title ?? '导入的 Vibe'));
    const item = parsed.items[0];
    if (!item) { unsupportedVibes++; return; }
    const dataCopy: NaiVibeData = {
      image: item.data.image,
      thumbnail: typeof raw.thumb === 'string' && raw.thumb ? raw.thumb
        : typeof raw.thumbnail === 'string' && raw.thumbnail ? raw.thumbnail
        : item.data.thumbnail,
      encodings: Object.fromEntries(Object.entries(item.data.encodings).map(([key, value]) => [
        key, { encoding: value.encoding, infoExtracted: strength(refInfo, value.infoExtracted) },
      ])),
    };
    vibes.push({
      sourcePoolId: String(raw.id ?? ''),
      name: String(raw.name ?? raw.title ?? item.name ?? '导入的 Vibe').trim() || '导入的 Vibe',
      group: groupName,
      strength: strength(refStrength, item.strength),
      data: dataCopy,
    });
  };

  for (const group of groups) {
    const refs = Array.isArray(group.raw.refs) ? group.raw.refs : [];
    if (refs.length) {
      for (const rawRef of refs) {
        const ref = record(rawRef);
        const poolId = String(ref.poolId ?? '');
        const entry = poolById.get(poolId);
        if (!entry) { unsupportedVibes++; continue; }
        consumedPoolIds.add(poolId);
        appendVibe(entry, group.name, ref.strength, ref.informationExtracted);
      }
      continue;
    }
    // Older Shizhen backups stored complete entries directly on each Vibe group.
    if (Array.isArray(group.raw.entries)) {
      for (const rawEntry of group.raw.entries) appendVibe(record(rawEntry), group.name);
    }
  }

  // Keep pool-only references too; they are not necessarily members of a named group.
  for (const raw of pool) {
    const item = record(raw);
    const id = String(item.id ?? '');
    if (!id || consumedPoolIds.has(id)) continue;
    appendVibe(item, '');
  }

  const global = {
    body: target(data.globalComboIndex, data.bodySize),
    statusBar: target(data.sbComboIndex, data.sbSize),
    egg: target(data.eggComboIndex, data.eggSize),
  };
  const bindings = (Array.isArray(data.bindings) ? data.bindings : []).map(raw => {
    const item = record(raw);
    return {
      characterIndex: String(item.characterKey ?? ''),
      characterName: String(item.characterName ?? ''),
      body: target(item.combinationIndex, item.bodySize),
      statusBar: target(item.sbComboIndex, item.sbSize),
      egg: target(item.eggComboIndex, item.eggSize),
    };
  }).filter(item => item.characterIndex || item.characterName);

  return { artists, combos, vibeGroups, global, bindings, vibes, unsupportedVibes };
}
