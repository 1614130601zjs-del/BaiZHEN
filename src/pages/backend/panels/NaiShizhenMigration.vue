<script setup lang="ts">
import { computed, ref } from 'vue';
import { parseShizhenFullBackup } from '@/backends/shizhenBackupImport';
import {
  deleteVibeData,
  loadVibeData,
  saveVibeFiles,
  vibeFingerprint,
  vibeMetaFromData,
} from '@/backends/vibeStore';
import { vibeModelKey, BUILTIN_NAI_ARTISTS } from '@/backends/nai';
import { newNaiArtist, settings, type NaiArtistPreset, type NaiVibe } from '@/state/settings';
import { getContext } from '@/st/context';
import { makeCharacterBindingKey } from '@/backends/shizhenArtistProfiles';
import Icon from '@/components/Icon.vue';

const fileInput = ref<HTMLInputElement | null>(null);
const plan = ref<ReturnType<typeof parseShizhenFullBackup> | null>(null);
const fileName = ref('');
const error = ref('');
const busy = ref(false);
const summary = ref('');
const preview = computed(() => {
  const value = plan.value;
  if (!value) return null;
  const existingArtists = new Set([...BUILTIN_NAI_ARTISTS, ...settings.nai.artistPresets].map(signature));
  const newArtists = value.artists.filter(item => !existingArtists.has(signature(item))).length;
  const existingVibes = new Set(settings.nai.vibes.map(item => `${item.fingerprint}\\u0000${item.group}`));
  const seenVibes = new Set<string>();
  let duplicateVibes = 0;
  let newVibes = 0;
  for (const item of value.vibes) {
    const key = `${vibeFingerprint(item.data.encodings)}\\u0000${item.group}`;
    if (existingVibes.has(key) || seenVibes.has(key)) duplicateVibes++;
    else newVibes++;
    seenVibes.add(key);
  }
  return {
    artists: value.artists.length,
    newArtists,
    combos: value.combos.length,
    bindings: value.bindings.length,
    vibes: value.vibes.length,
    newVibes,
    groups: value.vibeGroups.length,
    duplicateVibes,
    unsupported: value.unsupportedVibes,
  };
});

function openFile() { fileInput.value?.click(); }

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  plan.value = null;
  error.value = '';
  summary.value = '';
  try {
    const parsed: unknown = JSON.parse(await file.text());
    plan.value = parseShizhenFullBackup(parsed, vibeModelKey(settings.nai.model));
    fileName.value = file.name;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function signature(item: Pick<NaiArtistPreset, 'name' | 'prompt' | 'quality' | 'negative'>) {
  return [item.name.trim(), item.prompt.trim(), item.quality.trim(), item.negative.trim()].join('\u0000');
}

async function importBackup() {
  const value = plan.value;
  if (!value || busy.value) return;
  busy.value = true;
  error.value = '';
  const saved: NaiVibe[] = [];
  const createdFiles: Array<{ dataPath: string; thumbnailPath: string }> = [];
  const originalArtists = settings.nai.artistPresets;
  const originalVibes = settings.nai.vibes;
  const originalProfiles = settings.nai.shizhenArtistProfiles;
  try {
    const artistBySourceIndex: string[] = [];
    const pendingArtists: NaiArtistPreset[] = [];
    const knownArtists = new Map([...BUILTIN_NAI_ARTISTS, ...settings.nai.artistPresets].map(item => [signature(item), item.id]));
    for (const item of value.artists) {
      const key = signature(item);
      let id = knownArtists.get(key);
      if (!id) {
        const preset = newNaiArtist(item.name);
        preset.prompt = item.prompt;
        preset.quality = item.quality;
        preset.negative = item.negative;
        pendingArtists.push(preset);
        id = preset.id;
        knownArtists.set(key, id);
      }
      artistBySourceIndex.push(id);
    }

    const knownVibes = new Set(settings.nai.vibes.map(item => `${item.fingerprint}\u0000${item.group}`));
    let duplicateVibes = 0;
    for (const item of value.vibes) {
      const fingerprint = vibeFingerprint(item.data.encodings);
      const key = `${fingerprint}\u0000${item.group}`;
      if (knownVibes.has(key)) { duplicateVibes++; continue; }
      const id = `vibe_shizhen_${Date.now()}_${saved.length}`;
      const paths = await saveVibeFiles(item.data, null, id);
      createdFiles.push(paths);
      const meta = vibeMetaFromData(id, item.name, paths.dataPath, paths.thumbnailPath, item.data, item.strength, false, item.group);
      saved.push(meta);
      knownVibes.add(key);
    }

    const currentProfiles = settings.nai.shizhenArtistProfiles;
    const profiles = {
      ...currentProfiles,
      combos: [...currentProfiles.combos],
      global: {
        body: { ...currentProfiles.global.body },
        statusBar: { ...currentProfiles.global.statusBar },
        egg: { ...currentProfiles.global.egg },
      },
      bindings: [...currentProfiles.bindings],
    };
    const comboBySourceIndex: string[] = [];
    for (const item of value.combos) {
      const artistId = item.artistIndex >= 0 ? artistBySourceIndex[item.artistIndex] || '' : '';
      const vibeGroup = item.vibeIndex >= 0 ? value.vibeGroups[item.vibeIndex] || '' : '';
      const existing = profiles.combos.find(combo =>
        combo.name === item.name && combo.artistId === artistId && (combo.vibeGroup || '') === vibeGroup && !combo.vibeId,
      );
      if (existing) { comboBySourceIndex.push(existing.id); continue; }
      const id = `nac_shizhen_${Date.now()}_${comboBySourceIndex.length}`;
      profiles.combos.push({ id, name: item.name, artistId, vibeId: '', vibeGroup, updatedAt: Date.now() });
      comboBySourceIndex.push(id);
    }

    const mapTarget = (target: { comboIndex: number; size: string }) => ({
      comboId: target.comboIndex >= 0 ? comboBySourceIndex[target.comboIndex] || '' : '',
      size: target.size,
    });
    const mergeTarget = (current: { comboId: string; size: string }, imported: { comboId: string; size: string }) => ({
      comboId: current.comboId || imported.comboId,
      size: current.size || imported.size,
    });
    for (const target of ['body', 'statusBar', 'egg'] as const) {
      profiles.global[target] = mergeTarget(profiles.global[target], mapTarget(value.global[target]));
    }

    let bindingAdded = 0, bindingSkipped = 0;
    for (const item of value.bindings) {
      const sourceIndex = item.characterIndex.trim() ? Number(item.characterIndex) : -1;
      const indexedCharacter = Number.isInteger(sourceIndex) && sourceIndex >= 0
        ? getContext()?.characters?.[sourceIndex]
        : undefined;
      const sourceCharacter = indexedCharacter && (!item.characterName.trim()
        || indexedCharacter.name?.trim() === item.characterName.trim()) ? indexedCharacter : undefined;
      const characterName = item.characterName.trim() || sourceCharacter?.name || '';
      const key = sourceCharacter
        ? makeCharacterBindingKey(sourceCharacter.avatar, sourceCharacter.name || characterName, sourceIndex)
        : characterName ? `name:${characterName}` : item.characterIndex ? `legacy-index:${item.characterIndex}` : '';
      if (!key) { bindingSkipped++; continue; }
      const exactExists = profiles.bindings.some(binding => binding.characterKey === key);
      const legacyNameExists = key.startsWith('avatar:') && profiles.bindings.some(binding =>
        (binding.characterKey.startsWith('name:') || binding.characterKey.startsWith('legacy-index:'))
        && !!characterName && binding.characterName.trim() === characterName.trim(),
      );
      if (exactExists || legacyNameExists) { bindingSkipped++; continue; }
      profiles.bindings.push({
        characterKey: key,
        characterName,
        body: mapTarget(item.body),
        statusBar: mapTarget(item.statusBar),
        egg: mapTarget(item.egg),
      });
      bindingAdded++;
    }

    settings.nai.artistPresets.push(...pendingArtists);
    settings.nai.vibes.push(...saved);
    settings.nai.shizhenArtistProfiles = profiles;
    summary.value = `导入完成：画师串映射 ${artistBySourceIndex.length} 条，Vibe 新增 ${saved.length} 条（重复跳过 ${duplicateVibes}），组合 ${comboBySourceIndex.length} 条，角色绑定新增 ${bindingAdded} 条（冲突跳过 ${bindingSkipped}）。新导入 Vibe 默认关闭。`;
    if (value.unsupportedVibes) summary.value += ` 未识别 Vibe：${value.unsupportedVibes} 条。`;
    plan.value = null;
    toastr.success('拾帧配置已合并；原有配置未被覆盖。', '拾帧迁移');
  } catch (cause) {
    settings.nai.artistPresets = originalArtists;
    settings.nai.vibes = originalVibes;
    settings.nai.shizhenArtistProfiles = originalProfiles;
    await Promise.all(createdFiles.map(paths => deleteVibeData(paths).catch(() => undefined)));
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function exportBackup() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const artists = [...BUILTIN_NAI_ARTISTS, ...settings.nai.artistPresets];
    const artistIndex = new Map(artists.map((item, index) => [item.id, index]));
    const groups = [...new Set([
      ...settings.nai.vibes.map(item => item.group.trim()).filter(Boolean),
      ...settings.nai.shizhenArtistProfiles.combos.map(item => item.vibeGroup?.trim()).filter((name): name is string => !!name),
    ])];
    const pool: Array<Record<string, unknown>> = [];
    const refsByGroup = new Map<string, Array<{ poolId: string; strength: number; informationExtracted?: number }>>();
    const refsUngrouped: Array<{ poolId: string; strength: number; informationExtracted?: number }> = [];
    const refByVibeId = new Map<string, { poolId: string; strength: number; informationExtracted?: number }>();
    for (const vibe of settings.nai.vibes) {
      const data = await loadVibeData(vibe);
      const poolId = vibe.id;
      const infoValues = Object.values(data.encodings).map(item => item.infoExtracted);
      const sharedInfo = infoValues.length && infoValues.every(value => value === infoValues[0]) ? infoValues[0] : undefined;
      const modelKeys = Object.keys(data.encodings);
      // Emit the canonical NovelAI Vibe Transfer envelope used by Shizhen's pool.
      // Keep each model's Information Extracted inside its own encoding; the pool-level
      // value is only a compatibility fallback when all model values are identical.
      pool.push({
        id: poolId, name: vibe.name, image: data.image, thumbnail: data.thumbnail,
        thumb: data.thumbnail,
        raw: {
          identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding',
          name: vibe.name,
          importInfo: {
            model: modelKeys[0] || '',
            strength: vibe.strength,
            ...(sharedInfo !== undefined ? { information_extracted: sharedInfo } : {}),
          },
          encodings: data.encodings,
          image: data.image,
        },
        strength: vibe.strength, ...(sharedInfo !== undefined ? { informationExtracted: sharedInfo } : {}),
      });
      const ref = { poolId, strength: vibe.strength, ...(sharedInfo !== undefined ? { informationExtracted: sharedInfo } : {}) };
      refByVibeId.set(vibe.id, ref);
      if (vibe.group.trim()) {
        const list = refsByGroup.get(vibe.group.trim()) || [];
        list.push(ref); refsByGroup.set(vibe.group.trim(), list);
      } else refsUngrouped.push(ref);
    }
    const groupNames = [...groups];
    if (refsUngrouped.length) groupNames.push('未分组');
    const sourceGroups = groupNames.map(name => ({
      id: `group_${name}`, name,
      refs: name === '未分组' ? refsUngrouped : refsByGroup.get(name) || [],
    }));
    const comboToIndex = new Map(settings.nai.shizhenArtistProfiles.combos.map((item, index) => [item.id, index]));
    const exportCombos = settings.nai.shizhenArtistProfiles.combos.map(item => {
      let vibeIndex = item.vibeGroup ? groupNames.indexOf(item.vibeGroup) : -1;
      if (vibeIndex < 0 && item.vibeId) {
        const selected = settings.nai.vibes.find(vibe => vibe.id === item.vibeId);
        if (selected) {
          const syntheticName = `单条 Vibe · ${selected.name}`;
          let syntheticIndex = groupNames.indexOf(syntheticName);
          if (syntheticIndex < 0) {
            syntheticIndex = groupNames.length;
            groupNames.push(syntheticName);
            sourceGroups.push({ id: `group_${syntheticIndex}`, name: syntheticName, refs: [refByVibeId.get(selected.id) || { poolId: selected.id, strength: selected.strength }] });
          }
          vibeIndex = syntheticIndex;
        }
      }
      return {
        name: item.name,
        artistIndex: artistIndex.get(item.artistId) ?? -1,
        vibeIndex,
      };
    });
    const exportTarget = (target: { comboId: string; size: string }) => ({
      comboIndex: target.comboId ? comboToIndex.get(target.comboId) ?? -1 : -1,
      size: target.size,
    });
    const hostCharacters = getContext()?.characters || [];
    const bindings = settings.nai.shizhenArtistProfiles.bindings.map(item => {
      const avatar = item.characterKey.startsWith('avatar:') ? item.characterKey.slice('avatar:'.length) : '';
      const legacyIndex = item.characterKey.startsWith('legacy-index:') ? item.characterKey.slice('legacy-index:'.length) : '';
      const currentIndex = hostCharacters.findIndex(character =>
        (avatar && character.avatar === avatar) || (!avatar && !!item.characterName && character.name === item.characterName),
      );
      return {
      characterKey: currentIndex >= 0 ? String(currentIndex) : legacyIndex,
      characterName: item.characterName,
      combinationIndex: exportTarget(item.body).comboIndex,
      bodySize: item.body.size,
      sbComboIndex: exportTarget(item.statusBar).comboIndex,
      sbSize: item.statusBar.size,
      eggComboIndex: exportTarget(item.egg).comboIndex,
      eggSize: item.egg.size,
    }; });
    const data = {
      presets: artists.map(item => ({ name: item.name, positive: item.prompt, negative: item.negative, quality: item.quality })),
      combinations: exportCombos,
      bindings,
      globalComboIndex: exportTarget(settings.nai.shizhenArtistProfiles.global.body).comboIndex,
      bodySize: settings.nai.shizhenArtistProfiles.global.body.size,
      sbComboIndex: exportTarget(settings.nai.shizhenArtistProfiles.global.statusBar).comboIndex,
      sbSize: settings.nai.shizhenArtistProfiles.global.statusBar.size,
      eggComboIndex: exportTarget(settings.nai.shizhenArtistProfiles.global.egg).comboIndex,
      eggSize: settings.nai.shizhenArtistProfiles.global.egg.size,
      vibePool: pool,
      vibes: sourceGroups,
    };
    const backup = { format: 'shizhen-lite-full-backup', version: 1, extension: '拾帧', exportedAt: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `baizhen-shizhen-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click(); URL.revokeObjectURL(url);
    summary.value = '已导出画师串、组合、角色绑定与 Vibe 池数据；未导出 API Key、聊天记录或影像缓存。';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="bbi-field shizhen-migration">
    <div class="bbi-field-head">
      <span class="bbi-field-label">从拾帧迁移</span>
      <button class="bbi-btn bbi-btn-sm" type="button" :disabled="busy" @click="exportBackup">
        <Icon name="download" :size="12" /> 导出柏宝绘兼容备份
      </button>
    </div>
    <p class="bbi-field-hint">从拾帧导出的完整设置备份导入。仅合并画师串、组合、角色绑定和 Vibe 数据，不覆盖柏宝绘原有设置，也不会导入拾帧 API Key、聊天记录或影像缓存。</p>
    <div class="shizhen-actions">
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="readFile" />
      <button class="bbi-btn" type="button" :disabled="busy" @click="openFile">
        <Icon name="upload" :size="12" /> 选择拾帧完整备份
      </button>
      <button class="bbi-btn bbi-btn-primary" type="button" :disabled="busy || !plan" @click="importBackup">
        {{ busy ? '处理中…' : '确认合并导入' }}
      </button>
    </div>
    <p v-if="fileName" class="bbi-field-hint">已读取：{{ fileName }}</p>
    <div v-if="preview" class="shizhen-preview">
      <strong>导入预览</strong>
      <div class="shizhen-preview-grid">
        <span>画师串：{{ preview.artists }}（预计新增 {{ preview.newArtists }}）</span>
        <span>组合：{{ preview.combos }}</span>
        <span>角色绑定：{{ preview.bindings }}</span>
        <span>Vibe：{{ preview.vibes }}（预计新增 {{ preview.newVibes }}，重复跳过 {{ preview.duplicateVibes }}）</span>
        <span>Vibe 分组：{{ preview.groups }}</span>
        <span>无法识别：{{ preview.unsupported }}</span>
      </div>
      <p class="bbi-field-hint">同名/同内容画师串与同组 Vibe 会去重；已有角色绑定和非空通用配置不会被覆盖。导入过程失败会清理本次新写入的 Vibe 文件。</p>
    </div>
    <p v-if="summary" class="bbi-field-hint">{{ summary }}</p>
    <p v-if="error" class="bbi-field-hint shizhen-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.shizhen-migration { display: grid; gap: 10px; margin-top: 14px; padding: 12px; border: 1px solid var(--bbi-border); border-radius: 10px; }
.shizhen-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.shizhen-preview { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--bbi-border); border-radius: 8px; }
.shizhen-preview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; font-size: 12px; }
.shizhen-error { color: var(--SmartThemeEmColor, #c45); }
@media (max-width: 520px) { .shizhen-preview-grid { grid-template-columns: 1fr; } }
</style>
