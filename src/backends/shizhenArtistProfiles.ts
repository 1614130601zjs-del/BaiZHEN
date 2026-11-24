import { materializeVibeGroup } from '@/backends/vibePool';
import type {
  NaiArtistCharacterBinding,
  NaiArtistCombo,
  NaiArtistProfileSettings,
  NaiArtistTargetConfig,
  NaiVibe,
  NaiSettings,
} from '@/state/settings';

/** Resolve a Shizhen combo's index-based references exactly once into stable BaiZHEN IDs. */
export function mapShizhenComboReferences(
  raw: unknown,
  artistIds: readonly string[],
  vibeIds: readonly string[],
  makeId: (index: number) => string,
): NaiArtistCombo[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const artistIndex = Number(item.artistIndex ?? -1);
    const vibeIndex = Number(item.vibeIndex ?? -1);
    return [{
      id: makeId(index),
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `组合 ${index + 1}`,
      artistId: Number.isInteger(artistIndex) && artistIndex >= 0 ? artistIds[artistIndex] ?? '' : '',
      vibeId: Number.isInteger(vibeIndex) && vibeIndex >= 0 ? vibeIds[vibeIndex] ?? '' : '',
      updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
    }];
  });
}

/** Shizhen uses positional character indexes; migrate to avatar-first stable keys. */
export function makeCharacterBindingKey(avatar: unknown, name: unknown, legacyIndex?: unknown): string {
  const avatarName = typeof avatar === 'string' ? avatar.trim() : '';
  if (avatarName) return `avatar:${avatarName}`;
  const characterName = typeof name === 'string' ? name.trim() : '';
  if (characterName) return `name:${characterName}`;
  const index = Number(legacyIndex);
  return Number.isInteger(index) && index >= 0 ? `legacy-index:${index}` : '';
}

/** Shizhen's three targets keep independent combo and size overrides. */
export function mapShizhenTarget(
  comboIndex: unknown,
  size: unknown,
  comboIds: readonly string[],
): NaiArtistTargetConfig {
  const index = Number(comboIndex ?? -1);
  return {
    comboId: Number.isInteger(index) && index >= 0 ? comboIds[index] ?? '' : '',
    size: typeof size === 'string' ? size : '',
  };
}

/** Pure resolver: a missing character override falls back to the corresponding global target. */
export function resolveArtistTarget(
  profiles: NaiArtistProfileSettings,
  characterKey: string,
  target: 'body' | 'statusBar' | 'egg',
  characterName = '',
): NaiArtistTargetConfig {
  const binding = profiles.bindings.find(item => item.characterKey === characterKey)
    ?? profiles.bindings.find(item => !!characterName
      && (item.characterKey.startsWith('name:') || item.characterKey.startsWith('legacy-index:'))
      && item.characterName.trim() === characterName.trim());
  const local = binding?.[target];
  const global = profiles.global[target];
  const selected = {
    comboId: local?.comboId || global.comboId,
    size: local?.size || global.size,
  };
  if (target === 'body') return selected;
  // Shizhen semantics: status-bar and egg inherit body independently when their own field is empty.
  const bodyLocal = binding?.body;
  const bodyGlobal = profiles.global.body;
  return {
    comboId: selected.comboId || bodyLocal?.comboId || bodyGlobal.comboId,
    size: selected.size || bodyLocal?.size || bodyGlobal.size,
  };
}

/** Keep a profile structurally valid after combo deletion without touching native artist state. */
export function removeArtistCombo(
  profiles: NaiArtistProfileSettings,
  comboId: string,
): NaiArtistProfileSettings {
  const clear = (target: NaiArtistTargetConfig): NaiArtistTargetConfig =>
    target.comboId === comboId ? { ...target, comboId: '' } : target;
  return {
    ...profiles,
    combos: profiles.combos.filter(combo => combo.id !== comboId),
    global: {
      body: clear(profiles.global.body),
      statusBar: clear(profiles.global.statusBar),
      egg: clear(profiles.global.egg),
    },
    bindings: profiles.bindings.map((binding: NaiArtistCharacterBinding) => ({
      ...binding,
      body: clear(binding.body),
      statusBar: clear(binding.statusBar),
      egg: clear(binding.egg),
    })),
  };
}

/** Build the ID lookup inputs from the current independent libraries. */
export function currentVibeIds(vibes: readonly NaiVibe[]): string[] {
  return vibes.map(vibe => vibe.id);
}


/**
 * Apply one Shizhen-style profile to a request-local NAI snapshot.
 * Never mutates global settings: native artist/Vibe selections remain untouched.
 */
export function applyArtistProfileToNai(
  nai: NaiSettings,
  characterKey: string,
  target: 'body' | 'statusBar' | 'egg' = 'body',
  characterName = '',
  comboIdOverride?: string,
): { nai: NaiSettings; applied: boolean; size: string } {
  const selected = resolveArtistTarget(nai.shizhenArtistProfiles, characterKey, target, characterName);
  const selectedComboId = comboIdOverride ?? selected.comboId;
  const combo = selectedComboId
    ? nai.shizhenArtistProfiles.combos.find(item => item.id === selectedComboId)
    : undefined;
  const size = /^\d+\s*[x×]\s*\d+$/i.test(selected.size) ? selected.size : '';
  if (!combo && !size) return { nai, applied: false, size: '' };

  const next: NaiSettings = { ...nai };
  if (combo) {
    // Artist-only and Vibe-only combos are both valid: an omitted half must not erase
    // the corresponding native selection for this request.
    if (combo.artistId) next.activeArtistId = combo.artistId;
    if (combo.vibeGroup || combo.vibeId) {
      const poolGroups = Array.isArray(nai.vibeGroups) ? nai.vibeGroups : [];
      const poolItems = Array.isArray(nai.vibePool) ? nai.vibePool : [];
      const legacyVibes = Array.isArray(nai.vibes) ? nai.vibes : [];
      const poolGroup = combo.vibeGroup
        ? poolGroups.find(group => group.id === combo.vibeGroup || group.name === combo.vibeGroup)
        : undefined;
      if (poolGroup) {
        next.activeVibeGroupId = poolGroup.id;
      } else if (combo.vibeId && poolItems.some(vibe => vibe.id === combo.vibeId)) {
        const resource = poolItems.find(vibe => vibe.id === combo.vibeId)!;
        next.activeVibeGroupId = '';
        next.vibes = materializeVibeGroup({
          id: `combo:${combo.id}`,
          name: combo.name,
          refs: [{ poolId: resource.id, strength: legacyVibes.find(vibe => vibe.id === resource.id)?.strength ?? 0.6, enabled: true, informationExtracted: legacyVibes.find(vibe => vibe.id === resource.id)?.informationExtracted }],
        }, poolItems);
      } else if (combo.vibeGroup) {
        // Keep an unresolved explicit group selection non-empty: the backend then
        // resolves it to an empty list instead of falling back to unrelated legacy Vibes.
        next.activeVibeGroupId = combo.vibeGroup;
      } else {
        next.activeVibeGroupId = '';
        next.vibes = legacyVibes.map(vibe => ({ ...vibe, enabled: vibe.id === combo.vibeId }));
      }
    }
  }
  return { nai: next, applied: true, size };
}
