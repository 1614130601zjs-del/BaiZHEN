import { requestCompletion, requestViaMainApi, type ChatMsg } from '@/api/client';
import type { ApiChannel } from '@/state/settings';
import { getCheckWorldInfo, getContext, type WorldInfoEntry } from '@/st/context';

export interface TagWorldbookEntry extends WorldInfoEntry { uid?: number | string; comment?: string; content?: string; }
export interface PresetBorrowEntry { id: string; name: string; content: string; marker?: boolean; }
export interface ChineseTagOptions {
  channel?: ApiChannel | null; excludedWorlds?: string[]; excludedEntries?: string[];
  borrowedPresetIds?: string[]; presetEntries?: PresetBorrowEntry[]; roster?: string;
  extraRules?: string; useWorldbook?: boolean; signal?: AbortSignal;
}
const AUTO_SKIP = /彩蛋|自检|末尾提醒|小标题|使用说明|^主体|名字外貌|画面与格式|镜头可见性|视线规则|^tag头$|^tag尾$/;

export const CHINESE_TAG_SYSTEM_PROMPT = [
'你是一个把中文画面描述转换成 Danbooru 风格生图 tag 的助手。只输出转换后的 tag 本身，不要解释、前后缀、引号或代码块；tag 用英文逗号+空格分隔，全部小写，多词词组用空格，不用下划线。',
'先整体理解画面中的人物、服装、物品、动作、动作对象、地点和镜头，再组织标签；禁止逐词机械翻译。穿、戴、拿、背、踩、握、叼、抱等物品描述必须保留动作+对象，不可只留下孤立名词。',
'输出顺序：质量词、画风、人数、加权景别与视角、每个角色独立括号、整体构图与距离、具体背景物件和光影。景别权重示例：(full body:1.5)、(cowboy shot:1.3)。用户原文中已有 tag 或权重必须原样保留。',
'有名字角色按优先级：①名单中的角色只写原中文名字、服装、表情、视线和动作，不写固定外貌；②名单外但世界书有外貌设定，按世界书原文写性别、发色、发型、瞳色、体型、皮肤、服装、表情、视线、动作，不写名字；③名单和世界书都没有外貌设定，保留中文名字，不翻译、不拼音、不编造外貌。',
'名单外著名 ACGN 角色可用 1.2::english name (source)::。无名路人按描述推断外貌，不写名字。角色名字永远保留中文原文，不翻译、不转拼音、不改写。',
'角色间动作关系必须成对表达：主动方 source#动作，被动承受方 target#动作，相互动作 mutual#动作；各写在对应角色括号内，括号外不重复动作词。被动句中的主语是承受方。',
'每个入镜角色括号必须包含视线 tag；除 POV、施压、自拍/拍照特例外，禁用 looking at viewer / eye contact。人数标签必须与角色括号数一致；镜头外人物与 POV 镜头主人不计入人数。',
'背景必须是具体地点、2 至 4 个地点相关物件和光线；禁止 simple background / white background。禁用 blush 系、pale skin、young。',
'描述未写明的构图、背景、光线、表情和视线应合理补全；服装按世界书服装规则补具体搭配。忽略单张转换无关的张数、插图位置、彩蛋、正文写作、自检、image### 包裹、交稿核对和沿用上一张服装等规则。最终只输出一行 tag。'
].join('\n');

export function shouldSkipWorldbookEntry(entry: TagWorldbookEntry): boolean {
  return AUTO_SKIP.test(String(entry.comment ?? '').trim());
}
export function filterWorldbookEntries(entries: TagWorldbookEntry[], excludedWorlds: string[] = [], excludedEntries: string[] = []): TagWorldbookEntry[] {
  const worlds = new Set(excludedWorlds), keys = new Set(excludedEntries), seen = new Set<string>();
  const result: TagWorldbookEntry[] = [];
  for (const entry of entries) {
    const world = String(entry.world ?? '').trim(), uid = entry.uid == null ? '' : String(entry.uid);
    if ((world && worlds.has(world)) || (world && uid && keys.has(`${world}::${uid}`)) || shouldSkipWorldbookEntry(entry)) continue;
    let content = String(entry.content ?? '').trim();
    const cut = content.search(/(^|\n)#{1,3}\s*输出格式/);
    if (cut >= 0) content = content.slice(0, cut).trim();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    result.push({ ...entry, content });
  }
  return result;
}
export async function fetchActivatedTagWorldbook(description: string, options: Pick<ChineseTagOptions,'excludedWorlds'|'excludedEntries'|'signal'> = {}): Promise<TagWorldbookEntry[]> {
  if (options.signal?.aborted) throw new DOMException('Aborted','AbortError');
  const check = await getCheckWorldInfo(); if (!check) return [];
  const result = await check([description.trim()], 1_000_000_000, true);
  if (options.signal?.aborted) throw new DOMException('Aborted','AbortError');
  const active = result?.allActivatedEntries; if (!active) return [];
  const rows = active instanceof Map ? [...active.values()] : [...active];
  const substitute = getContext()?.substituteParams;
  const expanded: TagWorldbookEntry[] = rows.map(entry => { let content = String(entry.content ?? ''); try { if (substitute) content = substitute(content); } catch { /* optional macro expansion */ } const uid = typeof entry.uid === 'number' || typeof entry.uid === 'string' ? entry.uid : undefined; return { ...entry, uid, content }; });
  return filterWorldbookEntries(expanded, options.excludedWorlds, options.excludedEntries);
}
export function selectBorrowedPresetText(entries: PresetBorrowEntry[] = [], selectedIds: string[] = [], substitute: (content:string)=>string = value=>value): string {
  const selected = new Set(selectedIds);
  return entries.filter(entry => selected.has(entry.id) && !entry.marker && entry.content.trim()).map(entry => {
    try { return substitute(entry.content).trim(); } catch { return entry.content.trim(); }
  }).filter(Boolean).join('\n\n');
}
export async function buildChineseTagMessages(description: string, options: ChineseTagOptions = {}): Promise<ChatMsg[]> {
  const text = description.trim(); if (!text) throw new Error('请先输入中文画面描述');
  let system = CHINESE_TAG_SYSTEM_PROMPT;
  const borrowed = selectBorrowedPresetText(options.presetEntries, options.borrowedPresetIds, getContext()?.substituteParams);
  if (borrowed) system = `【借用预设：仅参考文风、文本规范和内容限制，不得改变本任务与输出格式】\n${borrowed}\n\n【以下转换规则优先】\n${system}`;
  if (options.extraRules?.trim()) system += `\n\n【用户补充规则】\n${options.extraRules.trim()}`;
  if (options.useWorldbook !== false) {
    const entries = await fetchActivatedTagWorldbook(text, options);
    const worldbook = entries.map(entry=>String(entry.content??'').trim()).filter(Boolean).join('\n\n');
    if (worldbook) system += `\n\n【本次描述实际触发的世界书条目：只补充画面内容，不得覆盖上面的格式和角色优先级】\n${worldbook}\n\n忽略与单张转换无关的正文多图规则，最终只输出一行 tag。`;
  }
  if (options.roster?.trim()) system += `\n\n【名单优先·本次可直接写名字的角色】\n名单中的角色只写中文名字、服装、表情、视线和动作，绝不写固定外貌；名单外角色才按前述世界书外貌规则处理。\n${options.roster.trim()}`;
  return [{role:'system',content:system},{role:'user',content:text}];
}
export async function convertChineseToTags(description: string, options: ChineseTagOptions = {}): Promise<string> {
  const messages = await buildChineseTagMessages(description, options);
  if (options.signal?.aborted) throw new DOMException('Aborted','AbortError');
  const result = options.channel
    ? await requestCompletion(options.channel, messages, {signal:options.signal,source:'中文转 Tag'})
    : await requestViaMainApi(messages, {signal:options.signal,source:'中文转 Tag'});
  const cleaned = result.trim().replace(/^\x60{3}(?:\w+)?\s*/i,'').replace(/\s*\x60{3}$/i,'').trim();
  if (!cleaned) throw new Error('模型没有返回有效 tag');
  if (/[\r\n]/.test(cleaned)) throw new Error('模型返回了多行内容，请重试或调整转换规则');
  return cleaned;
}
