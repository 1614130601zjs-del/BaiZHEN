import type { NaiVibe, NaiVibeGroup, NaiVibePoolItem } from '@/state/settings';
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
    if (!group.refs.some(ref => ref.poolId === vibe.id)) group.refs.push({ poolId: vibe.id, strength: vibe.strength, enabled: vibe.enabled });
  }
  return { pool, groups: [...groups.values()] };
}
export function materializeVibeGroup(group: NaiVibeGroup, pool: readonly NaiVibePoolItem[]): NaiVibe[] {
  const byId = new Map(pool.map(item => [item.id, item]));
  return group.refs.flatMap(ref => {
    const resource = byId.get(ref.poolId);
    return resource ? [{ ...resource, strength: ref.strength, enabled: ref.enabled, group: group.name }] : [];
  });
}
