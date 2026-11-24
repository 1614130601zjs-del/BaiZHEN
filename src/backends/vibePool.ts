import type { NaiSettings, NaiVibe, NaiVibeData, NaiVibeGroup, NaiVibePoolItem } from '@/state/settings';
export function migrateLegacyVibeLibrary(vibes: readonly NaiVibe[]): { pool: NaiVibePoolItem[]; groups: NaiVibeGroup[] } {
  const pool: NaiVibePoolItem[] = [];
  const groups = new Map<string, NaiVibeGroup>();
  const resourceIds = new Set<string>();
  for (const vibe of vibes) {
    if (!resourceIds.has(vibe.id)) {
      const { strength: _strength, enabled: _enabled, group: _group, ...resource } = vibe;
      pool.push(resource); resourceIds.add(vibe.id);
    }
    const name = vibe.group.trim();
    const id = name ? `legacy-group:${name}` : 'legacy-group:ungrouped';
    let group = groups.get(id);
    if (!group) { group = { id, name: name || '未分组', refs: [] }; groups.set(id, group); }
    if (!group.refs.some(ref => ref.poolId === vibe.id)) group.refs.push({ poolId: vibe.id, strength: vibe.strength, enabled: vibe.enabled, ...(vibe.informationExtracted !== undefined ? { informationExtracted: vibe.informationExtracted } : {}) });
  }
  return { pool, groups: [...groups.values()] };
}
export function materializeVibeGroup(group: NaiVibeGroup, pool: readonly NaiVibePoolItem[]): NaiVibe[] {
  const byId = new Map(pool.map(item => [item.id, item]));
  return group.refs.flatMap(ref => {
    const resource = byId.get(ref.poolId);
    return resource ? [{ ...resource, strength: ref.strength, enabled: ref.enabled, group: group.name, informationExtracted: ref.informationExtracted ?? resource.informationExtracted }] : [];
  });
}

/** 获取当前请求应使用的 Vibe 列表；选中池分组时不再读取旧扁平列表。 */
export function getNaiVibesForGeneration(nai: Pick<NaiSettings, 'vibes' | 'vibePool' | 'vibeGroups' | 'activeVibeGroupId'>): NaiVibe[] {
  if (!nai.activeVibeGroupId) return nai.vibes;
  const group = nai.vibeGroups.find(item => item.id === nai.activeVibeGroupId);
  // A stale explicit group must never silently reactivate the legacy Vibe library.
  return group ? materializeVibeGroup(group, nai.vibePool) : [];
}

/** Apply a group-member Information Extracted override to a request-local payload copy. */
export function applyVibeRefInformationExtracted(data: NaiVibeData, override?: number): NaiVibeData {
  if (typeof override !== 'number' || !Number.isFinite(override)) return data;
  const value = Math.max(0, Math.min(1, override));
  return {
    ...data,
    encodings: Object.fromEntries(Object.entries(data.encodings).map(([model, encoding]) => [
      model, { ...encoding, infoExtracted: value },
    ])),
  };
}
