<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { removeArtistCombo } from '@/backends/shizhenArtistProfiles';
import Collapsible from '@/components/Collapsible.vue';
import Icon from '@/components/Icon.vue';
import {
  BUILTIN_NAI_ARTISTS,
} from '@/backends/nai';
import { getContext } from '@/st/context';
import {
  newNaiArtist,
  settings,
  type NaiArtistCombo,
  type NaiArtistTargetConfig,
} from '@/state/settings';

const profiles = computed(() => settings.nai.shizhenArtistProfiles);
const targetTypes = ['body', 'statusBar', 'egg'] as const;
const artistOptions = computed(() => [
  { value: '', label: '不使用画师串' },
  ...BUILTIN_NAI_ARTISTS.map(item => ({ value: item.id, label: `${item.name}（内置）` })),
  ...settings.nai.artistPresets.map(item => ({ value: item.id, label: item.name || '未命名画师串' })),
]);
const vibeOptions = computed(() => [
  { value: '', label: '不使用 Vibe' },
  ...settings.nai.vibes.map(item => ({ value: item.id, label: item.name || '未命名 Vibe' })),
]);
const vibeGroupOptions = computed(() => [...new Set(settings.nai.vibes.map(item => item.group.trim()).filter(Boolean))]);
const comboOptions = computed(() => [
  { value: '', label: '跟随通用预设' },
  ...profiles.value.combos.map(item => ({ value: item.id, label: item.name || '未命名组合' })),
]);

const editingId = ref('');
const comboName = ref('');
const comboArtistId = ref('');
const comboVibeId = ref('');
const comboVibeGroup = ref('');
const characterKey = ref('');
const characterName = ref('');
const targetDraft = ref({
  body: { comboId: '', size: '' } as NaiArtistTargetConfig,
  statusBar: { comboId: '', size: '' } as NaiArtistTargetConfig,
  egg: { comboId: '', size: '' } as NaiArtistTargetConfig,
});

const characters = computed(() => {
  const context = getContext() as { characters?: Array<{ name?: string; avatar?: string }> ; characterId?: number; name2?: string } | undefined;
  const hostCharacters = (window as Window & { characters?: Array<{ name?: string; avatar?: string }> }).characters;
  const list = Array.isArray(context?.characters) && context.characters.length
    ? context.characters
    : Array.isArray(hostCharacters) ? hostCharacters : [];
  return list.map((item, index) => ({
    key: item.avatar ? `avatar:${item.avatar}` : item.name ? `name:${item.name}` : `legacy-index:${index}`,
    name: item.name || item.avatar || `角色 ${index + 1}`,
  }));
});

const sizeOptions = [
  { value: '', label: '跟随取景区/正文' },
  { value: '832x1216', label: '竖版 · 832 × 1216' },
  { value: '768x1344', label: '长竖版 · 768 × 1344' },
  { value: '1024x1024', label: '正方形 · 1024 × 1024' },
  { value: '1216x832', label: '横版 · 1216 × 832' },
  { value: '1344x768', label: '宽横版 · 1344 × 768' },
];

function beginNewCombo() {
  editingId.value = '';
  comboName.value = '';
  comboArtistId.value = '';
  comboVibeId.value = '';
  comboVibeGroup.value = '';
}

function editCombo(combo: NaiArtistCombo) {
  editingId.value = combo.id;
  comboName.value = combo.name;
  comboArtistId.value = combo.artistId;
  comboVibeId.value = combo.vibeId;
  comboVibeGroup.value = combo.vibeGroup || '';
}

function saveCombo() {
  const name = comboName.value.trim();
  if (!name) {
    toastr.warning('请填写组合名称', '画师串组合');
    return;
  }
  const existing = profiles.value.combos.find(item => item.id === editingId.value);
  const combo: NaiArtistCombo = {
    id: existing?.id || `nac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    artistId: comboArtistId.value,
    vibeId: comboVibeGroup.value ? '' : comboVibeId.value,
    vibeGroup: comboVibeGroup.value,
    updatedAt: Date.now(),
  };
  if (existing) Object.assign(existing, combo);
  else profiles.value.combos.unshift(combo);
  beginNewCombo();
}

function deleteCombo(id: string) {
  Object.assign(profiles.value, removeArtistCombo(profiles.value, id));
  if (editingId.value === id) beginNewCombo();
}

function loadCharacterBinding(key: string) {
  characterKey.value = key;
  const character = characters.value.find(item => item.key === key);
  characterName.value = character?.name || '';
  const binding = profiles.value.bindings.find(item => item.characterKey === key)
    ?? profiles.value.bindings.find(item => !!character?.name && item.characterName.trim() === character.name.trim());
  targetDraft.value = binding
    ? {
        body: { ...binding.body },
        statusBar: { ...binding.statusBar },
        egg: { ...binding.egg },
      }
    : {
        body: { comboId: '', size: '' },
        statusBar: { comboId: '', size: '' },
        egg: { comboId: '', size: '' },
      };
}

function saveCharacterBinding() {
  if (!characterKey.value) {
    toastr.warning('请先选择角色卡', '角色卡绑定');
    return;
  }
  const next = {
    characterKey: characterKey.value,
    characterName: characterName.value,
    body: { ...targetDraft.value.body },
    statusBar: { ...targetDraft.value.statusBar },
    egg: { ...targetDraft.value.egg },
  };
  const index = profiles.value.bindings.findIndex(item => item.characterKey === next.characterKey || (!!next.characterName && item.characterName.trim() === next.characterName.trim()));
  if (index >= 0) profiles.value.bindings.splice(index, 1, next);
  else profiles.value.bindings.push(next);
  toastr.success(`已保存「${characterName.value}」的组合绑定`, '角色卡绑定');
}

function deleteCharacterBinding(key: string) {
  profiles.value.bindings = profiles.value.bindings.filter(item => item.characterKey !== key);
  if (characterKey.value === key) loadCharacterBinding(key);
}

watch(characters, list => {
  if (!characterKey.value && list.length) {
    const context = getContext() as { characterId?: number } | undefined;
    const current = Number(context?.characterId);
    loadCharacterBinding(list[current]?.key || list[0].key);
  }
}, { immediate: true });

const globalTargets = computed(() => profiles.value.global);
</script>

<template>
  <Collapsible title="拾帧式预设组合与角色绑定" :open="false">
    <div class="bbi-field">
      <div class="bbi-field-head">
        <span class="bbi-field-label">预设组合</span>
        <button class="bbi-btn bbi-btn-sm bbi-btn-primary" type="button" @click="beginNewCombo">
          <Icon name="plus" :size="12" /> 新建组合
        </button>
      </div>
      <div class="sap-editor">
        <input v-model="comboName" class="bbi-input" placeholder="组合名称，例如：柔和画风 + 氛围参考" />
        <div class="sap-pair">
          <label class="bbi-field">
            <span class="bbi-field-label">画师串</span>
            <select v-model="comboArtistId" class="bbi-input">
              <option v-for="item in artistOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label class="bbi-field">
            <span class="bbi-field-label">单条 Vibe</span>
            <select v-model="comboVibeId" class="bbi-input">
              <option v-for="item in vibeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label class="bbi-field">
            <span class="bbi-field-label">Vibe 分组（拾帧组合）</span>
            <select v-model="comboVibeGroup" class="bbi-input">
              <option value="">不使用分组</option>
              <option v-for="name in vibeGroupOptions" :key="name" :value="name">{{ name }}</option>
            </select>
          </label>
        </div>
        <div class="sap-actions">
          <button class="bbi-btn bbi-btn-primary" type="button" @click="saveCombo">{{ editingId ? '保存修改' : '保存组合' }}</button>
          <button class="bbi-btn" type="button" @click="beginNewCombo">清空</button>
        </div>
      </div>
      <div v-if="profiles.combos.length" class="sap-list">
        <div v-for="combo in profiles.combos" :key="combo.id" class="sap-row">
          <div class="sap-info">
            <strong>{{ combo.name }}</strong>
            <span>{{ artistOptions.find(item => item.value === combo.artistId)?.label || '不使用画师串' }} · {{ combo.vibeGroup || vibeOptions.find(item => item.value === combo.vibeId)?.label || '不使用 Vibe' }}</span>
          </div>
          <button class="bbi-btn bbi-btn-sm" type="button" @click="editCombo(combo)">编辑</button>
          <button class="bbi-btn bbi-btn-sm am-btn-danger" type="button" @click="deleteCombo(combo.id)">删除</button>
        </div>
      </div>
      <p v-else class="bbi-field-hint">还没有组合。画师串和 Vibe 可以单独使用，也可以组合在一起。</p>
    </div>

    <div class="sap-section">
      <div class="bbi-field-head"><span class="bbi-field-label">通用预设</span></div>
      <p class="bbi-field-hint">角色卡没有单独绑定时使用这里。状态栏和彩蛋留空时跟随正文；不会修改原生画师串的当前选择。</p>
      <div v-for="target in targetTypes" :key="target" class="sap-target">
        <strong>{{ target === 'body' ? '正文' : target === 'statusBar' ? '状态栏' : '彩蛋' }}</strong>
        <select v-model="globalTargets[target].comboId" class="bbi-input">
          <option v-for="item in comboOptions" :key="item.value" :value="item.value">{{ target === 'body' && !item.value ? '不使用组合' : item.label }}</option>
        </select>
        <select v-model="globalTargets[target].size" class="bbi-input">
          <option v-for="item in sizeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
    </div>

    <div class="sap-section">
      <div class="bbi-field-head"><span class="bbi-field-label">角色卡绑定</span></div>
      <p class="bbi-field-hint">绑定按角色卡头像文件名识别，避免单纯依赖角色列表序号。各目标可分别指定组合和尺寸。</p>
      <select class="bbi-input" :value="characterKey" @change="loadCharacterBinding(($event.target as HTMLSelectElement).value)">
        <option value="">选择角色卡</option>
        <option v-for="item in characters" :key="item.key" :value="item.key">{{ item.name }}</option>
      </select>
      <div v-for="target in (['body', 'statusBar', 'egg'] as const)" :key="target" class="sap-target">
        <strong>{{ target === 'body' ? '正文' : target === 'statusBar' ? '状态栏' : '彩蛋' }}</strong>
        <select v-model="targetDraft[target].comboId" class="bbi-input">
          <option v-for="item in comboOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <select v-model="targetDraft[target].size" class="bbi-input">
          <option v-for="item in sizeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
      <div class="sap-actions">
        <button class="bbi-btn bbi-btn-primary" type="button" :disabled="!characterKey" @click="saveCharacterBinding">保存角色卡绑定</button>
      </div>
      <div v-if="profiles.bindings.length" class="sap-list">
        <div v-for="binding in profiles.bindings" :key="binding.characterKey" class="sap-row">
          <div class="sap-info"><strong>{{ binding.characterName || binding.characterKey }}</strong><span>独立组合与尺寸配置</span></div>
          <button class="bbi-btn bbi-btn-sm" type="button" @click="loadCharacterBinding(binding.characterKey)">编辑</button>
          <button class="bbi-btn bbi-btn-sm am-btn-danger" type="button" @click="deleteCharacterBinding(binding.characterKey)">删除</button>
        </div>
      </div>
    </div>
  </Collapsible>
</template>

<style scoped>
.sap-editor { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--bbi-border); border-radius: 10px; }
.sap-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.sap-pair .bbi-field { margin: 0; }
.sap-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.sap-list { display: grid; gap: 8px; margin-top: 12px; }
.sap-row { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid var(--bbi-border); border-radius: 9px; }
.sap-info { display: grid; gap: 3px; min-width: 0; flex: 1; }
.sap-info strong { overflow-wrap: anywhere; }
.sap-info span { color: var(--SmartThemeQuoteColor, var(--bbi-muted)); font-size: 12px; }
.sap-section { display: grid; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--bbi-border); }
.sap-target { display: grid; grid-template-columns: 70px minmax(0, 1fr) minmax(0, 1fr); gap: 8px; align-items: center; }
.sap-target strong { font-size: 13px; }
@media (max-width: 560px) {
  .sap-pair { grid-template-columns: 1fr; }
  .sap-target { grid-template-columns: 1fr 1fr; }
  .sap-target strong { grid-column: 1 / -1; }
  .sap-row { flex-wrap: wrap; }
}
</style>
