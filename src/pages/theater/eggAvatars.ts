export interface EggAvatarSettings {
  eggAvatars?: Record<string, string | { url?: string }>;
  eggAvatarManualNames?: string[];
  eggAvatarHiddenNames?: string[];
}
export interface EggAvatarBlock {
  room?: { narrator?: string };
  messages?: Array<{ speaker?: string }>;
}
export function normalizeEggAvatarUrl(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'url' in value) return String((value as { url?: unknown }).url || '');
  return '';
}
export function collectEggAvatarNames(
  blocks: EggAvatarBlock[],
  settings: EggAvatarSettings,
): string[] {
  const names = new Set<string>();
  for (const block of blocks) {
    const narrator = String(block.room?.narrator || '').trim();
    if (narrator) names.add(narrator);
    for (const message of block.messages || []) {
      const speaker = String(message.speaker || '').trim();
      if (speaker) names.add(speaker);
    }
  }
  for (const name of Object.keys(settings.eggAvatars || {})) if (name.trim()) names.add(name.trim());
  for (const name of settings.eggAvatarManualNames || []) if (String(name).trim()) names.add(String(name).trim());
  const hidden = new Set((settings.eggAvatarHiddenNames || []).map(name => String(name).trim()));
  return [...names].filter(name => !hidden.has(name)).sort((a,b) => a.localeCompare(b, 'zh'));
}
export function addEggAvatarName(settings: EggAvatarSettings, rawName: string): EggAvatarSettings {
  const name = rawName.trim();
  if (!name) return settings;
  const manual = [...(settings.eggAvatarManualNames || [])];
  if (!manual.includes(name)) manual.push(name);
  return { ...settings, eggAvatarManualNames: manual, eggAvatarHiddenNames: (settings.eggAvatarHiddenNames || []).filter(item => item.trim() !== name) };
}
export function setEggAvatar(settings: EggAvatarSettings, name: string, dataUrl: string): EggAvatarSettings {
  const key = name.trim();
  if (!key || !dataUrl.startsWith('data:image/')) throw new Error('头像名称或图片格式无效');
  return { ...settings, eggAvatars: { ...(settings.eggAvatars || {}), [key]: dataUrl } };
}
export function hideEggAvatarName(settings: EggAvatarSettings, rawName: string): EggAvatarSettings {
  const name = rawName.trim();
  if (!name) return settings;
  const avatars = { ...(settings.eggAvatars || {}) };
  delete avatars[name];
  const hidden = [...(settings.eggAvatarHiddenNames || [])];
  if (!hidden.includes(name)) hidden.push(name);
  return { ...settings, eggAvatars: avatars, eggAvatarManualNames: (settings.eggAvatarManualNames || []).filter(item => item.trim() !== name), eggAvatarHiddenNames: hidden };
}
