<script setup lang="ts">
import { ref, watch } from 'vue';
import { fetchCharCard, fetchUserPersona, fetchWorldInfo, buildCharCardSystem, buildPersonaSystem, buildWorldInfoSystem } from '@/autoTag/context';
import { captureGenerationSnapshot, decideSeed, generateImage } from '@/generate';
import { inferRenderProfile } from '@/autoTag/renderProfile';
import { resultToBase64ForUpload, generationId } from '@/floor/storage';
import { deleteUserImage, uploadUserImage } from '@/st/images';
import { getContext } from '@/st/context';
import { makeCharacterBindingKey } from '@/backends/shizhenArtistProfiles';
import { getWorldbookModeProfile } from '@/modes/worldbookMode';
import { parseTheaterOutput, type ParsedTheaterOutput } from '@/theater/format';

interface TheaterRecord extends ParsedTheaterOutput {
  id: string;
  input: string;
  mode: 'scene' | 'plot';
  imagePath: string;
  createdAt: number;
  chatId: string;
}
interface TheaterStore { records: TheaterRecord[] }
const STORE_KEY = 'baibai_image_theater';
const FOLDER = '柏宝绘_小剧场';
const input = ref('');
const mode = ref<'scene' | 'plot'>('scene');
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
watch(() => current.value?.id, () => { promptDraft.value = current.value?.prompt ?? ''; }, { immediate: true });

function historyMessages(): Array<{ role: string; content: string }> {
  const context = getContext();
  if (!context) return [];
  return context.chat.slice(-12).filter(message => message && typeof message.mes === 'string' && message.mes.trim())
    .map(message => ({
      role: message.is_user ? 'user' : 'assistant',
      content: message.mes.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000),
    }));
}
async function buildGenerationMessages(userInput: string): Promise<Array<{ role: string; content: string }>> {
  const context = getContext();
  if (!context) throw new Error('酒馆上下文尚未就绪');
  const floors = context.chat.map((_, index) => index).slice(-12);
  const profile = getWorldbookModeProfile();
  const allowedBooks = profile.enabled ? [profile.coreBook, profile.worldviewBook].filter(Boolean) : undefined;
  const world = await fetchWorldInfo(context.chat, floors, context.name1, context.name2, undefined, undefined, allowedBooks);
  const card = fetchCharCard(context);
  const persona = fetchUserPersona(context);
  const system = [
    '你是小剧场编剧。根据用户给出的画面词或剧情词，结合聊天上下文、角色卡和已激活世界书，写出一段可用于生成单张插画的小剧场。',
    '严格输出纯文本标记，不要 Markdown 代码块。格式：',
    'title###标题###',
    'image###英文 Danbooru 风格正向提示词###',
    'eggroom###聊天室名称|人数|群主|解说员|解说员吐槽###',
    'eggmsg###left 或 right|说话人|对话内容###（可以多条）',
    'eggend###',
    '只输出一张图片和一份聊天室。image 提示词应描述当前场景的视觉内容，不要包含画师串、质量词或负面词。聊天室内容要与剧情及人物关系一致，发言称呼与当前角色/用户称呼一致。不要捏造与世界书冲突的设定。',
    world ? buildWorldInfoSystem(world) : '',
    card ? buildCharCardSystem(card) : '',
    persona ? buildPersonaSystem(persona) : '',
  ].filter(Boolean).join('\\n\\n');
  return [
    { role: 'system', content: system },
    ...historyMessages(),
    { role: 'user', content: (mode.value === 'plot' ? '剧情词：' : '画面词：') + userInput },
  ];
}
async function createRecord(userInput: string, parsed: ParsedTheaterOutput, modeValue: 'scene' | 'plot'): Promise<TheaterRecord> {
  const context = getContext();
  if (!context) throw new Error('酒馆上下文尚未就绪');
  const snapshot = captureGenerationSnapshot();
  if (!snapshot.status.configured) throw new Error(snapshot.status.reason || '生图后端尚未配置');
  const prompt = parsed.prompt.replace(/^\s*[\[【]\s*彩蛋[】\]]\s*/u, '').trim();
  const character = context.characters?.[Number(context.characterId)];
  const output = await generateImage({
    prompt,
    seed: decideSeed(snapshot.backend),
    artistTarget: 'egg',
    characterKey: makeCharacterBindingKey(character?.avatar, character?.name, context.characterId),
    characterName: character?.name || context.name2 || '',
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
    imagePath,
    createdAt: Date.now(),
    chatId: context.getCurrentChatId() || '',
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
    const messages = await buildGenerationMessages(text);
    status.value = '正在生成小剧场文本…';
    const raw = await context.generateRaw({ prompt: messages, responseLength: 4096 });
    rawOutput.value = raw;
    const parsed = parseTheaterOutput(raw);
    if (!parsed.prompt) throw new Error('模型输出中没有找到 image###…### 画面提示词');
    if (!parsed.eggBlocks.length) throw new Error('模型输出中没有找到 eggroom###…eggend### 聊天室内容');
    status.value = '正在通过柏宝绘后端生成图片…';
    const record = await createRecord(text, parsed, mode.value);
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
    const next = await createRecord(current.value.input, parsed, current.value.mode);
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
.mode-row{display:flex;gap:18px;margin-bottom:10px}.composer textarea{width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px;background:var(--SmartThemeBlurTintColor);color:inherit}
.actions{display:flex;justify-content:flex-end;margin-top:10px}.theater-page button{border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:7px 12px;background:var(--SmartThemeBlurTintColor);color:inherit;cursor:pointer}.theater-page button:disabled{opacity:.5;cursor:not-allowed}
.error{color:var(--SmartThemeQuoteColor)}.composer pre{white-space:pre-wrap;max-height:220px;overflow:auto;font-size:11px}
.result{display:grid;grid-template-columns:minmax(180px,38%) 1fr;gap:14px}.artwork img{display:block;width:100%;height:auto;max-height:620px;object-fit:contain;border-radius:8px;background:#111}
.result-body h3{margin:0 0 8px}.prompt-editor{display:flex;flex-direction:column;gap:6px;font-size:12px}.prompt-editor textarea{width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px;background:var(--SmartThemeBlurTintColor);color:inherit}.result-actions{display:flex;gap:8px;margin:10px 0}.room{margin-top:14px;padding:12px;border:1px solid var(--SmartThemeBorderColor);border-radius:10px}.room h4{margin:0 0 4px}.bubble-row{display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin:9px 0}.bubble-row.right{align-items:flex-end}.speaker{font-size:11px;opacity:.7}.bubble{max-width:90%;padding:8px 11px;border-radius:12px;background:var(--SmartThemeQuoteColor);color:var(--SmartThemeBodyColor);white-space:pre-wrap}
.history-list{display:flex;gap:8px;flex-wrap:wrap}.history-item{display:flex;align-items:center;gap:8px;max-width:240px;text-align:left}.history-item img{width:48px;height:48px;object-fit:cover;border-radius:6px}.delete{margin-left:auto}
@media(max-width:640px){.result{grid-template-columns:1fr}}
</style>
