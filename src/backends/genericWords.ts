import type { GenericWordsSettings, GenericWordGender, GenericWordSet } from '@/state/settings';
import type { ImageCharacterPrompt } from '@/autoTag/protocol';

export interface GenericWordInput {
  prompt: string;
  negative?: string;
  characters?: ImageCharacterPrompt[];
  artistTarget?: 'body' | 'statusBar' | 'egg';
}

const normalizeTag = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
function mergeTags(base: string, extra: string, position: 'front' | 'back'): string {
  const left = base.trim().replace(/[,，\s]+$/g, '');
  const right = extra.trim().replace(/[,，\s]+$/g, '');
  if (!right) return left;
  if (!left) return right;
  const seen = new Set(left.split(/[,，]+/).map(normalizeTag).filter(Boolean));
  const additions = right.split(/[,，]+/).map(tag => tag.trim()).filter(tag => tag && !seen.has(normalizeTag(tag)));
  if (!additions.length) return left;
  return position === 'front' ? [...additions, left].join(', ') : [left, ...additions].join(', ');
}
function detectGender(text: string): Exclude<GenericWordGender, 'any'> | '' {
  const value = text.toLowerCase();
  const female = /\b(?:[1-9]\s*girls?|girls?|females?|women|woman|lady)\b/.test(value) || /女性|女生|少女|女孩|女人/.test(value);
  const male = /\b(?:[1-9]\s*boys?|boys?|males?|men|man|guy)\b/.test(value) || /男性|男生|少年|男孩|男人/.test(value);
  return female === male ? '' : female ? 'female' : 'male';
}
function picked(settings: GenericWordsSettings, kind: GenericWordGender): GenericWordSet | null {
  if (!settings.on) return null;
  const id = settings.pick[kind];
  if (id === 'none') return null;
  const selected = id ? settings.sets.find(item => item.id === id && item.gender === kind) : null;
  if (selected) return selected;
  if (kind === 'any' && id == null) return settings.sets.find(item => item.gender === 'any') ?? null;
  return null;
}

/** Apply Shizhen-style shared prompt groups to a generation request without mutating its input. */
export function applyGenericWords<T extends GenericWordInput>(input: T, settings: GenericWordsSettings): T {
  if (!settings.on || input.artistTarget === 'egg') return input;
  const position = settings.position === 'front' ? 'front' : 'back';
  const any = settings.anyOn ? picked(settings, 'any') : null;
  const characters = (input.characters ?? []).map(item => ({ ...item }));
  const detected = new Set<Exclude<GenericWordGender, 'any'>>();
  for (const character of characters) {
    const gender = detectGender(character.tag);
    if (gender) detected.add(gender);
  }
  const promptGender = detectGender(input.prompt);
  if (promptGender) detected.add(promptGender);

  let prompt = input.prompt;
  if (detected.size === 1) {
    const gender = [...detected][0];
    const group = picked(settings, gender);
    if (group) prompt = mergeTags(prompt, group.text, position);
  } else if (detected.size > 1 && characters.length) {
    for (const character of characters) {
      const gender = detectGender(character.tag);
      const group = gender ? picked(settings, gender) : null;
      if (group) character.tag = mergeTags(character.tag, group.text, position);
    }
  }
  if (any) prompt = mergeTags(prompt, any.text, position);

  let negative = String(input.negative ?? '');
  const negatives = new Set<string>();
  if (any) negatives.add(any.negative);
  if (detected.size === 1) negatives.add(picked(settings, [...detected][0])?.negative ?? '');
  else if (detected.size > 1) for (const gender of detected) negatives.add(picked(settings, gender)?.negative ?? '');
  for (const extra of negatives) if (extra.trim()) negative = mergeTags(negative, extra, 'back');
  return { ...input, prompt, negative, characters } as T;
}
