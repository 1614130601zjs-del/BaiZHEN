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
import { newNaiArtist, settings, type NaiArtistPreset, type NaiVibe, type NaiVibePoolItem } from '@/state/settings';
import { getContext } from '@/st/context';
import { makeCharacterBindingKey } from '@/backends/shizhenArtistProfiles';
import Icon from '@/components/Icon.vue';

const fileInput = ref<HTMLInputElement | null>(null);
const plan = ref<ReturnType<typeof parseShizhenFullBackup> | null>(null);
const fileName = ref('');
const error = ref('');
const busy = ref(false);
const summary = ref('');
const existingVibeKeys = ref<Set<string>>(new Set());
const preview = computed(() => {
  const value = plan.value;
  if (!value) return null;
  const existingArtists = new Set([...BUILTIN_NAI_ARTISTS, ...settings.nai.artistPresets].map(signature));
  const newArtists = value.artists.filter(item => !existingArtists.has(signature(item))).length;
  const uniqueResources = new Map<string, (typeof value.vibes)[number]>();
  for (const item of value.vibes) {
    const key = item.sourcePoolId || vibeFingerprint(item.data.encodings);
    if (!uniqueResources.has(key)) uniqueResources.set(key, item);
  }
  const seenFingerprints = new Set<string>();
  let duplicateVibes = 0;
  let newVibes = 0;
  for (const item of uniqueResources.values()) {
    const fingerprint = vibeFingerprint(item.data.encodings);
    if (existingVibeKeys.value.has(fingerprint) || seenFingerprints.has(fingerprint)) duplicateVibes++;
    else newVibes++;
    seenFingerprints.add(fingerprint);
  }
  return {
    artists: value.artists.length,
    newArtists,
    combos: value.combos.length,
    bindings: value.bindings.length,
    vibes: uniqueResources.size,
    references: value.vibes.length,
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
  existingVibeKeys.value = new Set();
  error.value = '';
  summary.value = '';
  try {
    const parsed: unknown = JSON.parse(await file.text());
    plan.value = parseShizhenFullBackup(parsed, vibeModelKey(settings.nai.model));
    const separator = String.fromCharCode(0);
    const keys = new Set<string>();
    const resources = [...settings.nai.vibePool];
    for (const legacy of settings.nai.vibes) {
      if (!resources.some(item => item.id === legacy.id)) {
        const { strength: _strength, enabled: _enabled, group: _group, ...resource } = legacy;
        resources.push(resource);
      }
    }
    await Promise.all(resources.map(async existing => {
      let fingerprint = existing.fingerprint;
      try {
        fingerprint = vibeFingerprint((await loadVibeData(existing)).encodings);
      } catch {
        // Preserve a fallback for legacy entries whose payload cannot currently be read.
      }
      keys.add(fingerprint);
    }));
    existingVibeKeys.value = keys;
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
  const savedPool: NaiVibePoolItem[] = [];
  const createdFiles: Array<{ dataPath: string; thumbnailPath: string }> = [];
  const originalArtists = settings.nai.artistPresets;
  const originalVibes = settings.nai.vibes;
  const originalPool = settings.nai.vibePool;
  const originalGroups = settings.nai.vibeGroups;
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

    const pool = [...originalPool];
    const groups = originalGroups.map(group => ({ ...group, refs: [...group.refs] }));
    const sourceToPoolId = new Map<string, string>();
    const fingerprintToPoolId = new Map<string, string>();
    for (const resource of pool) {
      try { fingerprintToPoolId.set(vibeFingerprint((await loadVibeData(resource)).encodings), resource.id); }
      catch { if (resource.fingerprint) fingerprintToPoolId.set(resource.fingerprint, resource.id); }
    }
    for (const existing of originalVibes) {
      if (!pool.some(resource => resource.id === existing.id)) {
        const { strength: _strength, enabled: _enabled, group: _group, ...resource } = existing;
        pool.push(resource);
      }
    }
    let duplicateVibes = 0;
    for (const item of value.vibes) {
      const fingerprint = vibeFingerprint(item.data.encodings);
      const sourceKey = item.sourcePoolId || `legacy:${item.group}:${item.name}:${fingerprint}`;
      let poolId: string = sourceToPoolId.get(sourceKey) || fingerprintToPoolId.get(fingerprint) || '';
      let resource = pool.find(candidate => candidate.id === poolId);
      if (!resource) {
        poolId = `vibe_shizhen_${Date.now()}_${savedPool.length}`;
        const paths = await saveVibeFiles(item.data, null, poolId);
        createdFiles.push(paths);
        const meta = vibeMetaFromData(poolId, item.name, paths.dataPath, paths.thumbnailPath, item.data, item.strength, false, '');
        const { strength: _strength, enabled: _enabled, group: _group, ...poolMeta } = meta;
        resource = poolMeta;
        pool.push(resource);
        savedPool.push(resource);
        saved.push({ ...meta, group: '' });
        fingerprintToPoolId.set(fingerprint, poolId);
      } else {
        duplicateVibes++;
        if (!saved.some(vibe => vibe.id === poolId) && !originalVibes.some(vibe => vibe.id === poolId)) {
          saved.push({ ...resource, strength: item.strength, enabled: false, group: '' });
        }
      }
      sourceToPoolId.set(sourceKey, poolId);
      if (!saved.some(vibe => vibe.id === poolId) && !originalVibes.some(vibe => vibe.id === poolId)) {
        saved.push({ ...resource, strength: item.strength, enabled: false, group: '' });
      }
      if (item.group.trim()) {
        let group = groups.find(candidate => candidate.name === item.group.trim());
        if (!group) {
          group = { id: `vibe_group_shizhen_${Date.now()}_${groups.length}`, name: item.group.trim(), refs: [] };
          groups.push(group);
        }
        const existingRef = group.refs.find(ref => ref.poolId === poolId);
        if (!existingRef) {
          group.refs.push({
            poolId,
            strength: item.strength,
            enabled: false,
            ...(item.informationExtracted !== undefined ? { informationExtracted: item.informationExtracted } : {}),
          });
        }
      }
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
      const hostCharacters = getContext()?.characters ?? [];
      const sameNameCount = characterName
        ? hostCharacters.filter(character => character.name?.trim() === characterName).length
        : 0;
      // Shizhen exports positional indexes, not stable avatar IDs. If names are duplicated,
      // the old index may now point at a different card with the same display name.
      // Without an exported avatar identity, skip the binding rather than attach it incorrectly.
      const ambiguousName = sameNameCount > 1;
      const key = ambiguousName ? ''
        : sourceCharacter
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

    // Replace arrays atomically: the original references are rollback snapshots.
    settings.nai.artistPresets = [...originalArtists, ...pendingArtists];
    settings.nai.vibes = [...originalVibes, ...saved];
    settings.nai.vibePool = pool;
    settings.nai.vibeGroups = groups;
    settings.nai.shizhenArtistProfiles = profiles;
    summary.value = `导入完成：画师串映射 ${artistBySourceIndex.length} 条，Vibe 池新增 ${savedPool.length} 条（复用/重复 ${duplicateVibes} 条），组合 ${comboBySourceIndex.length} 条，角色绑定新增 ${bindingAdded} 条（冲突跳过 ${bindingSkipped}）。新导入 Vibe 默认关闭。`;
    if (value.unsupportedVibes) summary.value += ` 未识别 Vibe：${value.unsupportedVibes} 条。`;
    plan.value = null;
    toastr.success('拾帧配置已合并；原有配置未被覆盖。', '拾帧迁移');
  } catch (cause) {
    settings.nai.artistPresets = originalArtists;
    settings.nai.vibes = originalVibes;
    settings.nai.vibePool = originalPool;
    settings.nai.vibeGroups = originalGroups;
    settings.nai.shizhenArtistProfiles = originalProfiles;
    const cleanupResults = await Promise.allSettled(createdFiles.map(paths => deleteVibeData(paths)));
    const failedCleanup = cleanupResults
      .map((result, index) => ({ result, paths: createdFiles[index] }))
      .filter((item): item is { result: PromiseRejectedResult; paths: { dataPath: string; thumbnailPath: string } } =>
        item.result.status === 'rejected',
      );
    const reason = cause instanceof Error ? cause.message : String(cause);
    error.value = failedCleanup.length
      ? `${reason}；另外有 ${failedCleanup.length} 组新建 Vibe 文件未能自动清理，请检查存储：${failedCleanup.flatMap(item => [item.paths.dataPath, item.paths.thumbnailPath]).join('、')}`
      : reason;
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
    const legacyVibes = settings.nai.vibes;
    const poolItems = [...settings.nai.vibePool];
    for (const legacy of legacyVibes) {
      if (!poolItems.some(item => item.id === legacy.id)) {
        const { strength: _strength, enabled: _enabled, group: _group, ...resource } = legacy;
        poolItems.push(resource);
      }
    }
    const groups = settings.nai.vibeGroups;
    const groupNames = [...new Set([
      ...groups.map(group => group.name.trim()).filter(Boolean),
      ...legacyVibes.map(item => item.group.trim()).filter(Boolean),
      ...settings.nai.shizhenArtistProfiles.combos.map(item => item.vibeGroup?.trim()).filter((name): name is string => !!name),
    ])];
    const pool: Array<Record<string, unknown>> = [];
    const refsByGroup = new Map<string, Array<{ poolId: string; strength: number; informationExtracted?: number }>>();
    const refsUngrouped: Array<{ poolId: string; strength: number; informationExtracted?: number }> = [];
    const refByVibeId = new Map<string, { poolId: string; strength: number; informationExtracted?: number }>();
    const refsByPoolId = new Map<string, Array<{ group: string; strength: number; informationExtracted?: number }>>();
    for (const group of groups) {
      const refs = refsByGroup.get(group.name) || [];
      for (const ref of group.refs) {
        refs.push({ poolId: ref.poolId, strength: ref.strength, ...(ref.informationExtracted !== undefined ? { informationExtracted: ref.informationExtracted } : {}) });
        const existing = refsByPoolId.get(ref.poolId) || [];
        existing.push({ group: group.name, strength: ref.strength, ...(ref.informationExtracted !== undefined ? { informationExtracted: ref.informationExtracted } : {}) });
        refsByPoolId.set(ref.poolId, existing);
      }
      refsByGroup.set(group.name, refs);
    }
    for (const legacy of legacyVibes) {
      const existingRefs = refsByPoolId.get(legacy.id) || [];
      if (legacy.group.trim() && !existingRefs.some(ref => ref.group === legacy.group.trim())) {
        const refs = refsByGroup.get(legacy.group.trim()) || [];
        const legacyRef = { poolId: legacy.id, strength: legacy.strength, ...(legacy.informationExtracted !== undefined ? { informationExtracted: legacy.informationExtracted } : {}) };
        refs.push(legacyRef); refsByGroup.set(legacy.group.trim(), refs);
        existingRefs.push({ group: legacy.group.trim(), strength: legacy.strength, ...(legacy.informationExtracted !== undefined ? { informationExtracted: legacy.informationExtracted } : {}) });
        refsByPoolId.set(legacy.id, existingRefs);
      }
    }
    for (const vibe of poolItems) {
      const data = await loadVibeData(vibe);
      const modelKeys = Object.keys(data.encodings);
      if (!modelKeys.length || !Object.values(data.encodings).some(item =>
        typeof item.encoding === 'string' && item.encoding.trim().length > 0,
      )) {
        throw new Error(`Vibe「${vibe.name}」缺少有效编码，无法导出为拾帧兼容格式。`);
      }
      const infoValues = Object.values(data.encodings).map(item => item.infoExtracted);
      const sharedInfo = infoValues.length > 0 && infoValues.every(value => value === infoValues[0])
        ? infoValues[0]
        : undefined;
      const references = refsByPoolId.get(vibe.id) || [];
      const legacy = legacyVibes.find(item => item.id === vibe.id);
      const defaultStrength = references[0]?.strength ?? legacy?.strength ?? 0.6;
      pool.push({
        id: vibe.id, name: vibe.name, image: data.image, thumbnail: data.thumbnail,
        thumb: data.thumbnail,
        raw: {
          identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding',
          name: vibe.name,
          importInfo: {
            model: modelKeys[0] || '',
            strength: defaultStrength,
            ...(sharedInfo !== undefined ? { information_extracted: sharedInfo } : {}),
          },
          encodings: data.encodings,
          image: data.image,
        },
        strength: defaultStrength, ...(sharedInfo !== undefined ? { informationExtracted: sharedInfo } : {}),
      });
      const firstRef = references[0] || { strength: defaultStrength };
      refByVibeId.set(vibe.id, {
        poolId: vibe.id,
        strength: firstRef.strength,
        ...(firstRef.informationExtracted !== undefined ? { informationExtracted: firstRef.informationExtracted } : {}),
      });
      if (!references.length) refsUngrouped.push({ poolId: vibe.id, strength: defaultStrength, ...((legacy?.informationExtracted ?? vibe.informationExtracted) !== undefined ? { informationExtracted: legacy?.informationExtracted ?? vibe.informationExtracted } : {}) });
    }
    const groupNamesWithUngrouped = [...groupNames];
    let ungroupedName = '';
    if (refsUngrouped.length) {
      ungroupedName = '未分组';
      while (groupNamesWithUngrouped.includes(ungroupedName)) ungroupedName = `${ungroupedName}（导出）`;
      groupNamesWithUngrouped.push(ungroupedName);
    }
    const sourceGroups = groupNamesWithUngrouped.map(name => ({
      id: `group_${name}`, name,
      refs: name === ungroupedName ? refsUngrouped : refsByGroup.get(name) || [],
    }));
    const comboToIndex = new Map(settings.nai.shizhenArtistProfiles.combos.map((item, index) => [item.id, index]));
    const exportCombos = settings.nai.shizhenArtistProfiles.combos.map(item => {
      let vibeIndex = item.vibeGroup ? groupNamesWithUngrouped.indexOf(item.vibeGroup) : -1;
      if (vibeIndex < 0 && item.vibeId) {
        const selected = legacyVibes.find(vibe => vibe.id === item.vibeId);
        const selectedResource = selected || poolItems.find(vibe => vibe.id === item.vibeId);
        if (selectedResource) {
          const baseName = `单条 Vibe · ${selectedResource.name}`;
          let syntheticName = baseName;
          let suffix = 2;
          while (groupNamesWithUngrouped.includes(syntheticName)) syntheticName = `${baseName}（${suffix++}）`;
          const syntheticIndex = groupNamesWithUngrouped.length;
          groupNamesWithUngrouped.push(syntheticName);
          sourceGroups.push({
            id: `group_${syntheticIndex}`,
            name: syntheticName,
            refs: [refByVibeId.get(selectedResource.id) || { poolId: selectedResource.id, strength: selected?.strength ?? 0.6 }],
          });
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
      const matchingIndices = hostCharacters
        .map((character, index) => ({ character, index }))
        .filter(({ character }) => avatar
          ? character.avatar === avatar
          : !!item.characterName && character.name?.trim() === item.characterName.trim());
      // Name-only bindings cannot safely identify one character when names are duplicated.
      const currentIndex = matchingIndices.length === 1 ? matchingIndices[0].index : -1;
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
    anchor.click();
    // Keep the object URL alive long enough for mobile browsers to begin the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        <span>Vibe 池资源：{{ preview.vibes }}（预计新增 {{ preview.newVibes }}，复用/重复 {{ preview.duplicateVibes }}）
        <span>组引用：{{ preview.references }}</span></span>
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
