<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { initLibraries, libraries } from '@/state/libraries';
import { getContext } from '@/st/context';
import { sidecarPathFor } from '@/floor/storage';
import { mapLimit } from '@/pool';
import {
  imageInPromptGallery, matchPromptGalleryEntry, updatePromptGalleryMembership,
  type PromptGalleryMembershipStore,
} from './promptGallery';

interface GalleryImage { key: string; src: string; download: string }
const props = defineProps<{ images: GalleryImage[] }>();
const open = ref(false);
const selectedPromptId = ref('');
const membership = ref<PromptGalleryMembershipStore>({});
const scanning = ref(false);
const scanStatus = ref('');
const promptEntries = computed(() => libraries.prompts);
const selectedPrompt = computed(() => promptEntries.value.find(item => item.id === selectedPromptId.value));
const galleryImages = computed(() => props.images.filter(image => imageInPromptGallery(membership.value, image.key, selectedPromptId.value)));
function loadMembership() {
  const settings = getContext()?.extensionSettings;
  const raw = settings?.baibai_image_prompt_gallery;
  membership.value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as PromptGalleryMembershipStore : {};
}
function persist() {
  const settings = getContext()?.extensionSettings;
  if (!settings) return;
  settings.baibai_image_prompt_gallery = membership.value;
  getContext()?.saveSettingsDebounced?.();
}
onMounted(() => { initLibraries(); loadMembership(); });
watch(selectedPromptId, () => { scanStatus.value = ''; });
function toggleImage(image: GalleryImage) {
  if (!selectedPromptId.value) return;
  membership.value = updatePromptGalleryMembership(membership.value, image.key, selectedPromptId.value, !imageInPromptGallery(membership.value, image.key, selectedPromptId.value));
  persist();
}
async function autoCollect() {
  if (!selectedPromptId.value || scanning.value) return;
  const targetId = selectedPromptId.value;
  scanning.value = true;
  scanStatus.value = '正在匹配图库侧写…';
  let added = 0, missed = 0;
  try {
    await mapLimit(props.images, 5, async image => {
      const sidecar = sidecarPathFor(image.key);
      if (!sidecar) { missed++; return; }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(sidecar, { signal: controller.signal });
        if (!response.ok) { missed++; return; }
        const meta = await response.json() as { prompt?: unknown };
        if (typeof meta.prompt !== 'string') { missed++; return; }
        const matched = matchPromptGalleryEntry(meta.prompt, promptEntries.value);
        if (matched?.id === targetId && !imageInPromptGallery(membership.value, image.key, targetId)) {
          membership.value = updatePromptGalleryMembership(membership.value, image.key, targetId, true);
          added++;
        }
      } catch { missed++; }
      finally { clearTimeout(timeout); }
    });
    persist();
    scanStatus.value = `自动归集完成：新增 ${added} 张；${missed} 张没有可用侧写。仅精确匹配。`;
  } finally { scanning.value = false; }
}
</script>

<template>
  <div class="pg-panel">
    <div class="pg-head">
      <button class="bbi-btn bbi-btn-sm" type="button" @click="open = !open"><Icon name="gallery" />{{ open ? '收起提示词图集' : '提示词图集' }}</button>
      <span class="pg-hint">按提示词单独归集，不移动或复制图片文件</span>
    </div>
    <section v-if="open" class="pg-body">
      <div class="pg-controls">
        <select v-model="selectedPromptId" class="bbi-input">
          <option value="">选择提示词图集…</option>
          <option v-for="entry in promptEntries" :key="entry.id" :value="entry.id">{{ entry.name }} · {{ entry.category }}</option>
        </select>
        <button class="bbi-btn bbi-btn-sm" type="button" :disabled="!selectedPromptId || scanning || !props.images.length" @click="autoCollect"><Icon name="refresh" />{{ scanning ? '匹配中…' : '自动精确归集' }}</button>
      </div>
      <p v-if="selectedPrompt" class="pg-description">{{ selectedPrompt.promptEn }}</p>
      <p v-if="scanStatus" class="pg-status" role="status">{{ scanStatus }}</p>
      <div v-if="selectedPromptId" class="pg-grid">
        <button v-for="image in props.images" :key="image.key" class="pg-thumb" type="button" :class="{ linked: imageInPromptGallery(membership, image.key, selectedPromptId) }" :title="imageInPromptGallery(membership, image.key, selectedPromptId) ? '点击移出图集' : '点击加入图集'" @click="toggleImage(image)">
          <img :src="image.src" loading="lazy" />
          <span>{{ imageInPromptGallery(membership, image.key, selectedPromptId) ? '已收录 · 点击移出' : '点击加入' }}</span>
        </button>
      </div>
      <p v-else class="pg-empty">先选择素材库中的一条提示词，下面可手动加入/移出图片。</p>
      <p v-if="selectedPromptId" class="pg-count">当前图集 {{ galleryImages.length }} 张 · 当前角色图库共 {{ props.images.length }} 张</p>
    </section>
  </div>
</template>

<style scoped>
.pg-panel{margin:8px 0 12px;border:1px solid var(--bbi-line);border-radius:var(--bbi-radius);background:var(--bbi-surface)}
.pg-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px}
.pg-hint,.pg-description,.pg-status,.pg-empty,.pg-count{font-size:12px;color:var(--bbi-ink-soft);margin:5px 0}
.pg-body{padding:10px;border-top:1px solid var(--bbi-line)}
.pg-controls{display:flex;gap:8px;flex-wrap:wrap}.pg-controls select{flex:1;min-width:180px}
.pg-description{white-space:pre-wrap;overflow-wrap:anywhere}
.pg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:7px;margin-top:9px}
.pg-thumb{position:relative;padding:0;border:1px solid var(--bbi-line);border-radius:var(--bbi-radius-sm);overflow:hidden;background:var(--bbi-surface-2);cursor:pointer}
.pg-thumb img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover}
.pg-thumb span{display:block;font-size:10px;padding:4px 2px;color:var(--bbi-ink-soft)}
.pg-thumb.linked{border:2px solid var(--bbi-accent)}
.pg-thumb.linked span{color:var(--bbi-accent);font-weight:600}
</style>
