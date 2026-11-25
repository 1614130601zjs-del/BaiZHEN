<script setup lang="ts">
import { comicReasoningKey, comicReasoningCapability, type ComicReasoning } from '@/api/comicReasoning';
import { getTagGenChannel } from '@/state/settings';
import { switchNaiModelParams } from '@/backends/naiModelParams';
import { planPrefixGroups } from '@/backends/chatu8Vibe';
import {
  buildNaiv4vibe,
  BUILTIN_NAI_ARTISTS,
  encodeVibeImage,
  isBuiltinNaiArtist,
  isNai5,
  isNaiMedium,
  naiDefaultQualityTags,
  naiDefaultUndesired,
  naiSamplers,
  naiSupportsVarietyBoost,
  naiSupportsVibes,
  NAI_NOISE_SCHEDULES,
  testNaiConnection,
  vibeModelKey,
} from '@/backends/nai';
import {
  clampVibeStrength,
  deleteVibeData,
  loadVibeData,
  saveVibeFiles,
  vibeFingerprint,
  vibeMetaFromData,
} from '@/backends/vibeStore';
import { readShizhenVibeFile } from '@/backends/shizhenVibeImport';
import NaiArtistManager from '@/pages/backend/panels/NaiArtistManager.vue';
import NaiArtistProfiles from '@/pages/backend/panels/NaiArtistProfiles.vue';
import NaiShizhenMigration from '@/pages/backend/panels/NaiShizhenMigration.vue';
import NaiAccountBalance from '@/pages/backend/panels/NaiAccountBalance.vue';
import ComicExtraRules from '@/pages/backend/panels/ComicExtraRules.vue';
import { acquireNaiSlot } from '@/floor/genQueue';
import { makeJpegThumbnail } from '@/st/imageFile';
import { deleteUserImage } from '@/st/images';
import {
  groupKey,
  groupVibes,
  isGroupActive,
  matchVibe,
  GROUP_PREFIX,
  NEW_GROUP,
  UNGROUPED,
  type VibeGroup,
} from '@/backends/vibeGroups';
import Collapsible from '@/components/Collapsible.vue';
import BbiSelect from '@/components/BbiSelect.vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import { getContext } from '@/st/context';
import {
  activeNaiArtist,
  activeNaiEndpoint,
  COMIC_GUTTER_MODES,
  COMIC_PANEL_STYLES,
  resolveComicPanelStyle,
  resolveComicGutterMode,
  effectiveNai,
  isOfficialNaiEndpoint,
  newNaiArtist,
  newNaiEndpoint,
  NAI_MODELS,
  NAI_OFFICIAL_URL,
  ORIENTATION_LOCKS,
  settings,
  type NaiArtistPreset,
  type NaiEndpoint,
  type NaiVibe,
  type NaiVibePoolItem,
} from '@/state/settings';
import { computed, nextTick, ref } from 'vue';
import { materializeVibeGroup } from '@/backends/vibePool';

/** 本渠道是否为当前出图渠道;「使用此渠道」按钮与设置页选择器、页签徽标同属一个开关。 */
const inUse = computed(() => settings.defaultBackend === 'nai');

const testing = ref(false);
const showKey = ref(false);

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '操作已取消';
  return error instanceof Error ? error.message : String(error);
}

async function onTestConnection() {
  if (testing.value) return;
  testing.value = true;
  try {
    // 测当前选中那条接入点(而非渠道级存量 url/key),与出图同一份连接
    const result = await testNaiConnection(effectiveNai());
    toastr.success(result.message, `NAI 连接 · ${endpoint.value.name}`);
  } catch (error) {
    toastr.error(errorMessage(error), `NAI 连接失败 · ${endpoint.value.name}`);
  } finally {
    testing.value = false;
  }
}

/* ============ 接入点库(地址 + 密钥;形制照搬下方画师串行) ============ */

/**
 * 多条接入点解决的是「公益站换着用」:同一套出图参数,换个出口。
 * 故这里只管 url/key,模型/采样器/尺寸一概留在渠道级,切站不用重配。
 */
const endpoint = computed<NaiEndpoint>(() => activeNaiEndpoint());

/** 官方那条只读:名字/地址不给改、不给删,复制出来的副本才随便改。 */
const isOfficialEndpoint = computed(() => isOfficialNaiEndpoint(endpoint.value.id));

const endpointOptions = computed(() =>
  settings.nai.endpoints.map(e => ({ value: e.id, label: e.name || '未命名接入点' })),
);

/** 下拉取「实际生效的那条」而非存的 id:悬空时 activeNaiEndpoint 回落首条,下拉要跟着显示。 */
const activeEndpointId = computed<string>({
  get: () => endpoint.value.id,
  set: id => {
    settings.nai.activeEndpointId = id;
  },
});

/** 改名低频:平时只显示下拉,点「改名」才把选择器原地换成输入框(同画师串行)。 */
const renamingEndpoint = ref(false);
const endpointNameDraft = ref('');
const endpointNameInput = ref<HTMLInputElement | null>(null);
const endpointDeleteOpen = ref(false);

function startRenameEndpoint() {
  if (isOfficialEndpoint.value) return; // 官方条只读(按钮已禁用,双保险)
  endpointNameDraft.value = endpoint.value.name;
  renamingEndpoint.value = true;
  nextTick(() => endpointNameInput.value?.focus());
}

/** Enter / 失焦都算确认;Esc 直接置 false 不经过这里,即为取消。 */
function commitRenameEndpoint() {
  if (renamingEndpoint.value && !isOfficialEndpoint.value) {
    endpoint.value.name = endpointNameDraft.value.trim() || endpoint.value.name;
  }
  renamingEndpoint.value = false;
}

function addEndpoint() {
  const preset = newNaiEndpoint(`接入点 ${settings.nai.endpoints.length + 1}`);
  settings.nai.endpoints.push(preset);
  settings.nai.activeEndpointId = preset.id;
}

function duplicateEndpoint() {
  // 官方条也走这里:复制出来的是普通条目,地址可改 —— 这是「照着官方改个镜像」的捷径
  const src = endpoint.value;
  const preset: NaiEndpoint = { ...newNaiEndpoint(), name: `${src.name} 副本`, url: src.url, key: src.key };
  settings.nai.endpoints.push(preset);
  settings.nai.activeEndpointId = preset.id;
}

function confirmRemoveEndpoint() {
  endpointDeleteOpen.value = false;
  if (isOfficialEndpoint.value) return; // 官方条不可删:endpoints 恒非空靠它保底
  const list = settings.nai.endpoints;
  const index = list.findIndex(e => e.id === endpoint.value.id);
  if (index < 0) return;
  list.splice(index, 1);
  // 接位到原位置那一条(已是最后一条则退一格)。**不**像画师串那样回落空串:
  // 地址是必需品,空了就出不了图 —— 与工作流库同口径。
  settings.nai.activeEndpointId = list[Math.min(index, list.length - 1)].id;
}

/* ============ 画师串库(形制照搬 ComfyUI 工作流库) ============ */

/**
 * 当前选中的画师串;null = 不使用(库为空、用户主动选了「不使用」、或 id 悬空)。
 * settings 是 reactive,直接把它的字段绑 v-model 即可就地编辑。
 */
const artist = computed<NaiArtistPreset | null>(() => activeNaiArtist());

/** 当前是否 V5 模型:控制画师串编辑区的 V5 差异提醒。 */
const isV5Model = computed(() => isNai5(settings.nai.model));
const showComicSettings = computed(() => isV5Model.value && settings.nai.comicMode);
const varietyBoostSupported = computed(() => naiSupportsVarietyBoost(settings.nai.model));

/** 「不使用」的下拉值。preset id 恒为 art_* / bi_* 形状,空串不会与任何一条相撞,无需装箱。 */
const NO_ARTIST = '';

const artistOptions = computed(() => [
  { value: NO_ARTIST, label: '不使用' },
  // 内置配方排用户库前面:新用户默认选中的是内置条,放在「不使用」旁边最顺;
  // 名称后括注内置,与用户自建的同名条目区分开
  ...BUILTIN_NAI_ARTISTS.map(a => ({ value: a.id, label: `${a.name}(内置)` })),
  ...settings.nai.artistPresets.map(a => ({ value: a.id, label: a.name || '未命名画师串' })),
]);

/**
 * 下拉的值取「实际生效的那一条」而非存的 id:存的 id 悬空时 activeNaiArtist 返回 null,
 * 下拉也该跟着显示「不使用」,不能显示空白。
 */
const activeArtistId = computed<string>({
  get: () => artist.value?.id ?? NO_ARTIST,
  set: id => {
    settings.nai.activeArtistId = id;
  },
});

/** 改名/复制/删除都只对「真的选中了一条」有意义;选「不使用」时一律禁用。 */
const hasArtist = computed(() => artist.value !== null);

/** 当前选中的是内置配方:只读(改名/删除/内容编辑禁用),「复制」是自定义的唯一入口。 */
const isBuiltinArtist = computed(() =>
  artist.value ? isBuiltinNaiArtist(artist.value.id) : false,
);

/** 改名是低频操作:平时只显示下拉,点「改名」才把选择器原地换成输入框。 */
const renamingArtist = ref(false);
const artistNameDraft = ref('');
const artistNameInput = ref<HTMLInputElement | null>(null);
const artistDeleteOpen = ref(false);
/** 管理器弹窗:搜索/预览图/勾选批量删除都在那边,下拉这里只留高频切换。 */
const artistManagerOpen = ref(false);

function startRenameArtist() {
  if (!artist.value || isBuiltinArtist.value) return; // 内置只读(按钮已禁用,双保险)
  artistNameDraft.value = artist.value.name;
  renamingArtist.value = true;
  nextTick(() => artistNameInput.value?.focus());
}

/** Enter / 失焦都算确认;Esc 直接置 renamingArtist=false 不经过这里,即为取消。 */
function commitRenameArtist() {
  if (renamingArtist.value && artist.value) artist.value.name = artistNameDraft.value.trim();
  renamingArtist.value = false;
}

function addArtist() {
  const preset = newNaiArtist(`画师串 ${settings.nai.artistPresets.length + 1}`);
  settings.nai.artistPresets.push(preset);
  settings.nai.activeArtistId = preset.id;
}

function duplicateArtist() {
  const src = artist.value;
  if (!src) return;
  // 只换 id 与名字;id 生成仍由 settings 统一口径。
  // 内置配方也走这里:复制出来的副本是普通用户条目,随便改——这是内置条唯一的自定义路径。
  // 显式逐字段拷贝,不带 previewPath:预览文件随原条目删除,共指一个路径会让副本日后破图。
  const preset: NaiArtistPreset = {
    id: newNaiArtist().id,
    name: `${src.name} 副本`,
    prompt: src.prompt,
    quality: src.quality,
    negative: src.negative,
  };
  settings.nai.artistPresets.push(preset);
  settings.nai.activeArtistId = preset.id;
}

async function confirmRemoveArtist() {
  artistDeleteOpen.value = false;
  const list = settings.nai.artistPresets;
  const index = list.findIndex(a => a.id === artist.value?.id);
  if (index < 0) return;
  // 预览图文件 best-effort 连带清理(与管理器删除同口径:文件删不掉不阻塞删条目)
  const previewPath = list[index].previewPath;
  if (previewPath) {
    try {
      await deleteUserImage(previewPath);
    } catch (error) {
      toastr.warning(`条目已删除,但预览图文件清理失败：${errorMessage(error)}`, '画师串');
    }
  }
  list.splice(index, 1);
  // 接位到原位置那一条(已是最后一条则退一格);删空了就回「不使用」——
  // `?? ''` 正是画师串库与工作流库的分水岭(那边恒非空、回落 [0]),不能省。
  settings.nai.activeArtistId = list[Math.min(index, list.length - 1)]?.id ?? '';
}

/* ============ 提示词:正/负面词分两级——画师串绑定值 → 渠道覆盖值 → 内置默认 ============ */

/**
 * 一条正/负面词的编辑目标;渠道级与画师串绑定级共用同一个弹窗。
 *
 * fallback = 留空时跟随的下一级取值(渠道级 → 模型官方词;绑定级 → 渠道值 → 官方词)。
 * 打开弹窗预填它——框里空着就是把「看不到实际生效了什么」的老问题原地搬家;
 * 保存时与回落一致就存空串(与设置页 saveTagPrompt 同口径:不把下一级的值冗余存进来,
 * 保留「跟随」语义,下一级变了能跟着变)。
 *
 * fallback 必须是函数而非常量:它随 settings.nai.model / 渠道覆盖值变,要在读取时才求值。
 */
interface NaiPromptTarget {
  key: 'quality' | 'negative';
  label: string;
  hint: string;
  /** 内置配方的绑定位只读:弹窗纯查看,不给保存(写进模块常量就糟了)。 */
  readonly?: boolean;
  fallback: () => string;
  read: () => string;
  write: (v: string) => void;
}

/** 渠道级两条:画师串未绑定对应字段时生效,再留空则按模型取官方词。 */
const CHANNEL_PROMPT_TARGETS: NaiPromptTarget[] = [
  {
    key: 'quality',
    label: '正面质量词',
    hint: '拼在画面 tag 之后(整体顺序:画师串 → 画面 tag → 质量词)。画师串里设置了质量词时,会用画师串那份,这里的不生效。',
    fallback: () => naiDefaultQualityTags(settings.nai.model),
    read: () => settings.nai.qualityTags,
    write: v => (settings.nai.qualityTags = v),
  },
  {
    key: 'negative',
    label: '负面提示词',
    hint: '留空 = 按模型取官方负面词;要额外排除什么,直接往这一份里接。画师串里设置了负面词时,会用画师串那份,这里的不生效。',
    fallback: () => naiDefaultUndesired(settings.nai.model),
    read: () => settings.nai.undesiredContent,
    write: v => (settings.nai.undesiredContent = v),
  },
];

/**
 * 当前画师串的两个绑定位;read/write 直接落在选中条目上(settings 是 reactive,就地编辑)。
 * 只在真的选中了一条时存在(选「不使用」时没有绑定对象,列表整个不渲染)。
 */
const artistBoundTargets = computed<NaiPromptTarget[]>(() => {
  const a = artist.value;
  if (!a) return [];
  const readonly = isBuiltinArtist.value;
  return [
    {
      key: 'quality',
      label: '正面质量词',
      readonly,
      hint: readonly
        ? '内置画师串的绑定位随插件版本更新,不可改;复制为我的画师串后可自定义。留空 = 用渠道级设置(渠道级也留空,则按模型取官方词)。'
        : '这份质量词随当前画师串一起切换。留空 = 用渠道级设置(渠道级也留空,则按模型取官方词)。',
      fallback: () => settings.nai.qualityTags.trim() || naiDefaultQualityTags(settings.nai.model),
      read: () => a.quality,
      write: v => (a.quality = v),
    },
    {
      key: 'negative',
      label: '负面提示词',
      readonly,
      hint: readonly
        ? '内置画师串的绑定位随插件版本更新,不可改;复制为我的画师串后可自定义。留空 = 用渠道级设置(渠道级也留空,则按模型取官方负面词)。'
        : '这份负面词随当前画师串一起切换。留空 = 用渠道级设置(渠道级也留空,则按模型取官方负面词)。',
      fallback: () =>
        settings.nai.undesiredContent.trim() || naiDefaultUndesired(settings.nai.model),
      read: () => a.negative,
      write: v => (a.negative = v),
    },
  ];
});

/** 该条是否已有自定义值(非空即视为覆盖下一级)。 */
function isTargetCustom(target: NaiPromptTarget): boolean {
  return target.read().trim().length > 0;
}

/** 当前画师串是否绑定了该字段——绑定时渠道值被覆盖,渠道列表的徽标要说出这件事。 */
function isShadowedByArtist(key: NaiPromptTarget['key']): boolean {
  const a = artist.value;
  if (!a) return false;
  return key === 'quality' ? !!a.quality.trim() : !!a.negative.trim();
}

// 正在编辑的那条;draft 是草稿,点「完成」才写回 settings(取消则丢弃)。
const editingNaiPrompt = ref<NaiPromptTarget | null>(null);
const naiPromptDraft = ref('');

function openNaiPrompt(target: NaiPromptTarget) {
  editingNaiPrompt.value = target;
  // 已自定义→载入用户内容;未自定义→预填下一级回落值,方便直接在其上改
  naiPromptDraft.value = target.read().trim() || target.fallback();
}
function closeNaiPrompt() {
  editingNaiPrompt.value = null;
  naiPromptDraft.value = '';
}
function saveNaiPrompt() {
  const target = editingNaiPrompt.value;
  if (!target || target.readonly) return; // 内置配方的绑定位只读(按钮已隐藏,双保险)
  const v = naiPromptDraft.value.trim();
  target.write(v === target.fallback().trim() ? '' : naiPromptDraft.value);
  closeNaiPrompt();
}
/** 「恢复默认」:把草稿重置回落值(保存后即变回「跟随下一级」) */
function resetNaiPromptDraft() {
  const target = editingNaiPrompt.value;
  if (target) naiPromptDraft.value = target.fallback();
}

/* ============ Vibe 库 ============ */

const vibeEncoding = ref(false);
const vibeFileInput = ref<HTMLInputElement | null>(null);
const vibeImportInput = ref<HTMLInputElement | null>(null);

let vibeSeq = 0;

/** 当前模型的 vibe 编码 key;vibe 缺此 key 时生成会被跳过,列表里给「补编码」入口。 */
const currentVibeKey = computed(() => vibeModelKey(settings.nai.model));
const vibesSupported = computed(() => naiSupportsVibes(settings.nai.model));
const samplerOptions = computed(() => naiSamplers(settings.nai.model));

/** 漫画页模式:分镜风格与留白方案下拉选项(来自设置常量,与规范注入同源)。 */
const comicReasoningCaps = computed(() => comicReasoningCapability(getTagGenChannel()));
const comicReasoningOptions = computed(() => [
  {value:'follow',label:'跟随渠道（默认）'},
  ...(comicReasoningCaps.value.low ? [{value:'low',label:'低推理'}] : []),
  ...(comicReasoningCaps.value.off ? [{value:'off',label:'关闭推理'}] : []),
]);
const comicReasoning = computed({get:() => {
  const key=comicReasoningKey(getTagGenChannel(),settings.nai.comicAnalysisMode==='simple'?'simple':'standard'); const value=settings.nai.comicReasoningByModel?.[key] ?? 'follow';
  return comicReasoningOptions.value.some(o=>o.value===value)?value:'follow';
},set:(value:string) => {
  const key=comicReasoningKey(getTagGenChannel(),settings.nai.comicAnalysisMode==='simple'?'simple':'standard');if(key) settings.nai.comicReasoningByModel={...settings.nai.comicReasoningByModel,[key]:value as ComicReasoning};
}});
const comicStyleOptions = COMIC_PANEL_STYLES.map(s => ({ value: s.id, label: s.label }));
const comicGutterOptions = COMIC_GUTTER_MODES.map(g => ({ value: g.id, label: g.label }));
const comicAnalysisOptions = [{ value: 'standard', label: '标准模式' }, { value: 'simple', label: '简单模式' }, { value: 'fast', label: '极速模式' }];
const comicAnalysisMode = computed({
  get: () => settings.nai.comicAnalysisMode ?? 'standard',
  set: (value: string) => { settings.nai.comicAnalysisMode = value === 'fast' ? 'fast' : value === 'simple' ? 'simple' : 'standard'; },
});
const comicStyle = computed({ get: () => settings.nai.comicPanelStyle ?? 'eromanga', set: (value: string) => { settings.nai.comicPanelStyle = value; } });
const comicGutter = computed({ get: () => settings.nai.comicGutter ?? 'bleed', set: (value: string) => { settings.nai.comicGutter = value; } });
const selectedComicStyle = computed(() => resolveComicPanelStyle(comicStyle.value));
const selectedComicGutter = computed(() => resolveComicGutterMode(comicGutter.value));

/** BbiSelect 的 modelValue 是 string,而 nai.model 是字面量联合;这层 get/set 只为搭桥。
 *  写入前对一遍 NAI_MODELS:下拉本就只发合法值,但少了这句类型断言就是空口无凭。 */
const modelSel = computed<string>({
  get: () => settings.nai.model,
  set: v => {
    const hit = NAI_MODELS.find(m => m.value === v);
    if (hit && hit.value !== settings.nai.model) Object.assign(settings.nai, switchNaiModelParams(settings.nai, hit.value));
  },
});

/** 生成 vibe 列表缩略图(最长边 96px 的 jpeg dataURL);失败回空串,由入库方按「无缩略图」处理。 */
async function makeThumbnail(dataUrl: string): Promise<string> {
  try {
    return await makeJpegThumbnail(dataUrl, 96);
  } catch {
    return '';
  }
}

/**
 * 取闸门槽位跑一次 vibe 编码。
 *
 * 编码是一次真实的 NAI 请求,所以与楼层卡片共用同一个闸门(floor/genQueue.ts):
 * 否则「一边出图一边编码」在账号上就是两条并发,且完全绕过 429 冷却。
 * 代价是出图在跑时点编码会先等出图完 —— 这是对的,按钮那边有 vibeEncoding 转圈提示。
 */
async function encodeVibeGated(imageBase64: string): Promise<string> {
  const release = await acquireNaiSlot();
  try {
    return await encodeVibeImage(effectiveNai(), imageBase64, settings.nai.model);
  } finally {
    release();
  }
}

/** 上传参考图 → 调 /ai/encode-vibe 编码(按当前模型)→ 入库。 */
async function onVibeFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || vibeEncoding.value) return;
  vibeEncoding.value = true;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
    const imageBase64 = dataUrl.split(',')[1] ?? '';
    const encoding = await encodeVibeGated(imageBase64);
    const thumbnail = await makeThumbnail(dataUrl);
    const id = `vibe_${Date.now()}_${++vibeSeq}`;
    const data = {
      image: imageBase64,
      thumbnail,
      encodings: { [currentVibeKey.value]: { encoding, infoExtracted: 1 } },
    };
    const paths = await saveVibeFiles(data, null, id);
    settings.nai.vibes.push(
      vibeMetaFromData(
        id,
        file.name.replace(/\.[^.]+$/, '') || `Vibe ${settings.nai.vibes.length + 1}`,
        paths.dataPath,
        paths.thumbnailPath,
        data,
        0.6,
        true,
      ),
    );
    registerVibePoolResource(settings.nai.vibes[settings.nai.vibes.length - 1]);
    toastr.success(`已按 ${settings.nai.model} 编码并加入 Vibe 库`, 'Vibe');
  } catch (error) {
    toastr.error(errorMessage(error), 'Vibe 编码失败');
  } finally {
    vibeEncoding.value = false;
  }
}

/**  vibe 缺当前模型编码时单独补(切换模型后常见)。 */
async function reencodeVibe(vibe: NaiVibe) {
  if (!vibe.hasImage || vibeEncoding.value) return;
  vibeEncoding.value = true;
  try {
    const data = await loadVibeData(vibe);
    if (!data.image) throw new Error('该 Vibe 没有参考原图');
    const encoding = await encodeVibeGated(data.image);
    data.encodings[currentVibeKey.value] = { encoding, infoExtracted: 1 };
    const previousFiles = { dataPath: vibe.dataPath, thumbnailPath: vibe.thumbnailPath };
    const paths = await saveVibeFiles(data, vibe, vibe.id);
    // Commit the new metadata and queue the old paths together. The queue is drained
    // only after a later settings reload, outside the debounced persistence window.
    vibe.dataPath = paths.dataPath;
    vibe.thumbnailPath = paths.thumbnailPath;
    vibe.modelKeys = Object.keys(data.encodings);
    vibe.fingerprint = vibeFingerprint(data.encodings);
    syncPoolResource(vibe);
    if (previousFiles.dataPath || previousFiles.thumbnailPath) {
      settings.nai.vibeCleanupQueue.push(previousFiles);
    }
    toastr.success(`「${vibe.name}」已补 ${settings.nai.model} 编码`, 'Vibe');
  } catch (error) {
    toastr.error(errorMessage(error), 'Vibe 编码失败');
  } finally {
    vibeEncoding.value = false;
  }
}

/* ============ 独立 Vibe 池与多组引用 ============ */

/** 池选择只编辑资源引用，不改变资源本身，也不会移动旧版 Vibe。 */
const poolSelectionMode = ref(false);
const selectedPoolIds = ref<Set<string>>(new Set());
const poolGroupCount = computed(() => settings.nai.vibeGroups.length);
const poolSelectionCount = computed(() => selectedPoolIds.value.size);
const poolResourceById = computed(() => new Map(settings.nai.vibePool.map(item => [item.id, item])));

function registerVibePoolResource(vibe: NaiVibe) {
  if (!settings.nai.vibePool.some(item => item.id === vibe.id)) {
    const { strength: _strength, enabled: _enabled, group: _group, ...resource } = vibe;
    settings.nai.vibePool.push(resource as NaiVibePoolItem);
  }
  const groupName = vibe.group.trim();
  if (groupName) {
    let group = settings.nai.vibeGroups.find(item => item.name === groupName);
    if (!group) {
      group = { id: `vibe-group-${Date.now()}-${settings.nai.vibeGroups.length}`, name: groupName, refs: [] };
      settings.nai.vibeGroups.push(group);
    }
    if (!group.refs.some(ref => ref.poolId === vibe.id)) {
      group.refs.push({ poolId: vibe.id, strength: vibe.strength, enabled: vibe.enabled, ...(vibe.informationExtracted !== undefined ? { informationExtracted: vibe.informationExtracted } : {}) });
    }
  }
}

function syncPoolResource(vibe: NaiVibe) {
  const existing = settings.nai.vibePool.find(item => item.id === vibe.id);
  if (!existing) {
    registerVibePoolResource(vibe);
    return;
  }
  Object.assign(existing, {
    name: vibe.name,
    dataPath: vibe.dataPath,
    thumbnailPath: vibe.thumbnailPath,
    modelKeys: [...vibe.modelKeys],
    hasImage: vibe.hasImage,
    fingerprint: vibe.fingerprint,
  });
}

function togglePoolSelection(id: string) {
  const next = new Set(selectedPoolIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedPoolIds.value = next;
}

function createPoolGroupFromSelection() {
  const ids = selectedPoolIds.value;
  if (!ids.size) return;
  const name = window.prompt('Vibe 组名称（输入已有组名可追加资源）')?.trim();
  if (!name) return;
  let group = settings.nai.vibeGroups.find(item => item.name === name);
  if (!group) {
    group = { id: `vibe-group-${Date.now()}-${settings.nai.vibeGroups.length}`, name, refs: [] };
    settings.nai.vibeGroups.push(group);
  }
  let added = 0;
  for (const id of ids) {
    if (group.refs.some(ref => ref.poolId === id)) continue;
    const legacy = settings.nai.vibes.find(item => item.id === id);
    const resource = poolResourceById.value.get(id);
    if (!resource) continue;
    group.refs.push({
      poolId: id,
      strength: legacy?.strength ?? 0.6,
      enabled: true,
      ...(legacy?.informationExtracted !== undefined ? { informationExtracted: legacy.informationExtracted } : {}),
    });
    added++;
  }
  settings.nai.activeVibeGroupId = group.id;
  selectedPoolIds.value = new Set();
  poolSelectionMode.value = false;
  toastr.success(`已向「${name}」添加 ${added} 个资源；同一资源可继续加入其他组`, 'Vibe 池');
}

async function removePoolResource(poolId: string) {
  const resource = settings.nai.vibePool.find(item => item.id === poolId);
  if (!resource) return;
  const refCount = settings.nai.vibeGroups.reduce(
    (count, group) => count + group.refs.filter(ref => ref.poolId === poolId).length,
    0,
  );
  const confirmed = window.confirm(
    `确定从资源池永久删除「${resource.name}」吗？这会同时移除它在 ${refCount} 个分组中的引用，并删除对应编码文件。`,
  );
  if (!confirmed) return;
  settings.nai.vibeGroups = settings.nai.vibeGroups.map(group => ({
    ...group,
    refs: group.refs.filter(ref => ref.poolId !== poolId),
  }));
  settings.nai.vibes = settings.nai.vibes.filter(vibe => vibe.id !== poolId);
  settings.nai.vibePool = settings.nai.vibePool.filter(item => item.id !== poolId);
  // Keep combo references dangling on purpose: the resolver treats them as an explicit
  // empty selection instead of silently inheriting the currently active global Vibe group.
  selectedPoolIds.value = new Set([...selectedPoolIds.value].filter(id => id !== poolId));
  settings.nai.vibeCleanupQueue.push({
    dataPath: resource.dataPath,
    thumbnailPath: resource.thumbnailPath,
  });
  toastr.success(`已移除「${resource.name}」及其全部分组引用；文件将在设置安全落盘后清理。`, 'Vibe 池');
}
function renamePoolGroup(groupId: string) {
  const group = settings.nai.vibeGroups.find(item => item.id === groupId);
  if (!group) return;
  const oldName = group.name;
  const name = window.prompt('重命名 Vibe 组', oldName)?.trim();
  if (!name || name === oldName) return;
  if (settings.nai.vibeGroups.some(item => item.id !== groupId && item.name === name)) {
    toastr.warning('已有同名分组，请使用其他名称。', 'Vibe 池');
    return;
  }
  group.name = name;
  for (const combo of settings.nai.shizhenArtistProfiles.combos) {
    if (combo.vibeGroup === oldName || combo.vibeGroup === groupId) combo.vibeGroup = name;
  }
  for (const vibe of settings.nai.vibes) {
    if (vibe.group.trim() === oldName) vibe.group = name;
  }
}

function removePoolGroup(groupId: string) {
  const index = settings.nai.vibeGroups.findIndex(group => group.id === groupId);
  if (index < 0) return;
  const removed = settings.nai.vibeGroups[index];
  settings.nai.vibeGroups.splice(index, 1);
  // Legacy single-group labels must not recreate a deleted pool group during normalization.
  for (const vibe of settings.nai.vibes) {
    if (vibe.group.trim() === removed.name) vibe.group = '';
  }
  // Keep the active ID stale as an explicit empty selection. Clearing it would
  // make the backend fall back to the legacy flat library after the next reload.
}

function poolGroupVibes(groupId: string): NaiVibe[] {
  const group = settings.nai.vibeGroups.find(item => item.id === groupId);
  return group ? materializeVibeGroup(group, settings.nai.vibePool) : [];
}

function updatePoolRefStrength(groupId: string, poolId: string, raw: string) {
  const ref = settings.nai.vibeGroups.find(group => group.id === groupId)?.refs.find(item => item.poolId === poolId);
  if (ref) ref.strength = clampVibeStrength(raw);
}

function updatePoolRefInfo(groupId: string, poolId: string, raw: string) {
  const ref = settings.nai.vibeGroups.find(group => group.id === groupId)?.refs.find(item => item.poolId === poolId);
  if (!ref) return;
  if (!raw.trim()) delete ref.informationExtracted;
  else ref.informationExtracted = Math.max(0, Math.min(1, Number.parseFloat(raw) || 0));
}

function updatePoolRefEnabled(groupId: string, poolId: string, enabled: boolean) {
  const ref = settings.nai.vibeGroups.find(group => group.id === groupId)?.refs.find(item => item.poolId === poolId);
  if (ref) ref.enabled = enabled;
}

/* ============ Vibe 分组 ============ */

/** 归拢/搜索/生效判定的纯逻辑在 backends/vibeGroups.ts,此处只做交互与落盘。 */
const vibeSearch = ref('');
/** 从现有 Vibe 库中批量挑选资源组成分组；选择状态仅用于编辑，不参与生图。 */
const vibeGroupSelectionMode = ref(false);
const selectedVibeIds = ref<Set<string>>(new Set());
const selectedVibeCount = computed(() => selectedVibeIds.value.size);
/** 收起的组 key 集合(默认全展开;只存「收起」的,新建组自然是展开的)。 */
const collapsedGroups = ref<Set<string>>(new Set());

const vibeGroups = computed(() => groupVibes(settings.nai.vibes, vibeSearch.value));

/** 搜索命中总数:用于「没有匹配」空态,不必再算一遍列表。 */
const matchedCount = computed(() =>
  settings.nai.vibes.reduce((n, v) => n + (matchVibe(v, vibeSearch.value) ? 1 : 0), 0),
);

/** 库里已有的组名(去重,给「移到分组」下拉用;基于全库而非搜索结果)。 */
const groupNames = computed(() => {
  const names = new Set<string>();
  for (const vibe of settings.nai.vibes) {
    const name = vibe.group.trim();
    if (name) names.add(name);
  }
  return [...names];
});

/** 单条 vibe 的「所属分组」下拉项:未分组 + 已有组 + 新建(组名装箱,避免与哨兵撞名)。 */
const groupOptions = computed(() => [
  { value: UNGROUPED, label: '未分组' },
  ...groupNames.value.map(name => ({ value: `${GROUP_PREFIX}${name}`, label: name })),
  { value: NEW_GROUP, label: '＋ 新建分组…' },
]);

/** 选「新建分组」时就地问一个名字;取消或空名则维持原值(下拉是受控的,得回写)。 */
function onGroupPick(vibe: NaiVibe, value: string) {
  if (value === UNGROUPED) {
    vibe.group = '';
    return;
  }
  if (value.startsWith(GROUP_PREFIX)) {
    vibe.group = value.slice(GROUP_PREFIX.length);
    return;
  }
  const name = window.prompt('新分组名称')?.trim();
  if (name) vibe.group = name;
}

function toggleVibeSelection(vibe: NaiVibe) {
  const next = new Set(selectedVibeIds.value);
  if (next.has(vibe.id)) next.delete(vibe.id);
  else next.add(vibe.id);
  selectedVibeIds.value = next;
}

function selectVisibleVibes() {
  const next = new Set(selectedVibeIds.value);
  for (const group of vibeGroups.value) {
    for (const vibe of group.items) next.add(vibe.id);
  }
  selectedVibeIds.value = next;
}

function clearVibeSelection() {
  selectedVibeIds.value = new Set();
}

function finishVibeGroupSelection() {
  const ids = selectedVibeIds.value;
  if (!ids.size) {
    toastr.info('请先选择要加入分组的 Vibe', 'Vibe');
    return;
  }
  for (const vibe of settings.nai.vibes) {
    if (ids.has(vibe.id)) registerVibePoolResource(vibe);
  }
  selectedPoolIds.value = new Set(ids);
  selectedVibeIds.value = new Set();
  vibeGroupSelectionMode.value = false;
  createPoolGroupFromSelection();
}

function cancelVibeGroupSelection() {
  vibeGroupSelectionMode.value = false;
  selectedVibeIds.value = new Set();
}

function isGroupCollapsed(key: string): boolean {
  return collapsedGroups.value.has(key);
}

function toggleGroup(key: string) {
  const next = new Set(collapsedGroups.value);
  if (!next.delete(key)) next.add(key);
  collapsedGroups.value = next;
}

function groupActive(group: VibeGroup): boolean {
  return isGroupActive(group, settings.nai.vibes);
}

/** 只开这组:清掉组外的勾选并开启本组。解决「换一套搭配」要逐条点的痛点。 */
function soloGroup(group: VibeGroup) {
  const ids = new Set(group.all.map(v => v.id));
  for (const vibe of settings.nai.vibes) vibe.enabled = ids.has(vibe.id);
}

/** 全开/全关只动本组,组外不碰——想叠加两组就各点一次「全开」。 */
function setGroupEnabled(group: VibeGroup, enabled: boolean) {
  for (const vibe of group.all) vibe.enabled = enabled;
}

const enabledCount = computed(() => settings.nai.vibes.filter(v => v.enabled).length);

function groupEnabledCount(group: VibeGroup): number {
  return group.all.filter(v => v.enabled).length;
}

/** 重命名整组:对成员 group 字段批量赋值,不存在悬空引用。 */
function renameGroup(group: VibeGroup) {
  if (!group.name) return;
  const name = window.prompt('重命名分组', group.name)?.trim();
  if (!name || name === group.name) return;
  for (const vibe of settings.nai.vibes) {
    if (vibe.group.trim() === group.name) vibe.group = name;
  }
  // 收起状态跟着改名走(集合里存的是装箱 key),否则改完名字会莫名展开
  const from = groupKey(group.name);
  if (collapsedGroups.value.has(from)) {
    const next = new Set(collapsedGroups.value);
    next.delete(from);
    next.add(groupKey(name));
    collapsedGroups.value = next;
  }
}

/** 解散分组:只清 group 字段,vibe 本体与启用状态都不动(不是删除)。 */
function dissolveGroup(group: VibeGroup) {
  if (!group.name) return;
  for (const vibe of settings.nai.vibes) {
    if (vibe.group.trim() === group.name) vibe.group = '';
  }
}

/**
 * 兼容旧版导入时把组名拼进显示名(「组名 · 原名」)的存量数据。
 * 这里按前缀还原:只动未分组的条目,不覆盖用户已手工分好的组。
 * 按钮仅在真有可整理的条目时出现——没得整理时摆一颗点不出反应的按钮不如不摆。
 */
const prefixGroupPlans = computed(() => planPrefixGroups(settings.nai.vibes));

function applyPrefixGroups() {
  const plans = prefixGroupPlans.value;
  if (!plans.length) return;
  const byId = new Map(settings.nai.vibes.map(v => [v.id, v]));
  for (const plan of plans) {
    const vibe = byId.get(plan.id);
    if (!vibe) continue;
    vibe.group = plan.group;
    vibe.name = plan.name;
  }
  const groups = new Set(plans.map(p => p.group)).size;
  toastr.success(`已把 ${plans.length} 个 Vibe 整理进 ${groups} 个分组`, 'Vibe');
}

async function onVibeImportChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const saved: NaiVibe[] = [];
  try {
    const parsed = await readShizhenVibeFile(file, currentVibeKey.value);
    if (!parsed.items.length) {
      throw new Error('没有识别到可用的 Vibe 编码；请检查文件是否包含 NovelAI Vibe 编码数据。');
    }

    const known = new Set(settings.nai.vibes.map(vibe => vibe.fingerprint).filter(Boolean));
    let duplicates = 0;
    for (const item of parsed.items) {
      const fingerprint = vibeFingerprint(item.data.encodings);
      if (known.has(fingerprint)) {
        duplicates++;
        continue;
      }
      const id = `vibe_${Date.now()}_${++vibeSeq}`;
      const paths = await saveVibeFiles(item.data, null, id);
      const meta = vibeMetaFromData(
        id,
        item.name,
        paths.dataPath,
        paths.thumbnailPath,
        item.data,
        item.strength,
        false,
        item.group,
      );
      saved.push(meta);
      known.add(fingerprint);
    }

    settings.nai.vibes.push(...saved);
    for (const vibe of saved) registerVibePoolResource(vibe);
    const parts = [`新增 ${saved.length} 个`];
    if (duplicates) parts.push(`重复跳过 ${duplicates} 个`);
    if (parsed.unsupported) parts.push(`无法识别 ${parsed.unsupported} 个`);
    toastr.success(`Vibe 导入完成：${parts.join('，')}。新导入项目默认关闭，请按需启用。`, 'Vibe');
  } catch (error) {
    await Promise.all(saved.map(vibe => deleteVibeData(vibe).catch(() => undefined)));
    toastr.error(errorMessage(error), 'Vibe 导入失败');
  }
}

async function exportVibe(vibe: NaiVibe) {
  try {
    const json = await buildNaiv4vibe(vibe, await loadVibeData(vibe));
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vibe.name || 'vibe'}.naiv4vibe`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toastr.error(errorMessage(error), 'Vibe 导出失败');
  }
}

/**
 * 强度取值:滑块与数字框共用 clampVibeStrength(与设置反序列化、vibe 导入同一口径)。
 * 滑块步进 0.01 只是「拖着好用」的粒度,数字框 step="any" 才是真正的自由填值——
 * 想要 0.375 就填 0.375,不再被步进吸附到 5 的倍数上。
 */
function setVibeStrength(vibe: NaiVibe, raw: unknown) {
  vibe.strength = clampVibeStrength(raw, vibe.strength);
}

/**
 * 数字框走 change(而非 input):中途输入 "0." / "-" 这类残缺串不该立刻被夹成 0。
 * 夹取后回写 input.value——填了 5 会被夹到 1,而当强度本来就是 1 时模型值没变、
 * Vue 不会重渲染,框里就会留着一个骗人的 "5"。
 */
function commitVibeStrength(vibe: NaiVibe, event: Event) {
  const input = event.target as HTMLInputElement;
  setVibeStrength(vibe, input.value);
  input.value = String(vibe.strength);
}

async function removeVibe(vibe: NaiVibe) {
  const index = settings.nai.vibes.indexOf(vibe);
  if (index >= 0) settings.nai.vibes.splice(index, 1);
  const referencedByPoolGroup = settings.nai.vibeGroups.some(group =>
    group.refs.some(ref => ref.poolId === vibe.id),
  );
  if (referencedByPoolGroup) {
    toastr.info('已从旧版列表移除；该资源仍被 Vibe 池分组引用，文件予以保留。', 'Vibe');
    return;
  }
  const poolIndex = settings.nai.vibePool.findIndex(item => item.id === vibe.id);
  if (poolIndex >= 0) settings.nai.vibePool.splice(poolIndex, 1);
  settings.nai.vibeCleanupQueue.push({
    dataPath: vibe.dataPath,
    thumbnailPath: vibe.thumbnailPath,
  });
  toastr.info('Vibe 已从索引移除；文件将在设置安全落盘后清理。', 'Vibe');
}
</script>

<template>
  <div class="panel">
    <p class="bbi-page-intro">
      NovelAI 生图接口。地址默认为官方,填第三方兼容站(镜像/转发)即走第三方,协议一致。
    </p>

    <div class="bbi-sections">
      <Collapsible title="配置" :open="false">
        <!-- 接入点库:公益站换着用的人不止一个出口,但换站只换地址+密钥,
             模型/采样器/尺寸等出图参数一概留在下面,渠道级共用,切站不用重配 -->
        <div class="art-row">
          <span class="bbi-field-label">接入点</span>
          <input
            v-if="renamingEndpoint"
            ref="endpointNameInput"
            class="bbi-input"
            type="text"
            v-model="endpointNameDraft"
            placeholder="接入点名称"
            spellcheck="false"
            title="Enter 确认，Esc 取消"
            @keydown.enter.prevent="commitRenameEndpoint"
            @keydown.esc.stop.prevent="renamingEndpoint = false"
            @blur="commitRenameEndpoint"
          />
          <BbiSelect
            v-else
            class="art-select"
            v-model="activeEndpointId"
            :options="endpointOptions"
            aria-label="当前接入点"
          />
          <span v-if="!renamingEndpoint" class="art-ops">
            <button
              class="bbi-icon-btn art-op"
              type="button"
              :disabled="isOfficialEndpoint"
              :title="isOfficialEndpoint ? '官方接入点不可改名' : '重命名当前接入点'"
              aria-label="重命名当前接入点"
              @click="startRenameEndpoint"
            >
              <Icon name="edit" :size="14" />
            </button>
            <button
              class="bbi-icon-btn art-op"
              type="button"
              title="新建一条空接入点"
              aria-label="新建一条空接入点"
              @click="addEndpoint"
            >
              <Icon name="plus" :size="14" />
            </button>
            <button
              class="bbi-icon-btn art-op"
              type="button"
              :title="
                isOfficialEndpoint
                  ? '照官方复制一条,复制出来的地址可以改'
                  : '复制当前接入点(含地址与密钥)'
              "
              aria-label="复制当前接入点"
              @click="duplicateEndpoint"
            >
              <Icon name="copy" :size="14" />
            </button>
            <button
              class="bbi-icon-btn art-op art-remove"
              type="button"
              :disabled="isOfficialEndpoint"
              :title="isOfficialEndpoint ? '官方接入点不可删除' : '删除当前接入点'"
              aria-label="删除当前接入点"
              @click="endpointDeleteOpen = true"
            >
              <Icon name="trash" :size="14" />
            </button>
          </span>
        </div>

        <NaiAccountBalance :endpoint="endpoint" />

        <div class="bbi-field">
          <div class="bbi-field-head">
            <span class="bbi-field-label">接口地址</span>
          </div>
          <input
            class="bbi-input"
            type="text"
            v-model="endpoint.url"
            :readonly="isOfficialEndpoint"
            :placeholder="NAI_OFFICIAL_URL"
            spellcheck="false"
            :title="isOfficialEndpoint ? '官方接入点地址固定,不可修改' : ''"
          />
          <p class="bbi-field-hint">
            {{
              isOfficialEndpoint
                ? '官方接入点,地址固定;要用第三方站请点上方「+」新建一条。'
                : '第三方站填域名即可,自动补全 /ai 端点。'
            }}
          </p>
        </div>

        <div class="bbi-field">
          <div class="bbi-field-head">
            <span class="bbi-field-label">API Key</span>
          </div>
          <div class="key-row">
            <input
              class="bbi-input"
              :type="showKey ? 'text' : 'password'"
              v-model="endpoint.key"
              placeholder="nai-..."
              spellcheck="false"
            />
            <button
              class="bbi-btn"
              type="button"
              :title="showKey ? '隐藏' : '显示'"
              @click="showKey = !showKey"
            >
              <Icon :name="showKey ? 'eye-off' : 'eye'" />
            </button>
          </div>
          <!-- key 随条目走而非渠道级共用:公益站各有各的 key,共用一份等于每次换站都要重填 -->
          <p class="bbi-field-hint">
            {{
              isOfficialEndpoint
                ? '在 NovelAI 设置页生成。每条接入点各存各的 key。'
                : '该站自己的 key;每条接入点各存各的,切回官方不会串。'
            }}
          </p>
        </div>

        <div class="conn-actions">
          <span v-if="inUse" class="conn-inuse"><Icon name="check" :size="13" /> 当前出图渠道</span>
          <button
            v-else
            class="bbi-btn conn-use"
            type="button"
            title="tag 书写规范会切到 NAI"
            @click="settings.defaultBackend = 'nai'"
          >
            使用此渠道出图
          </button>
          <button class="bbi-btn" type="button" :disabled="testing" @click="onTestConnection">
            <Icon name="plug" />
            {{ testing ? '连接中…' : '测试连接' }}
          </button>
        </div>
      </Collapsible>

      <Collapsible title="提示词" :open="false">
        <!-- 画师串库:形制与 ComfyUI 工作流库一致,多一个「不使用」选项 -->
        <div class="art-row">
          <span class="bbi-field-label">画师串</span>
          <input
            v-if="renamingArtist"
            ref="artistNameInput"
            class="bbi-input"
            type="text"
            v-model="artistNameDraft"
            placeholder="画师串名称"
            spellcheck="false"
            title="Enter 确认，Esc 取消"
            @keydown.enter.prevent="commitRenameArtist"
            @keydown.esc.stop.prevent="renamingArtist = false"
            @blur="commitRenameArtist"
          />
          <BbiSelect
            v-else
            class="art-select"
            v-model="activeArtistId"
            :options="artistOptions"
            aria-label="当前画师串"
          />
          <span v-if="!renamingArtist" class="art-ops">
            <button
              class="bbi-icon-btn art-op"
              type="button"
              title="管理画师串库:搜索、预览图、批量删除"
              aria-label="管理画师串库"
              @click="artistManagerOpen = true"
            >
              <Icon name="grid" :size="14" />
            </button>
            <button
              class="bbi-icon-btn art-op"
              type="button"
              :disabled="!hasArtist || isBuiltinArtist"
              :title="
                !hasArtist
                  ? '未选中画师串'
                  : isBuiltinArtist
                    ? '内置画师串不可改名,点复制建一条自己的'
                    : '重命名当前画师串'
              "
              aria-label="重命名当前画师串"
              @click="startRenameArtist"
            >
              <Icon name="edit" :size="14" />
            </button>
            <button
              class="bbi-icon-btn art-op"
              type="button"
              title="新建一条空画师串"
              aria-label="新建一条空画师串"
              @click="addArtist"
            >
              <Icon name="plus" :size="14" />
            </button>
            <button
              class="bbi-icon-btn art-op"
              type="button"
              :disabled="!hasArtist"
              :title="
                !hasArtist
                  ? '未选中画师串'
                  : isBuiltinArtist
                    ? '复制为我的画师串,复制出来的可以随便改'
                    : '复制当前画师串'
              "
              aria-label="复制当前画师串"
              @click="duplicateArtist"
            >
              <Icon name="copy" :size="14" />
            </button>
            <button
              class="bbi-icon-btn art-op art-remove"
              type="button"
              :disabled="!hasArtist || isBuiltinArtist"
              :title="
                !hasArtist
                  ? '未选中画师串'
                  : isBuiltinArtist
                    ? '内置画师串不可删除,它会随插件版本更新'
                    : '删除当前画师串'
              "
              aria-label="删除当前画师串"
              @click="artistDeleteOpen = true"
            >
              <Icon name="trash" :size="14" />
            </button>
          </span>
        </div>

        <!-- 内容内联编辑:画师串通常就几个 tag,让「选中哪条」与「这条写了什么」一眼同框 -->
        <template v-if="artist">
          <BbiTextarea
            v-model="artist.prompt"
            :rows="3"
            :max-rows="8"
            mono
            :readonly="isBuiltinArtist"
            placeholder="artist:xxx, artist:yyy"
          />
          <p v-if="isBuiltinArtist" class="bbi-field-hint art-hint">
            内置画师串随插件版本更新,不可直接改;点上方复制按钮建一条自己的再改。
          </p>
          <!-- 仅 V5 模型下提醒:V5 与 4.5 的画师串响应差异大,4.5 及以下不需要这条噪音 -->
          <p v-if="isV5Model" class="bbi-field-hint art-hint art-hint-warn">
            NAI 5 对画师串的响应与 4.5 差异很大,旧画师串直接套用效果可能跑偏,建议重新调试。
          </p>

          <!-- 随画师串一起切换的正/负面词:设置了覆盖下面渠道级,没设置就用下面的 -->
          <ul class="bbi-prompt-list art-bound-list">
            <li v-for="t in artistBoundTargets" :key="t.key" class="bbi-prompt-item">
              <button class="bbi-prompt-open" type="button" @click="openNaiPrompt(t)">
                <span class="bbi-prompt-name">{{ t.label }}</span>
                <span class="bbi-prompt-state" :class="{ 'is-custom': isTargetCustom(t) }">
                  {{ isTargetCustom(t) ? '已设置' : '未设置' }}
                </span>
                <Icon name="edit" class="bbi-prompt-edit" />
              </button>
            </li>
          </ul>
          <p class="bbi-field-hint art-hint">
            这里设置的提示词会覆盖下面的，随画师串一起切换;这里没设置，就会用下面的。
          </p>
        </template>
        <!-- 不选画师串时无提示:下拉里「不使用」已自明 -->

        <hr class="art-divider" />

        <!-- 渠道级质量词/负面词:只读列表行,点行进弹窗编辑(与设置页「自定义提示词」同款) -->
        <ul class="bbi-prompt-list">
          <li v-for="t in CHANNEL_PROMPT_TARGETS" :key="t.key" class="bbi-prompt-item">
            <button class="bbi-prompt-open" type="button" @click="openNaiPrompt(t)">
              <span class="bbi-prompt-name">{{ t.label }}</span>
              <span v-if="isShadowedByArtist(t.key)" class="bbi-prompt-state is-shadowed">
                已被画师串覆盖
              </span>
              <span v-else class="bbi-prompt-state" :class="{ 'is-custom': isTargetCustom(t) }">
                {{ isTargetCustom(t) ? '已自定义' : '默认' }}
              </span>
              <Icon name="edit" class="bbi-prompt-edit" />
            </button>
          </li>
        </ul>
        <p class="bbi-field-hint art-hint">
          画师串里没设置正/负面词时，就会用这里的;这里也留空，则按模型取官方词。
        </p>
      </Collapsible>

      <Collapsible title="默认参数" :open="false">
        <!-- 语义配对紧凑行:双字段行两列、数字参数行四列;说明统一收进行下的一行 hint -->
        <div class="bbi-field">
          <div class="bbi-field-head">
            <span class="bbi-field-label">模型</span>
          </div>
          <BbiSelect
            class="be-select"
            v-model="modelSel"
            :options="NAI_MODELS"
            aria-label="NAI 模型"
          />
        </div>

        <label class="bbi-switch-row">
          <span class="bbi-field-label">插图提示词附加英文描述</span>
          <input v-model="settings.nai.naturalLanguage" type="checkbox" class="bbi-checkbox" />
        </label>
        <p class="bbi-field-hint">
          普通插图会在关键词之外给画面和人物补一小段英文描述，方便表达姿势、环境和互动。遇到提示词上限时建议关掉，漫画页使用自己的分镜格式。
        </p>

        <div class="be-row">
          <div class="bbi-field">
            <div class="bbi-field-head">
              <span class="bbi-field-label">竖图尺寸（宽 × 高）</span>
            </div>
            <input
              class="bbi-input"
              type="text"
              v-model="settings.nai.portraitSize"
              list="nai-portrait-presets"
              placeholder="832×1216"
              spellcheck="false"
            />
            <datalist id="nai-portrait-presets">
              <option value="832×1216">竖版</option>
              <option value="1024×1536">大竖版</option>
              <option value="1024×1024">方图</option>
            </datalist>
          </div>
          <div class="bbi-field">
            <div class="bbi-field-head">
              <span class="bbi-field-label">横图尺寸（宽 × 高）</span>
            </div>
            <input
              class="bbi-input"
              type="text"
              v-model="settings.nai.landscapeSize"
              list="nai-landscape-presets"
              placeholder="1216×832"
              spellcheck="false"
            />
            <datalist id="nai-landscape-presets">
              <option value="1216×832">横版</option>
              <option value="1536×1024">大横版</option>
              <option value="1024×1024">方图</option>
            </datalist>
          </div>
        </div>
        <div class="bbi-select-row">
          <span class="bbi-field-label">画幅方向</span>
          <div class="bbi-segmented" role="tablist" aria-label="NAI 画幅方向">
            <button
              v-for="opt in ORIENTATION_LOCKS"
              :key="opt.value"
              class="bbi-seg"
              :class="{ 'is-on': settings.nai.orientationLock === opt.value }"
              type="button"
              role="tab"
              :aria-selected="settings.nai.orientationLock === opt.value"
              @click="settings.nai.orientationLock = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <p class="bbi-field-hint">
          「自动」由插件按场景选横图或竖图，漫画默认竖图。锁定后每张都用对应尺寸，也会按该方向构图。
        </p>

        <div class="be-row">
          <div class="bbi-field">
            <div class="bbi-field-head">
              <span class="bbi-field-label">采样器</span>
            </div>
            <BbiSelect
              class="be-select"
              v-model="settings.nai.sampler"
              :options="samplerOptions"
              aria-label="采样器"
            />
          </div>
          <div class="bbi-field">
            <div class="bbi-field-head">
              <span class="bbi-field-label">噪声表</span>
            </div>
            <BbiSelect
              class="be-select"
              v-model="settings.nai.noiseSchedule"
              :options="NAI_NOISE_SCHEDULES"
              aria-label="噪声表"
            />
          </div>
        </div>

        <label class="bbi-switch-row">
          <span class="bbi-field-label">NAI 官方质量标签（Quality Toggle）</span>
          <input v-model="settings.nai.qualityToggle" type="checkbox" class="bbi-checkbox" />
          <span class="bbi-check-state">{{ settings.nai.qualityToggle ? '✓ 已开启' : '已关闭' }}</span>
        </label>
        <div class="bbi-field">
          <span class="bbi-field-label">Undesired Content 预设</span>
          <select class="bbi-input" v-model.number="settings.nai.ucPreset">
            <option :value="0">Heavy</option><option :value="1">Light</option><option :value="2">Furry</option><option :value="3">Human</option><option :value="4">None</option>
          </select>
        </div>
        <p class="bbi-field-hint">采样器和噪声表会改变画面的生成方式。同样的提示词和种子，换一项也可能得到不同的图。质量开关与 UC 预设会随模型分别记忆。</p>
        <p v-if="isNaiMedium(settings.nai.model)" class="bbi-field-hint">V5 Medium 固定用 14 步、Euler Ancestral、Rescale 0 和内置负面词。下方的自定义值会在切回支持它们的模型时生效。</p>
        <div class="be-row be-row--nums">
          <div class="bbi-field">
            <div class="bbi-field-head">
              <span class="bbi-field-label">步数</span>
            </div>
            <input class="bbi-input" type="number" v-model.number="settings.nai.steps" min="1" max="50" />
          </div>
          <div class="bbi-field">
            <div class="bbi-field-head">
              <span class="bbi-field-label">提示词引导（Scale）</span>
            </div>
            <input
              class="bbi-input"
              type="number"
              v-model.number="settings.nai.scale"
              min="0"
              max="35"
              step="0.1"
            />
          </div>
          <div class="bbi-field">
            <div class="bbi-field-head">
              <span class="bbi-field-label">引导修正（Rescale）</span>
            </div>
            <input
              class="bbi-input"
              type="number"
              v-model.number="settings.nai.cfgRescale"
              min="0"
              max="1"
              step="0.05"
            />
          </div>
          <div class="bbi-field">
            <div class="bbi-field-head">
              <span class="bbi-field-label">种子</span>
            </div>
            <input class="bbi-input" type="number" v-model.number="settings.nai.seed" min="0" />
          </div>
        </div>
        <p class="bbi-field-hint">步数是生成图像的迭代次数。Scale 控制模型跟随提示词的强度，Rescale 可缓和较高引导值带来的失真。种子设为 0 时每次随机，填固定值便于对比改动。</p>

        <label class="bbi-switch-row">
          <span class="bbi-field-label">画面多样性（Variety+）</span>
          <input v-model="settings.nai.varietyBoost" type="checkbox" class="bbi-checkbox" :disabled="!varietyBoostSupported" aria-describedby="nai-variety-boost-hint" />
          <span class="bbi-check-state">{{ varietyBoostSupported ? (settings.nai.varietyBoost ? '✓ 已开启' : '已关闭') : '当前模型不支持' }}</span>
        </label>
        <p id="nai-variety-boost-hint" class="bbi-field-hint" :class="{ 'is-muted': !varietyBoostSupported }">
          {{ varietyBoostSupported ? '开启后，模型在生成前段先自由发挥构图，后段再加强提示词引导。数值会按模型版本和画面尺寸自动计算。' : 'NAI V5 不支持 Variety+，切换到 V3、V4 或 V4.5 后可使用。' }}
        </p>

        <label class="bbi-switch-row">
          <span class="bbi-field-label">漫画页模式（仅 V5）</span>
          <input
            v-model="settings.nai.comicMode"
            type="checkbox"
            class="bbi-checkbox"
            :disabled="!isNai5(settings.nai.model)"
          />
        </label>
        <p class="bbi-field-hint">开启后，每张图是一页分格漫画。插件分开传入页面布局和各格人物，用动作与表情表现剧情，画面不加对白。关闭时按普通插图生成。</p>

        <div v-if="showComicSettings" class="bbi-num-row">
          <span class="bbi-field-label">漫画分析模式</span>
          <BbiSelect v-model="comicAnalysisMode" :options="comicAnalysisOptions" aria-label="漫画分析模式" />
        </div>
        <p v-if="showComicSettings" class="bbi-field-hint" aria-live="polite">
          {{ comicAnalysisMode === 'fast'
            ? '极速沿用标准的分镜规则，优先使用本段正文和造型档案；近期正文按下方楼数携带。世界书仅补充未建档人物的相关外貌资料。'
            : comicAnalysisMode === 'simple'
              ? '简单适合日常配图。保留对场景和人物的参考，缩短分析指令，由 AI 直接写提示词。'
              : '标准适合复杂剧情，使用完整分镜规则和近期上下文，通常需要更多分析时间和 token。' }}
          模式切换从下一轮生效。
        </p>
        <label class="bbi-num-row">
          <span class="bbi-field-label">携带最近 AI 楼数</span>
          <input v-model.number="settings.autoTag.contextMessages" class="bbi-input bbi-num" type="number" min="0" step="1"
            @change="settings.autoTag.contextMessages = Math.max(0, Math.floor(Number(settings.autoTag.contextMessages) || 0))" />
        </label>
        <p class="bbi-field-hint">三个漫画分析模式与普通插图都适用。当前回复计入楼数：1 只分析本楼，2 再带上一条 AI 回复及其间用户消息。0 关闭额外历史参考。本楼正文与当前造型仍会保留；楼数越大通常越耗 token。</p>
        <div v-if="showComicSettings" class="bbi-num-row">
          <span class="bbi-field-label">{{ comicAnalysisMode === 'simple' ? '简单模式推理方式' : '标准与极速的推理方式' }}</span>
          <BbiSelect v-model="comicReasoning" :options="comicReasoningOptions" aria-label="当前漫画模式推理方式" />
        </div>
        <p v-if="showComicSettings" class="bbi-field-hint" aria-live="polite">
          {{ comicReasoningCaps.label }}。标准和极速共用这项设置。关闭推理可能加快分析，也可能漏掉复杂情节。
        </p>

        <div v-if="showComicSettings" class="bbi-num-row">
          <span class="bbi-field-label">附加分镜风格</span>
          <BbiSelect
            v-model="comicStyle"
            :options="comicStyleOptions"
            aria-label="附加分镜风格"
          />
        </div>
        <p v-if="showComicSettings" class="bbi-field-hint" aria-live="polite">
          {{ selectedComicStyle.description }}
        </p>
        <p v-if="showComicSettings" class="bbi-field-hint">
          分镜风格决定画格怎么排、重点放在哪。「仅通用规则」让模型按事件安排。已有图片需先重写提示词再重画，才会用新风格。
        </p>

        <div v-if="showComicSettings" class="bbi-num-row">
          <span class="bbi-field-label">留白方案</span>
          <BbiSelect
            v-model="comicGutter"
            :options="comicGutterOptions"
            aria-label="留白方案"
          />
        </div>
        <p v-if="showComicSettings" class="bbi-field-hint" aria-live="polite">
          留白决定画格之间和页面边缘如何分隔。{{ selectedComicGutter.description }}
        </p>

        <label v-if="showComicSettings && comicAnalysisMode !== 'simple'" class="bbi-switch-row">
          <span class="bbi-field-label">减弱同人角色带入的原作画风</span>
          <input
            v-model="settings.nai.comicAntiPossession"
            type="checkbox"
            class="bbi-checkbox"
          />
        </label>

        <p v-if="showComicSettings && comicAnalysisMode !== 'simple'" class="bbi-field-hint">同人角色有时会把原作画风带到整页。开启后会尝试排除对应人物的原作画风，保留身份和外貌。</p>

        <ComicExtraRules v-if="showComicSettings" />

        <div class="bbi-num-row">
          <span class="bbi-field-label">同时出图数</span>
          <input
            class="bbi-input bbi-num"
            type="number"
            v-model.number="settings.nai.concurrency"
            min="1"
            max="4"
          />
        </div>
        <p class="bbi-field-hint">
          控制同时发给 NAI 几张图，超出的会在插件里排队。一般用 1 更稳；并发较高时更容易遇到限流，插件会暂停后重试。
        </p>
      </Collapsible>

      <Collapsible title="Vibe 库(氛围转移)" :open="false">
        <p v-if="vibesSupported" class="bbi-field-hint vibe-hint">
          上传参考图,生成时叠加其风格/氛围;编码按当前选中的模型进行,会消耗一次接口调用。
        </p>
        <p v-else class="bbi-field-hint vibe-hint">
          Current model does not support Vibe Transfer.
        </p>

        <div class="vibe-actions">
          <button class="bbi-btn" type="button" :disabled="vibeEncoding || !vibesSupported" @click="vibeFileInput?.click()">
            <Icon name="plus" />
            {{ vibeEncoding ? '编码中…' : '上传图片编码' }}
          </button>
          <button class="bbi-btn" type="button" @click="vibeImportInput?.click()">
            <Icon name="download" />
            导入 .naiv4vibe
          </button>
          <label class="bbi-switch-row vibe-normalize">
            <span class="bbi-field-label">强度归一化</span>
            <input v-model="settings.nai.normalizeRefStrength" type="checkbox" class="bbi-checkbox" :disabled="!vibesSupported" />
            <span class="bbi-check-state">{{ settings.nai.normalizeRefStrength ? '✓ 已开启' : '已关闭' }}</span>
          </label>
          <input ref="vibeFileInput" type="file" accept="image/*" hidden @change="onVibeFileChange" />
          <input ref="vibeImportInput" type="file" accept=".naiv4vibe,.json,.zip,.naiv4vibebundle,application/json,application/zip" hidden @change="onVibeImportChange" />
        </div>

        <div class="vibe-pool-manager">
          <div class="vibe-toolbar">
            <strong>独立 Vibe 池</strong>
            <span class="vibe-count">{{ settings.nai.vibePool.length }} 个资源 · {{ poolGroupCount }} 个组</span>
            <span class="vibe-count">{{ settings.nai.activeVibeGroupId ? '当前使用：' + (settings.nai.vibeGroups.find(group => group.id === settings.nai.activeVibeGroupId)?.name || '分组') : '当前使用：原生 Vibe 库' }}</span>
            <button v-if="settings.nai.activeVibeGroupId" class="bbi-btn bbi-btn-sm" type="button" @click="settings.nai.activeVibeGroupId = ''">切回原生 Vibe 库</button>
            <button v-if="!poolSelectionMode" class="bbi-btn bbi-btn-sm" type="button" @click="poolSelectionMode = true">
              从资源池选择组建 Vibe 组
            </button>
            <template v-else>
              <span class="vibe-count">已选 {{ poolSelectionCount }} 个</span>
              <button class="bbi-btn bbi-btn-sm bbi-btn-primary" type="button" :disabled="!poolSelectionCount" @click="createPoolGroupFromSelection">创建/追加到组</button>
              <button class="bbi-btn bbi-btn-sm" type="button" @click="selectedPoolIds = new Set()">清空</button>
              <button class="bbi-btn bbi-btn-sm" type="button" @click="poolSelectionMode = false; selectedPoolIds = new Set()">取消</button>
            </template>
          </div>
          <p class="bbi-field-hint">资源池只保存一份 Vibe 编码；一个资源可以同时被多个组引用，各组成员的强度和 Information Extracted 独立保存。</p>
          <div v-if="poolSelectionMode" class="vibe-pool-grid">
            <label v-for="resource in settings.nai.vibePool" :key="resource.id" class="vibe-pool-item">
              <input type="checkbox" class="bbi-checkbox" :checked="selectedPoolIds.has(resource.id)" @change="togglePoolSelection(resource.id)" />
              <span>{{ resource.name }}</span>
              <small>{{ resource.modelKeys.join(' / ') || '无模型编码' }}</small>
              <button class="bbi-btn bbi-btn-sm" type="button" @click.prevent.stop="removePoolResource(resource.id)">删除资源</button>
            </label>
            <p v-if="!settings.nai.vibePool.length" class="bbi-field-hint">资源池暂时为空；上传或导入 Vibe 后会自动加入。</p>
          </div>
          <div v-if="settings.nai.vibeGroups.length" class="vibe-pool-groups">
            <div v-for="group in settings.nai.vibeGroups" :key="group.id" class="vibe-pool-group">
              <div class="vibe-toolbar">
                <strong>{{ group.name }}</strong>
                <span class="vibe-count">{{ group.refs.length }} 个引用</span>
                <button class="bbi-btn bbi-btn-sm" type="button" @click="settings.nai.activeVibeGroupId = group.id">{{ settings.nai.activeVibeGroupId === group.id ? '当前使用中' : '本次生图使用此组' }}</button>
                <button class="bbi-btn bbi-btn-sm" type="button" @click="renamePoolGroup(group.id)">重命名</button>
                <button class="bbi-btn bbi-btn-sm" type="button" @click="removePoolGroup(group.id)">删除组</button>
              </div>
              <div v-for="ref in group.refs" :key="ref.poolId" class="vibe-pool-ref">
                <span>{{ poolResourceById.get(ref.poolId)?.name || '缺失资源' }}</span>
                <label><input type="checkbox" class="bbi-checkbox" :checked="ref.enabled" @change="updatePoolRefEnabled(group.id, ref.poolId, ($event.target as HTMLInputElement).checked)" />启用</label>
                <label>强度 <input class="bbi-input" type="number" min="0" max="1" step="0.05" :value="ref.strength" @change="updatePoolRefStrength(group.id, ref.poolId, ($event.target as HTMLInputElement).value)" /></label>
                <label>Information Extracted <input class="bbi-input" type="number" min="0" max="1" step="0.05" :value="ref.informationExtracted ?? ''" placeholder="沿用编码值" @change="updatePoolRefInfo(group.id, ref.poolId, ($event.target as HTMLInputElement).value)" /></label>
                <button class="bbi-btn bbi-btn-sm" type="button" @click="group.refs.splice(group.refs.findIndex(item => item.poolId === ref.poolId), 1)">移出组</button>
              </div>
            </div>
          </div>
        </div>

        <p v-if="!settings.nai.vibes.length" class="bbi-field-hint">还没有 vibe;上传一张参考图开始。</p>

        <template v-else>
          <div class="vibe-toolbar">
            <input
              class="bbi-input vibe-search"
              type="search"
              v-model="vibeSearch"
              placeholder="搜索名称或分组…"
              spellcheck="false"
              aria-label="搜索 Vibe"
            />
            <span class="vibe-count">
              共 {{ settings.nai.vibes.length }} 个 · 已启用 {{ enabledCount }}
            </span>
            <button
              v-if="!vibeGroupSelectionMode"
              class="bbi-btn bbi-btn-sm"
              type="button"
              @click="vibeGroupSelectionMode = true"
            >
              <Icon name="checklist" :size="12" /> 从 Vibe 列表选择加入池组
            </button>
            <template v-else>
              <span class="vibe-count">已选 {{ selectedVibeCount }} 个</span>
              <button class="bbi-btn bbi-btn-sm" type="button" @click="selectVisibleVibes">全选当前结果</button>
              <button class="bbi-btn bbi-btn-sm" type="button" @click="clearVibeSelection">清空</button>
              <button class="bbi-btn bbi-btn-sm bbi-btn-primary" type="button" :disabled="!selectedVibeCount" @click="finishVibeGroupSelection">组成分组</button>
              <button class="bbi-btn bbi-btn-sm" type="button" @click="cancelVibeGroupSelection">取消</button>
            </template>
            <button
              v-if="prefixGroupPlans.length"
              class="bbi-btn bbi-btn-sm"
              type="button"
              title="旧版迁移把组名拼进了名字,点此还原成真正的分组"
              @click="applyPrefixGroups"
            >
              <Icon name="checklist" :size="12" />
              按名称整理分组({{ prefixGroupPlans.length }})
            </button>
          </div>

          <p v-if="!matchedCount" class="bbi-field-hint">没有匹配「{{ vibeSearch }}」的 Vibe。</p>

          <div v-for="group in vibeGroups" :key="group.key" class="vibe-group">
            <div class="vibe-group-head">
              <button
                class="vibe-group-toggle"
                type="button"
                :aria-expanded="!isGroupCollapsed(group.key)"
                @click="toggleGroup(group.key)"
              >
                <Icon
                  name="chevron"
                  :size="14"
                  class="vibe-group-chevron"
                  :class="{ 'is-collapsed': isGroupCollapsed(group.key) }"
                />
                <span class="vibe-group-name">{{ group.label }}</span>
                <span class="vibe-group-meta">
                  {{ groupEnabledCount(group) }}/{{ group.all.length }}
                  <template v-if="group.items.length !== group.all.length">
                    · 显示 {{ group.items.length }}
                  </template>
                </span>
                <span v-if="groupActive(group)" class="bbi-prompt-state vibe-group-active">
                  生效中
                </span>
              </button>
              <span class="vibe-group-ops">
                <button
                  class="bbi-btn bbi-btn-sm bbi-btn-primary"
                  type="button"
                  title="只叠加这一组:关掉组外全部勾选,开启本组"
                  @click="soloGroup(group)"
                >
                  只开这组
                </button>
                <button
                  class="bbi-btn bbi-btn-sm"
                  type="button"
                  title="开启本组,不影响其它组(用来叠加多组)"
                  @click="setGroupEnabled(group, true)"
                >
                  全开
                </button>
                <button
                  class="bbi-btn bbi-btn-sm"
                  type="button"
                  title="关闭本组"
                  @click="setGroupEnabled(group, false)"
                >
                  全关
                </button>
                <button
                  v-if="group.name"
                  class="bbi-icon-mini"
                  type="button"
                  title="重命名分组"
                  aria-label="重命名分组"
                  @click="renameGroup(group)"
                >
                  <Icon name="edit" :size="12" />
                </button>
                <button
                  v-if="group.name"
                  class="bbi-icon-mini"
                  type="button"
                  title="解散分组(只取消归类,不删除 Vibe)"
                  aria-label="解散分组"
                  @click="dissolveGroup(group)"
                >
                  <Icon name="close" :size="12" />
                </button>
              </span>
            </div>

            <div v-show="!isGroupCollapsed(group.key)" class="vibe-group-body">
              <div v-for="vibe in group.items" :key="vibe.id" class="vibe-item">
                <img
                  v-if="vibe.thumbnailPath"
                  class="vibe-thumb"
                  :src="vibe.thumbnailPath"
                  :alt="vibe.name"
                  loading="lazy"
                  decoding="async"
                />
                <div v-else class="vibe-thumb vibe-thumb--empty"><Icon name="generate" /></div>
                <div class="vibe-main">
                  <div class="vibe-head">
                    <label v-if="vibeGroupSelectionMode" class="vibe-enable" title="选择此 Vibe 加入新分组">
                      <input
                        type="checkbox"
                        class="bbi-checkbox"
                        :checked="selectedVibeIds.has(vibe.id)"
                        @change="toggleVibeSelection(vibe)"
                      />
                      选择
                    </label>
                    <input class="bbi-input vibe-name" type="text" v-model="vibe.name" spellcheck="false" @change="syncPoolResource(vibe)" />
                    <label class="vibe-enable" title="生成时叠加此 vibe">
                      <input v-model="vibe.enabled" type="checkbox" class="bbi-checkbox" />
                      启用
                    </label>
                  </div>
                  <div class="vibe-strength">
                    <span class="vibe-strength-label">强度</span>
                    <input
                      class="bbi-range"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      :value="vibe.strength"
                      aria-label="强度"
                      @input="setVibeStrength(vibe, ($event.target as HTMLInputElement).value)"
                    />
                    <input
                      class="bbi-input vibe-strength-num"
                      type="number"
                      min="0"
                      max="1"
                      step="any"
                      :value="vibe.strength"
                      aria-label="强度数值"
                      @change="commitVibeStrength(vibe, $event)"
                    />
                  </div>
                  <div class="vibe-ops">
                    <BbiSelect
                      class="vibe-group-select"
                      :model-value="groupKey(vibe.group)"
                      :options="groupOptions"
                      aria-label="所属分组"
                      @update:model-value="onGroupPick(vibe, $event)"
                    />
                    <button
                      v-if="vibesSupported && !vibe.modelKeys.includes(currentVibeKey) && vibe.hasImage"
                      class="bbi-btn bbi-btn-sm"
                      type="button"
                      :disabled="vibeEncoding"
                      title="该 vibe 缺当前模型的编码,生成时会被跳过;点击按当前模型补编码"
                      @click="reencodeVibe(vibe)"
                    >
                      <Icon name="refresh" :size="12" /> 补当前模型编码
                    </button>
                    <span v-else-if="!vibesSupported" class="vibe-missing">
                      当前模型暂不支持 Vibe
                    </span>
                    <span v-else-if="!vibe.modelKeys.includes(currentVibeKey)" class="vibe-missing">
                      缺当前模型编码且无原图,无法使用
                    </span>
                    <button
                      class="bbi-btn bbi-btn-sm"
                      type="button"
                      title="导出 .naiv4vibe"
                      @click="exportVibe(vibe)"
                    >
                      <Icon name="upload" :size="12" /> 导出
                    </button>
                    <button class="bbi-btn bbi-btn-sm" type="button" title="删除" @click="removeVibe(vibe)">
                      <Icon name="trash" :size="12" /> 删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </Collapsible>

    <!-- ===== 画师串库管理器:搜索/预览图/勾选批量删除 ===== -->
    <NaiArtistProfiles />
    <NaiShizhenMigration />
    <NaiArtistManager v-model:open="artistManagerOpen" />
    </div>

    <ConfirmDialog
      v-model:open="endpointDeleteOpen"
      title="删除接入点"
      confirm-text="删除"
      confirm-icon="trash"
      tone="danger"
      @confirm="confirmRemoveEndpoint"
    >
      确定删除接入点「{{ endpoint.name || '未命名接入点' }}」？地址与 API Key 会一并删除。
    </ConfirmDialog>

    <ConfirmDialog
      v-model:open="artistDeleteOpen"
      title="删除画师串"
      confirm-text="删除"
      confirm-icon="trash"
      tone="danger"
      @confirm="confirmRemoveArtist"
    >
      确定删除画师串「{{ artist?.name || '未命名画师串' }}」？删除后无法恢复。
    </ConfirmDialog>

    <!-- ===== 质量词 / 负面词编辑弹窗(与设置页自定义提示词同款) ===== -->
    <ModalMask :open="!!editingNaiPrompt" @close="closeNaiPrompt">
      <div
        v-if="editingNaiPrompt"
        class="bbi-modal bbi-modal-wide"
        role="dialog"
        aria-modal="true"
        :aria-label="`编辑${editingNaiPrompt.label}`"
      >
        <header class="bbi-modal-head">
          <span class="bbi-modal-title">
            {{ editingNaiPrompt.readonly ? '查看' : '编辑' }}{{ editingNaiPrompt.label }}
          </span>
          <button class="bbi-icon-mini" type="button" title="关闭" @click="closeNaiPrompt">
            <Icon name="close" />
          </button>
        </header>

        <p class="bbi-modal-label">{{ editingNaiPrompt.hint }}</p>

        <BbiTextarea
          v-model="naiPromptDraft"
          class="bbi-prompt-area"
          :rows="12"
          :max-rows="28"
          mono
          :readonly="editingNaiPrompt.readonly"
        />

        <footer class="bbi-modal-foot">
          <template v-if="!editingNaiPrompt.readonly">
            <button class="bbi-btn bbi-btn-danger" type="button" @click="resetNaiPromptDraft">
              <Icon name="refresh" /> 恢复默认
            </button>
            <span class="bbi-modal-foot-spacer"></span>
            <button class="bbi-btn" type="button" @click="closeNaiPrompt">取消</button>
            <button class="bbi-btn bbi-btn-primary" type="button" @click="saveNaiPrompt">完成</button>
          </template>
          <template v-else>
            <span class="bbi-modal-foot-spacer"></span>
            <button class="bbi-btn bbi-btn-primary" type="button" @click="closeNaiPrompt">关闭</button>
          </template>
        </footer>
      </div>
    </ModalMask>
  </div>
</template>

<style scoped>
.vibe-pool-manager { display: grid; gap: 10px; margin: 10px 0 14px; padding: 12px; border: 1px solid var(--bbi-border); border-radius: 10px; }
.vibe-pool-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.vibe-pool-item, .vibe-pool-ref { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px; border: 1px solid var(--bbi-border); border-radius: 7px; }
.vibe-pool-item small { margin-left: auto; opacity: .65; }
.vibe-pool-groups { display: grid; gap: 8px; }
.vibe-pool-group { display: grid; gap: 7px; padding: 9px; border: 1px solid var(--bbi-border); border-radius: 8px; }
.vibe-pool-ref { flex-wrap: wrap; }
.vibe-pool-ref label { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
.vibe-pool-ref .bbi-input { width: 74px; }

/* 默认参数的语义配对紧凑行:双字段行两列、数字参数行四列;
   窄屏双字段行落单列、数字行落 2×2。
   垂直节奏由行容器统一管(行内字段的 margin-bottom 归零),
   不靠 .bbi-field 自带的:last-child 规则——行尾字段会被它吃掉下间距。 */
.be-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 12px;
  margin-bottom: 18px;
}

.be-row .bbi-field {
  margin-bottom: 0;
}

/* 参数区的自绘下拉吃满字段宽:与同行的 .bbi-input(模型名/尺寸)左右对齐,
   子组件根类默认 180px/flex:none,这里压过去。 */
.be-select {
  width: 100%;
}

.be-row--nums {
  grid-template-columns: repeat(4, 1fr);
}

@media (max-width: 640px) {
  .be-row {
    grid-template-columns: 1fr;
  }

  .be-row--nums {
    grid-template-columns: repeat(2, 1fr);
  }
}
.key-row {
  display: flex;
  gap: 8px;
}
.key-row .bbi-input {
  flex: 1 1 auto;
  min-width: 0;
}
.conn-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 12px;
}
/* 左侧「使用此渠道 / 当前出图渠道」与右侧测试连接分据两端 */
.conn-use,
.conn-inuse {
  margin-right: auto;
}
.conn-inuse {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--bbi-accent);
}
.vibe-hint {
  margin-top: 0;
}

/* —— 画师串库(形制照搬 ComfyUIPanel 的 .wf-*) —— */
/* 选择行:grid 而非 flex——靠 flex-basis 撑出的对齐一 wrap 就散,
   固定首列宽让标签列与下方各行的标签列同起点。 */
.art-row {
  display: grid;
  grid-template-columns: 5.5em minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}
.art-row > .bbi-field-label:first-child {
  white-space: nowrap;
}
.art-row > .bbi-input {
  min-width: 0;
}
/* 下拉不吃满:名称通常很短,拉满只会拖出半截空白(子组件根类默认 180px/不伸缩,此处 0,2,0 压过) */
.art-row > .art-select {
  width: auto;
  max-width: 320px;
  min-width: 0;
}
.art-ops {
  display: flex;
  gap: 4px;
  justify-self: end;
}
/* 四个操作低频且同级,图标化后整行只剩下拉一个视觉重点;文案退到 title/aria-label */
.art-op {
  width: 30px;
  height: 30px;
  font-size: 13px;
}
.art-op:disabled {
  opacity: 0.4;
  cursor: default;
}
.art-remove:not(:disabled) {
  color: var(--bbi-danger);
}
.art-remove:not(:disabled):hover {
  color: var(--bbi-danger);
  background: var(--bbi-danger-soft);
}
.art-hint {
  margin-top: 8px;
}

/* V5 画师串差异提醒:警示色,与常规说明区分开 */
.art-hint-warn {
  color: var(--bbi-warning);
}
/* 画师串与下方质量词/负面词的分界 */
.art-divider {
  border: 0;
  border-top: 1px dashed var(--bbi-line);
  margin: 12px 0;
}
/* 绑定列表与上方画师串编辑区拉开一点;「已被画师串覆盖」用警示色——渠道值正被覆盖,
   用户在渠道行改了却不生效,需要一眼看出原因 */
.art-bound-list {
  margin-top: 10px;
}
.bbi-prompt-state.is-shadowed {
  color: var(--bbi-warning);
  background: transparent;
}

/* —— 画师串导入预览列表 —— */
.art-import-list {
  list-style: none;
  margin: 10px 0 4px;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.art-import-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 8px;
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
}
.art-import-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.art-import-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}
.art-import-fields {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.art-import-line {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.75;
}
.art-import-key {
  opacity: 0.55;
  margin-right: 6px;
}
.art-import-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: var(--bbi-radius-pill);
  background: var(--bbi-accent-soft);
  color: var(--bbi-accent);
  white-space: nowrap;
}
.art-import-badge.is-skip {
  background: var(--bbi-line);
  color: var(--bbi-ink-muted);
}
.art-import-badge.is-overwrite {
  background: var(--bbi-warning-soft);
  color: var(--bbi-warning);
}
.art-import-badge.is-active {
  background: var(--bbi-accent);
  color: var(--bbi-accent-ink);
}
.art-import-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 13px;
  cursor: pointer;
}
.art-import-switch code {
  font-size: 12px;
  background: var(--bbi-surface-2);
  border-radius: 4px;
  padding: 0 4px;
}

/* 操作按钮基类:.bbi-icon-btn 只在 App.vue 的 scoped 块里声明,此处补一份
   (与 ComfyUIPanel 同款处理;漏了会渲染成浏览器原生按钮,shadow DOM 里也拿不到 ST 样式) */
.bbi-icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
  color: var(--bbi-ink-soft);
  cursor: pointer;
  font-size: 15px;
  transition:
    color var(--bbi-dur) var(--bbi-ease),
    background var(--bbi-dur) var(--bbi-ease);
}
.bbi-icon-btn:hover {
  color: var(--bbi-ink);
  background: var(--bbi-line-strong);
}

/* —— 质量词/负面词列表行 + 弹窗:样式随设置页「自定义提示词」,scoped 不跨组件故补一份 —— */
.bbi-prompt-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 整行可点进弹窗编辑(状态药丸 .bbi-prompt-state 在 base.css 全局,无需补) */
.bbi-prompt-open {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius);
  background: var(--bbi-surface-2);
  color: var(--bbi-ink);
  font-family: var(--bbi-font-sans);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--bbi-dur) var(--bbi-ease),
    background var(--bbi-dur) var(--bbi-ease);
}
.bbi-prompt-open:hover {
  border-color: var(--bbi-accent);
  background: var(--bbi-surface);
}
.bbi-prompt-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}
.bbi-prompt-edit {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--bbi-ink-muted);
}
.bbi-prompt-open:hover .bbi-prompt-edit {
  color: var(--bbi-accent);
}
/* 弹窗:更宽 + 大文本框 */
.bbi-modal-wide {
  max-width: 680px;
}
.bbi-prompt-area {
  line-height: 1.6;
  font-size: 12.5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
}
/* 把「恢复默认」推到最左(本文件的迁移弹窗此前裸用过此类名,靠 foot 的 flex-end 蒙对) */
.bbi-modal-foot-spacer {
  flex: 1 1 auto;
}
/* 危险按钮:与设置页/ConfirmDialog 同一份口径。base 规则不能只写 :hover ——
   scoped 不跨组件、base.css 里也没有,只写 hover 的话平时是默认墨色,鼠标一过才变红。 */
.bbi-btn-danger {
  color: var(--bbi-danger);
  border-color: var(--bbi-line-strong);
}
.bbi-btn-danger:hover {
  color: var(--bbi-danger);
  border-color: var(--bbi-danger);
  background: var(--bbi-danger-soft);
}

.migrate-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vibe-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.vibe-normalize {
  margin-left: auto;
}
.bbi-check-state { font-size: 11px; color: var(--bbi-ink-muted); white-space: nowrap; }
.bbi-check-state.is-on { color: var(--bbi-accent); }
.is-muted { opacity: .5; }
.vibe-item {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--bbi-border, rgba(127, 127, 127, 0.2));
}
.vibe-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  flex: 0 0 auto;
}
.vibe-thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(127, 127, 127, 0.12);
  color: var(--bbi-ink-muted);
}
.vibe-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.vibe-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vibe-name {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 8px;
  font-size: 13px;
}
.vibe-enable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--bbi-ink-muted);
  white-space: nowrap;
}
.vibe-strength {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vibe-strength-label {
  font-size: 12px;
  color: var(--bbi-ink-muted);
  white-space: nowrap;
}
.vibe-strength input[type='range'] {
  flex: 1 1 auto;
  min-width: 0;
  /* .bbi-range 的 margin 是给「整行占一栏」的设置页留的,这里在同一行里要压掉 */
  margin: 0;
}
/* 数字框窄一档:四位小数够用,再宽就把滑块挤没了 */
.vibe-strength-num {
  flex: 0 0 auto;
  width: 68px;
  padding: 4px 6px;
  font-size: 12px;
  text-align: right;
  -moz-appearance: textfield;
  appearance: textfield;
}
/* step="any" 下浏览器仍画上下箭头,但规范让 stepUp/stepDown 直接抛错 → 按了没反应。
   摆一对点不动的箭头不如不摆;要微调用左边滑块(方向键 0.01 一档)。 */
.vibe-strength-num::-webkit-inner-spin-button,
.vibe-strength-num::-webkit-outer-spin-button {
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
}
.vibe-ops {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.vibe-missing {
  font-size: 12px;
  color: #c44747;
}

/* —— 分组 —— */
/* 工具条:搜索框吃满,计数与「整理分组」靠右。长列表口径与设置页排除弹窗一致
   (搜索 + 子串匹配收敛渲染量),故不做分页——vibe 靠缩略图认人,翻页只会
   把「我那张图在第几页」变成新的记忆负担。 */
.vibe-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.vibe-search {
  flex: 1 1 160px;
  min-width: 0;
  padding: 6px 10px;
  font-size: 13px;
}
.vibe-count {
  font-size: 12px;
  color: var(--bbi-ink-muted);
  white-space: nowrap;
}
/* 组头:整块浅底,把「组」和组内条目在视觉上分层;粘顶让长组滚动时组名不丢 */
.vibe-group {
  margin-top: 10px;
}
.vibe-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
}
/* 组名区整体可点(折叠):按钮撑满剩余宽度,点空白处也能收起 */
.vibe-group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--bbi-ink);
  font-family: var(--bbi-font-sans);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.vibe-group-chevron {
  flex: 0 0 auto;
  color: var(--bbi-ink-muted);
  transition: transform var(--bbi-dur) var(--bbi-ease);
}
/* 展开态朝下(与 Collapsible 同口径:收起时回到未旋转的朝右/朝上) */
.vibe-group-chevron.is-collapsed {
  transform: rotate(-90deg);
}
.vibe-group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vibe-group-meta {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 400;
  color: var(--bbi-ink-muted);
  font-variant-numeric: tabular-nums;
}
/* 「生效中」复用状态药丸基样式,上色口径与 wf-state.is-ok 一致 */
.vibe-group-active {
  color: var(--bbi-accent);
  background: var(--bbi-accent-soft);
  border-color: transparent;
}
.vibe-group-ops {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
/* 组内条目左缩进一格,读得出层级 */
.vibe-group-body {
  padding-left: 10px;
}
/* 组头本身就是一条分界,组内首条不再画上边线(否则紧贴组头是两道线) */
.vibe-group-body > .vibe-item:first-child {
  border-top: 0;
}
.vibe-group-select {
  width: 130px;
}
/* 组头操作里的小图标钮:.bbi-icon-mini 只在其它页的 scoped 块里声明,此处补一份 */
.bbi-icon-mini {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--bbi-line-strong);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface);
  color: var(--bbi-ink-soft);
  cursor: pointer;
  font-size: 12px;
}
.bbi-icon-mini:hover {
  color: var(--bbi-accent);
  border-color: var(--bbi-accent);
}
@media (max-width: 640px) {
  /* 窄屏:组头两行——组名一行,操作另起一行靠右,避免按钮把组名挤成一条缝 */
  .vibe-group-ops {
    width: 100%;
    justify-content: flex-end;
  }
  .vibe-group-body {
    padding-left: 0;
  }
  /* 同理:四个图标钮 + 标签会把画师串下拉挤成一条缝,标签独占首行,
     下拉与操作组同行分据两端 */
  .art-row {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: 8px;
  }
  .art-row > .bbi-field-label:first-child {
    grid-column: 1 / -1;
  }
  .art-row > .art-select {
    max-width: none;
  }
}
</style>
