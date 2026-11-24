import { getWorldbookModeProfile, type WorldbookModeProfile } from '@/modes/worldbookMode';
import { buildWorldbookModeSystem } from '@/modes/worldbookPrompt';

export interface GenerationModeSnapshot {
  mode: string;
  worldbookProfile: WorldbookModeProfile;
}
export interface GenerationModeStrategy {
  id: string;
  buildSystemContext(snapshot: GenerationModeSnapshot): string;
  allowedWorldNames(snapshot: GenerationModeSnapshot): string[] | undefined;
}
const strategies = new Map<string, GenerationModeStrategy>([
  ['native', { id: 'native', buildSystemContext: () => '', allowedWorldNames: () => undefined }],
  ['worldbook', {
    id: 'worldbook',
    buildSystemContext: snapshot => buildWorldbookModeSystem(snapshot.worldbookProfile),
    allowedWorldNames: snapshot => snapshot.worldbookProfile.enabled
      ? [snapshot.worldbookProfile.coreBook, snapshot.worldbookProfile.worldviewBook].filter(Boolean)
      : undefined,
  }],
]);
export function registerGenerationModeStrategy(strategy: GenerationModeStrategy): () => void {
  if (!strategy.id.trim() || strategy.id === 'native' || strategy.id === 'worldbook') {
    throw new Error('生图模式标识无效或属于内置模式');
  }
  if (strategies.has(strategy.id)) throw new Error(`生图模式「${strategy.id}」已经注册`);
  strategies.set(strategy.id, strategy);
  return () => { if (strategies.get(strategy.id) === strategy) strategies.delete(strategy.id); };
}
export function captureGenerationMode(): GenerationModeSnapshot {
  const worldbookProfile = getWorldbookModeProfile();
  return { mode: worldbookProfile.enabled ? 'worldbook' : 'native', worldbookProfile };
}
export function buildGenerationModeSystem(snapshot: GenerationModeSnapshot): string {
  return (strategies.get(snapshot.mode) ?? strategies.get('native')!).buildSystemContext(snapshot);
}
export function getGenerationModeWorldNames(snapshot: GenerationModeSnapshot): string[] | undefined {
  return (strategies.get(snapshot.mode) ?? strategies.get('native')!).allowedWorldNames(snapshot);
}
