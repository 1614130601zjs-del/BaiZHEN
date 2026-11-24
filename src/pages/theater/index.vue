<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { fetchCharCard, fetchUserPersona, fetchWorldInfo, buildCharCardSystem, buildPersonaSystem, buildWorldInfoSystem } from '@/autoTag/context';
import { captureGenerationSnapshot, decideSeed, generateImage } from '@/generate';
import { inferRenderProfile } from '@/autoTag/renderProfile';
import { resultToBase64ForUpload, generationId } from '@/floor/storage';
import { deleteUserImage, uploadUserImage } from '@/st/images';
import { getContext } from '@/st/context';
import { makeCharacterBindingKey } from '@/backends/shizhenArtistProfiles';
import { settings } from '@/state/settings';
import { getWorldbookModeProfile } from '@/modes/worldbookMode';
import { parseTheaterOutput, type ParsedTheaterOutput } from '@/theater/format';

interface TheaterRecord extends ParsedTheaterOutput {
  id: string;
  input: string;
  mode: 'scene' | 'plot';
  style: 'egg' | 'comic' | 'comic2' | 'comic4';
  comboId?: string;
  imagePath: string;
  createdAt: number;
  chatId: string;
  /** 生成该张图片时的聊天上下文快照，切换聊天后仍可回看来源。 */
  chatSnapshot?: Array<{ role: string; content: string }>;
  characterName?: string;
  characterKey?: string;
  sourceChatId?: string;
}
interface TheaterStore { records: TheaterRecord[] }
const STORE_KEY = 'baibai_image_theater';
const FOLDER = '柏宝绘_小剧场';
const input = ref('');
const mode = ref<'scene' | 'plot'>('scene');
const style = ref<'egg' | 'comic' | 'comic2' | 'comic4'>('egg');
const comboId = ref('');
const comboOptions = computed(() => settings.nai.shizhenArtistProfiles.combos.map(item => ({ id: item.id, name: item.name || '未命名组合' })));
const busy = ref(false);
const rerolling = ref(false);
const error = ref('');
const status = ref('');
const rawOutput = ref('');
const current = ref<TheaterRecord | null>(null);
const promptDraft = ref('');
const records = ref<TheaterRecord[]>([]);

function store(): TheaterStore {
  const extensionSettings = getContext()?.extensionSettings;
  if (!extensionSettings) return { records: records.value };
  const value = extensionSettings[STORE_KEY] as Partial<TheaterStore> | undefined;
  if (!Array.isArray(value?.records)) extensionSettings[STORE_KEY] = { records: [] } satisfies TheaterStore;
  return extensionSettings[STORE_KEY] as TheaterStore;
}
function persist(): void {
  const context = getContext();
  if (!context?.extensionSettings) throw new Error('酒馆扩展设置不可用，无法保存小剧场记录');
  context.extensionSettings[STORE_KEY] = { records: records.value.slice(0, 200) } satisfies TheaterStore;
  context.saveSettingsDebounced?.();
}
function load(): void {
  const saved = store().records.filter(item => item && typeof item.id === 'string' && typeof item.imagePath === 'string');
  records.value = saved;
  current.value = saved[0] ?? null;
}
load();
watch(() => current.value?.id, () => { promptDraft.value = current.value?.prompt ?? ''; style.value = current.value?.style || 'egg'; comboId.value = current.value?.comboId ?? ''; }, { immediate: true });

function historyMessages(chat = getContext()?.chat ?? []): Array<{ role: string; content: string }> {
  return chat.slice(-12).filter(message => message && typeof message.mes === 'string' && message.mes.trim())
    .map(message => ({
      role: message.is_user ? 'user' : 'assistant',
      content: message.mes.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000),
    }));
}
async function buildGenerationMessages(userInput: string, styleValue: 'egg' | 'comic' | 'comic2' | 'comic4', sourceChat: typeof getContext extends () => infer T ? NonNullable<T>['chat'] : never): Promise<Array<{ role: string; content: string }>> {
  const context = getContext();
  if (!context) throw new Error('酒馆上下文尚未就绪');
  const chat = sourceChat;
  const floors = chat.map((_, index) => index).slice(-12);
  const profile = getWorldbookModeProfile();
  const allowedBooks = profile.enabled ? [profile.coreBook, profile.worldviewBook].filter(Boolean) : undefined;
  const world = await fetchWorldInfo(chat, floors, context.name1, context.name2, undefined, undefined, allowedBooks);
  const card = fetchCharCard(context);
  const persona = fetchUserPersona(context);
  const system = [
    '你是小剧场编剧。根据用户给出的画面词或剧情词，结合聊天上下文、角色卡和已激活世界书，写出小剧场内容。',
    '严格输出纯文本标记，不要 Markdown 代码块。格式：',
    'title###标题###',
    'image###英文 Danbooru 风格正向提示词###',
    'eggroom###聊天室名称|人数|群主|解说员|解说员吐槽###',
    'eggmsg###left 或 right|说话人|对话内容###（可以多条）',
    'eggend###',
    styleValue === 'egg'
      ? '当前风格：彩蛋 Q 版。允许可爱、搞怪、夸张表情与动作；不要写质量词和体型词。'
      : `当前风格：正常比例条漫，${styleValue === 'comic2' ? '2' : styleValue === 'comic4' ? '4' : '1'} 格分镜。不要 Q 版或夸张变形，不要自己写质量词和体型词。${styleValue === 'comic2' || styleValue === 'comic4' ? '画面提示词只输出一条 image###，使用 comic 与 '+(styleValue === 'comic2' ? '2koma' : '4koma')+' 标签；按 Panel 1、Panel 2'+(styleValue === 'comic4' ? '、Panel 3、Panel 4' : '')+' 顺序描述各格。角色外貌只在开头写一次，后续用 character A、character B 等纯英文占位符指代，不要重复角色名或外貌。' : '画面按单幅正常比例插画描述。'}`,
    '只输出一条 image### 画面提示词和一份 eggroom### 聊天室。image 提示词只描述视觉内容，不包含画师串、质量词或负面词。聊天室内容要与剧情及人物关系一致，发言称呼与当前角色/用户称呼一致。不要捏造与世界书冲突的设定。',
    '输出约束：只生成一张图片标记；不得输出第二条 image###。',
    world ? buildWorldInfoSystem(world) : '',
    card ? buildCharCardSystem(card) : '',
    persona ? buildPersonaSystem(persona) : '',
  ].filter(Boolean).join('\n\n');
  return [
    { role: 'system', content: system },
    ...historyMessages(chat),
    { role: 'user', content: (mode.value === 'plot' ? '剧情词：' : '画面词：') + userInput },
  ];
}
async function createRecord(userInput: string, parsed: ParsedTheaterOutput, modeValue: 'scene' | 'plot', styleValue: 'egg' | 'comic' | 'comic2' | 'comic4', comboIdValue = '', sourceSnapshot?: Pick<TheaterRecord, 'chatSnapshot' | 'characterName' | 'characterKey'>): Promise<TheaterRecord> {
  const context = getContext();
  if (!context) throw new Error('酒馆上下文尚未就绪');
  const snapshot = captureGenerationSnapshot();
  if (!snapshot.status.configured) throw new Error(snapshot.status.reason || '生图后端尚未配置');
  const prompt = parsed.prompt.replace(/^\s*[\[【]\s*彩蛋[】\]]\s*/u, '').trim();
  const character = context.characters?.[Number(context.characterId)];
  const characterName = sourceSnapshot?.characterName || character?.name || context.name2 || '';
  const characterKey = sourceSnapshot?.characterKey || makeCharacterBindingKey(character?.avatar, character?.name, context.characterId);
  const output = await generateImage({
    prompt,
    seed: decideSeed(snapshot.backend),
    artistTarget: 'egg',
    ...(comboIdValue ? { artistComboId: comboIdValue } : {}),
    characterKey,
    characterName,
    renderProfile: inferRenderProfile(prompt),
  }, undefined, {}, snapshot);
  const base64 = await resultToBase64ForUpload(output.result);
  const format = /^[a-z0-9]+$/i.test(output.result.format) ? output.result.format.toLowerCase() : 'png';
  const id = generationId();
  const imagePath = await uploadUserImage(FOLDER, `theater_${id}.${format}`, base64, format);
  return {
    ...parsed,
    id,
    input: userInput,
    mode: modeValue,
    style: styleValue,
    comboId: comboIdValue,
    imagePath,
    createdAt: Date.now(),
    chatId: sourceSnapshot?.sourceChatId ?? context.getCurrentChatId() ?? '',
    chatSnapshot: sourceSnapshot?.chatSnapshot ?? historyMessages(),
    characterName,
    characterKey,
  };
}
async function generateTheater(): Promise<void> {
  if (busy.value) return;
  const text = input.value.trim();
  if (!text) { error.value = '请先输入画面词或剧情词'; return; }
  busy.value = true; error.value = ''; status.value = '正在整理角色、世界书和聊天上下文…';
  try {
    const context = getContext();
    if (!context?.generateRaw) throw new Error('当前酒馆版本未提供 generateRaw，无法调用主 API 静默生成');
    const styleValue = style.value;
    // 在发起文本模型请求前固定本次图片的聊天/角色快照，避免生成期间聊天切换造成错配。
    const contextAtStart = context;
    const characterAtStart = contextAtStart?.characters?.[Number(contextAtStart.characterId)];
    const sourceSnapshot = {
      chatSnapshot: historyMessages(contextAtStart?.chat ?? []),
      sourceChatId: contextAtStart?.getCurrentChatId() || '',
      characterName: characterAtStart?.name || contextAtStart?.name2 || '',
      characterKey: makeCharacterBindingKey(characterAtStart?.avatar, characterAtStart?.name, contextAtStart?.characterId),
    };
    const messages = await buildGenerationMessages(text, styleValue, contextAtStart.chat.slice());
    // 保存本次真正提交给文本模型的完整消息（含角色卡/世界书系统上下文），按图片记录独立留档。
    sourceSnapshot.chatSnapshot = messages;
    status.value = '正在生成小剧场文本…';
    const raw = await context.generateRaw({ prompt: messages, responseLength: 4096 });
    rawOutput.value = raw;
    const parsed = parseTheaterOutput(raw);
    if (!parsed.prompt) throw new Error('模型输出中没有找到 image###…### 画面提示词');
    if (!parsed.eggBlocks.length) throw new Error('模型输出中没有找到 eggroom###…eggend### 聊天室内容');
    status.value = '正在通过柏宝绘后端生成图片…';
    const record = await createRecord(text, parsed, mode.value, styleValue, comboId.value, sourceSnapshot);
    const nextRecords = [record, ...records.value];
    const removed = nextRecords.splice(200);
    records.value = nextRecords;
    current.value = record;
    persist();
    await Promise.all(removed.map(item => deleteUserImage(item.imagePath).catch(() => undefined)));
    status.value = parsed.extraImages ? `完成（模型多输出了 ${parsed.extraImages} 张图片标记，本次只生成第一张）` : '小剧场已生成并保存';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
function savePrompt(): void {
  if (!current.value) return;
  const prompt = promptDraft.value.trim();
  if (!prompt) { error.value = '画面提示词不能为空'; return; }
  current.value.prompt = prompt;
  persist();
  status.value = '已保存当前画面提示词';
  error.value = '';
}
async function reroll(): Promise<void> {
  if (!current.value || rerolling.value) return;
  rerolling.value = true; error.value = ''; status.value = '正在重 Roll 图片（不重新调用文本模型）…';
  try {
    const parsed: ParsedTheaterOutput = { ...current.value, prompt: promptDraft.value.trim() };
    if (!parsed.prompt) throw new Error('画面提示词不能为空');
    const next = await createRecord(current.value.input, parsed, current.value.mode, current.value.style || 'egg', current.value.comboId ?? comboId.value, current.value);
    const nextRecords = [next, ...records.value];
    const removed = nextRecords.splice(200);
    records.value = nextRecords;
    current.value = next;
    persist();
    await Promise.all(removed.map(item => deleteUserImage(item.imagePath).catch(() => undefined)));
    status.value = '已生成新的候选图片，旧图片仍保留在历史中';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    rerolling.value = false;
  }
}
function selectRecord(record: TheaterRecord): void { current.value = record; }
async function removeRecord(record: TheaterRecord): Promise<void> {
  records.value = records.value.filter(item => item.id !== record.id);
  if (current.value?.id === record.id) current.value = records.value[0] ?? null;
  persist();
  await deleteUserImage(record.imagePath).catch(() => undefined);
}
</script>

<template>
  <div class="theater-page">
    <header class="page-head">
      <div><h2>小剧场</h2><p>根据当前聊天、角色卡和世界书生成插画与独立聊天室快照。</p></div>
    </header>
    <section class="composer">
      <div class="mode-row">
        <label><input v-model="mode" type="radio" value="scene"> 画面词</label>
        <label><input v-model="mode" type="radio" value="plot"> 剧情词</label>
      </div>
      <div class="style-row">
        <label>画师串组合
          <select v-model="comboId">
            <option value="">跟随彩蛋／角色绑定配置</option>
            <option v-for="item in comboOptions" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
      </div>
      <div class="style-row">
        <label>画面风格
          <select v-model="style">
            <option value="egg">彩蛋 · Q版</option>
            <option value="comic">条漫 · 单幅正常比例</option>
            <option value="comic2">条漫 · 2格分镜</option>
            <option value="comic4">条漫 · 4格分镜</option>
          </select>
        </label>
      </div>
      <textarea v-model="input" rows="3" placeholder="输入一段画面词或剧情词…"></textarea>
      <div class="actions"><button :disabled="busy || !input.trim()" @click="generateTheater">{{ busy ? '生成中…' : '生成小剧场' }}</button></div>
      <p v-if="status" class="status">{{ status }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <details v-if="rawOutput"><summary>查看模型原始输出</summary><pre>{{ rawOutput }}</pre></details>
    </section>
    <section v-if="current" class="result">
      <div class="artwork"><img :src="current.imagePath" alt="小剧场插画"></div>
      <div class="result-body">
        <h3>{{ current.title || '未命名小剧场' }}</h3>
        <label class="prompt-editor">画面提示词<textarea v-model="promptDraft" rows="4"></textarea></label>
        <div class="result-actions"><button @click="savePrompt">保存 Tag</button><button :disabled="rerolling" @click="reroll">{{ rerolling ? '重 Roll 中…' : '重 Roll 图片' }}</button></div>
        <div v-for="(block, index) in current.eggBlocks" :key="index" class="room">
          <h4>{{ block.room.roomName || '聊天室' }}</h4>
          <p class="room-meta">{{ [block.room.count ? block.room.count + ' 人' : '', block.room.owner ? '群主：' + block.room.owner : '', block.room.narrator ? '解说：' + block.room.narrator : '', block.room.narratorDesc].filter(Boolean).join(' · ') }}</p>
          <div v-for="(message, i) in block.messages" :key="i" class="bubble-row" :class="message.side">
            <span class="speaker">{{ message.speaker }}</span><span class="bubble">{{ message.text }}</span>
          </div>
        </div>
      </div>
    </section>
    <section class="history" v-if="records.length">
      <h3>历史快照</h3>
      <div class="history-list">
        <button v-for="record in records" :key="record.id" class="history-item" @click="selectRecord(record)">
          <img :src="record.imagePath" alt=""><span>{{ record.title || record.input }}</span>
        </button>
        <button v-if="current" class="delete" @click="removeRecord(current)">删除当前记录</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.theater-page{display:flex;flex-direction:column;gap:16px;padding:16px;color:var(--SmartThemeBodyColor)}
.page-head h2{margin:0;font-size:18px}.page-head p,.status,.room-meta{opacity:.72;font-size:12px}
.composer,.result,.history{border:1px solid var(--SmartThemeBorderColor);border-radius:12px;padding:14px;background:var(--SmartThemeBlurTintColor)}
.mode-row{display:flex;gap:18px;margin-bottom:10px}.style-row{margin:8px 0 10px}.style-row label{display:flex;align-items:center;gap:8px;font-size:12px}.style-row select{border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:6px;background:var(--SmartThemeBlurTintColor);color:inherit}.composer textarea{width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px;background:var(--SmartThemeBlurTintColor);color:inherit}
.actions{display:flex;justify-content:flex-end;margin-top:10px}.theater-page button{border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:7px 12px;background:var(--SmartThemeBlurTintColor);color:inherit;cursor:pointer}.theater-page button:disabled{opacity:.5;cursor:not-allowed}
.error{color:var(--SmartThemeQuoteColor)}.composer pre{white-space:pre-wrap;max-height:220px;overflow:auto;font-size:11px}
.result{display:grid;grid-template-columns:minmax(180px,38%) 1fr;gap:14px}.artwork img{display:block;width:100%;height:auto;max-height:620px;object-fit:contain;border-radius:8px;background:#111}
.result-body h3{margin:0 0 8px}.prompt-editor{display:flex;flex-direction:column;gap:6px;font-size:12px}.prompt-editor textarea{width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;background:var(--SmartThemeBlurTintColor);color:inherit}.result-actions{display:flex;gap:8px;margin:10px 0}.room{margin-top:14px;padding:12px;border:1px solid var(--SmartThemeBorderColor);border-radius:10px}.room h4{margin:0 0 4px}.bubble-row{display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin:9px 0}.bubble-row.right{align-items:flex-end}.speaker{font-size:11px;opacity:.7}.bubble{max-width:90%;padding:8px 11px;border-radius:12px;background:var(--SmartThemeQuoteColor);color:var(--SmartThemeBodyColor);white-space:pre-wrap}
.history-list{display:flex;gap:8px;flex-wrap:wrap}.history-item{display:flex;align-items:center;gap:8px;max-width:240px;text-align:left}.history-item img{width:48px;height:48px;object-fit:cover;border-radius:6px}.delete{margin-left:auto}
@media(max-width:640px){.result{grid-template-columns:1fr}}
</style>
