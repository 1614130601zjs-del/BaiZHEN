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
): NaiArtistTargetConfig {
  const binding = profiles.bindings.find(item => item.characterKey === characterKey);
  const local = binding?.[target];
  const global = profiles.global[target];
  return {
    comboId: local?.comboId || global.comboId,
    size: local?.size || global.size,
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
): { nai: NaiSettings; applied: boolean; size: string } {
  const selected = resolveArtistTarget(nai.shizhenArtistProfiles, characterKey, target);
  if (!selected.comboId) return { nai, applied: false, size: '' };
  const combo = nai.shizhenArtistProfiles.combos.find(item => item.id === selected.comboId);
  if (!combo) return { nai, applied: false, size: '' };

  const next: NaiSettings = {
    ...nai,
    activeArtistId: combo.artistId,
    // A selected combo owns the Vibe choice for this request, including an explicit "none".
    vibes: nai.vibes.map(vibe => ({ ...vibe, enabled: !!combo.vibeId && vibe.id === combo.vibeId })),
  };
  const size = /^\d+\s*[x×]\s*\d+$/i.test(selected.size) ? selected.size : '';
  if (size) {
    next.portraitSize = size;
    next.landscapeSize = size;
  }
  return { nai: next, applied: true, size };
}
