<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { backendStatus, captureGenerationSnapshot, decideSeed, generateImage } from '@/generate';
import { saveExternalImage } from '@/floor/storage';
import { getContext } from '@/st/context';
import { ARTIST_PREVIEW_FOLDER, listUserImageFolders, listUserImages } from '@/st/images';

type EditMode = 'img2img' | 'inpaint';
type Tool = 'brush' | 'eraser' | 'rect';

const baseCanvas = ref<HTMLCanvasElement | null>(null);
const maskCanvas = ref<HTMLCanvasElement | null>(null);
const prompt = ref('');
const negative = ref('');
const mode = ref<EditMode>('img2img');
const tool = ref<Tool>('brush');
const strength = ref(0.55);
const noise = ref(0.2);
const brushSize = ref(36);
const busy = ref(false);
const status = ref('');
const sourceName = ref('');
const galleryItems = ref<{ label: string; src: string }[]>([]);
const galleryLoading = ref(false);
const galleryError = ref('');
const showGallery = ref(false);
const resultPath = ref('');
const sourceImage = ref<HTMLImageElement | null>(null);
const undoStack: ImageData[] = [];
const redoStack: ImageData[] = [];
let pointer = false;
let lastPoint: { x: number; y: number } | null = null;
let rectStart: { x: number; y: number } | null = null;
let rectBase: ImageData | null = null;
let objectUrl = '';

const backend = computed(() => backendStatus());
const canGenerate = computed(() => !!sourceImage.value && !!prompt.value.trim() && !busy.value && backend.value.backend === 'nai' && backend.value.configured);

function fitSize(width: number, height: number) {
  const scale = Math.min(1, Math.sqrt(1_000_000 / (width * height)));
  let w = Math.max(64, Math.round(width * scale / 64) * 64);
  let h = Math.max(64, Math.round(height * scale / 64) * 64);
  while (w * h > 1_020_000) { if (w >= h) w -= 64; else h -= 64; }
  return { width: Math.max(64, w), height: Math.max(64, h) };
}

function context() { return maskCanvas.value?.getContext('2d'); }
function snapshotMask() {
  const canvas = maskCanvas.value; const ctx = context();
  if (!canvas || !ctx) return;
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (undoStack.length > 30) undoStack.shift();
  redoStack.length = 0;
}
function syncCanvas() {
  const base = baseCanvas.value; const mask = maskCanvas.value;
  if (!base || !mask) return;
  const size = fitSize(sourceImage.value!.naturalWidth, sourceImage.value!.naturalHeight);
  base.width = mask.width = size.width; base.height = mask.height = size.height;
  const ctx = base.getContext('2d');
  if (!ctx) throw new Error('无法创建图片画布');
  ctx.drawImage(sourceImage.value!, 0, 0, size.width, size.height);
  mask.getContext('2d')?.clearRect(0, 0, size.width, size.height);
  undoStack.length = 0; redoStack.length = 0;
}
async function loadGallery() {
  galleryLoading.value = true;
  galleryError.value = '';
  try {
    const folders = (await listUserImageFolders()).filter(
      folder => folder.startsWith('柏宝绘_') && folder !== ARTIST_PREVIEW_FOLDER,
    );
    const groups = await Promise.all(folders.map(async folder => ({
      folder,
      files: await listUserImages(folder),
    })));
    galleryItems.value = groups.flatMap(group => group.files.map(file => ({
      label: `${group.folder.slice('柏宝绘_'.length) || '未命名角色'} / ${file}`,
      src: `/user/images/${encodeURIComponent(group.folder)}/${encodeURIComponent(file)}`,
    })));
    if (!galleryItems.value.length) galleryError.value = '图库中暂无可编辑作品';
  } catch (error) {
    galleryError.value = error instanceof Error ? error.message : String(error);
  } finally {
    galleryLoading.value = false;
  }
}
function chooseGalleryImage(item: { label: string; src: string }) {
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
  const image = new Image();
  image.onload = () => {
    sourceImage.value = image;
    sourceName.value = item.label;
    resultPath.value = '';
    try { syncCanvas(); status.value = '已从图库载入来源图片'; }
    catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  };
  image.onerror = () => { status.value = '图库图片读取失败'; };
  image.src = item.src;
  showGallery.value = false;
}

async function loadFile(file?: File) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { status.value = '请选择图片文件'; return; }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    sourceImage.value = image;
    sourceName.value = file.name;
    resultPath.value = '';
    try { syncCanvas(); status.value = '来源图片已载入'; }
    catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  };
  image.onerror = () => { status.value = '图片读取失败'; };
  image.src = objectUrl;
}
function point(event: PointerEvent) {
  const canvas = maskCanvas.value!;
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}
function stroke(from: {x:number;y:number}, to: {x:number;y:number}, erase: boolean) {
  const ctx = context(); if (!ctx) return;
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = 'rgba(255, 48, 92, .58)';
  ctx.fillStyle = 'rgba(255, 48, 92, .58)';
  ctx.lineWidth = Math.max(1, brushSize.value);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x + 0.01, to.y + 0.01); ctx.stroke();
  ctx.restore();
}
function onPointerDown(event: PointerEvent) {
  if (!sourceImage.value || !maskCanvas.value) return;
  event.preventDefault();
  maskCanvas.value.setPointerCapture(event.pointerId);
  pointer = true; snapshotMask();
  lastPoint = point(event);
  if (tool.value === 'rect') {
    rectStart = lastPoint;
    rectBase = context()?.getImageData(0, 0, maskCanvas.value.width, maskCanvas.value.height) ?? null;
  } else stroke(lastPoint, lastPoint, tool.value === 'eraser');
}
function onPointerMove(event: PointerEvent) {
  if (!pointer || !lastPoint || !maskCanvas.value) return;
  const next = point(event);
  if (tool.value === 'rect' && rectStart && rectBase) {
    const ctx = context(); if (!ctx) return;
    ctx.putImageData(rectBase, 0, 0); ctx.fillStyle = 'rgba(255, 48, 92, .58)';
    ctx.fillRect(Math.min(rectStart.x, next.x), Math.min(rectStart.y, next.y), Math.abs(next.x - rectStart.x), Math.abs(next.y - rectStart.y));
  } else { stroke(lastPoint, next, tool.value === 'eraser'); lastPoint = next; }
}
function onPointerUp() { pointer = false; lastPoint = null; rectStart = null; rectBase = null; }
function undo() {
  const canvas = maskCanvas.value; const ctx = context(); const previous = undoStack.pop();
  if (!canvas || !ctx || !previous) return;
  redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); ctx.putImageData(previous, 0, 0);
}
function redo() {
  const canvas = maskCanvas.value; const ctx = context(); const next = redoStack.pop();
  if (!canvas || !ctx || !next) return;
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); ctx.putImageData(next, 0, 0);
}
function clearMask() {
  const canvas = maskCanvas.value; if (!canvas) return;
  snapshotMask(); context()?.clearRect(0, 0, canvas.width, canvas.height);
}
function exportBase64(canvas: HTMLCanvasElement) { return canvas.toDataURL('image/png').split(',')[1] ?? ''; }
function exportMask() {
  const source = maskCanvas.value; if (!source) return '';
  const output = document.createElement('canvas'); output.width = source.width; output.height = source.height;
  const ctx = output.getContext('2d'); if (!ctx) throw new Error('无法创建蒙版画布');
  const pixels = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const active = pixels.data[i + 3] > 12;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = active ? 255 : 0;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return exportBase64(output);
}
function maskIsEmpty() {
  const canvas = maskCanvas.value; if (!canvas) return true;
  const data = context()?.getImageData(0, 0, canvas.width, canvas.height).data;
  if (!data) return true;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 12) return false;
  return true;
}
async function generate() {
  if (!canGenerate.value) return;
  if (mode.value === 'inpaint' && maskIsEmpty()) { status.value = '局部重绘需要先涂出重绘区域'; return; }
  busy.value = true; status.value = '正在请求 NAI…'; resultPath.value = '';
  const snapshot = captureGenerationSnapshot();
  const seed = decideSeed('nai');
  try {
    const output = await generateImage({
      prompt: prompt.value.trim(), negative: negative.value.trim(), seed,
      imageEdit: {
        mode: mode.value, image: exportBase64(baseCanvas.value!),
        ...(mode.value === 'inpaint' ? { mask: exportMask() } : {}),
        strength: strength.value, noise: noise.value,
      },
    }, undefined, {}, snapshot);
    const characterName = getContext()?.name2?.trim() || '未命名角色';
    resultPath.value = await saveExternalImage(characterName, prompt.value.trim(), seed, output.result, output.meta);
    status.value = '完成，结果已保存到图库；可将结果另存后再次载入继续修改。';
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  } finally { busy.value = false; }
}
onBeforeUnmount(() => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
</script>

<template>
  <section class="workshop-page">
    <header class="page-heading">
      <div><h2>图片工坊</h2><p>使用 NAI 图生图与局部重绘，结果会保存到柏宝绘图库。</p></div>
      <span class="backend-state" :class="{ ready: backend.configured && backend.backend === 'nai' }">{{ backend.backend === 'nai' ? (backend.configured ? 'NAI 已就绪' : backend.reason) : '请切换到 NAI 后端' }}</span>
    </header>

    <section class="workshop-card">
      <div class="toolbar">
        <label class="file-button">上传本地图片<input type="file" accept="image/*" @change="loadFile(($event.target as HTMLInputElement).files?.[0])" /></label>
        <button type="button" @click="showGallery = !showGallery; showGallery && loadGallery()">从图库选择</button>
        <span v-if="sourceName" class="source-name">{{ sourceName }}</span>
      </div>
      <div v-if="showGallery" class="gallery-picker">
        <p v-if="galleryLoading">正在读取图库…</p>
        <p v-else-if="galleryError">{{ galleryError }}</p>
        <button v-for="item in galleryItems" :key="item.src" type="button" class="gallery-item" @click="chooseGalleryImage(item)">
          <img :src="item.src" :alt="item.label" loading="lazy" />
          <span>{{ item.label }}</span>
        </button>
      </div>
      <div v-if="sourceImage" class="stage">
        <canvas ref="baseCanvas" class="base-canvas"></canvas>
        <canvas ref="maskCanvas" class="mask-canvas" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp"></canvas>
      </div>
      <div v-else class="empty-stage"><span>选择一张图片开始编辑</span></div>
      <div class="toolbar tools">
        <button :class="{ active: tool === 'brush' }" @click="tool = 'brush'">画笔</button>
        <button :class="{ active: tool === 'eraser' }" @click="tool = 'eraser'">擦除</button>
        <button :class="{ active: tool === 'rect' }" @click="tool = 'rect'">矩形选区</button>
        <button @click="undo" :disabled="!undoStack.length">撤销</button>
        <button @click="redo" :disabled="!redoStack.length">重做</button>
        <button @click="clearMask" :disabled="!sourceImage">清空蒙版</button>
        <label class="brush-control">笔刷 <input v-model.number="brushSize" type="range" min="4" max="160" step="2" /> {{ brushSize }} px</label>
      </div>
    </section>

    <section class="workshop-card controls">
      <label>编辑模式<select v-model="mode"><option value="img2img">图生图（整图重绘）</option><option value="inpaint">局部重绘 / 重点修复</option></select></label>
      <label>正向提示词<textarea v-model="prompt" rows="3" placeholder="描述希望生成的画面" /></label>
      <label>负面提示词<textarea v-model="negative" rows="2" placeholder="可选；NAI 使用渠道负面词设置" /></label>
      <label>重绘强度 <output>{{ strength.toFixed(2) }}</output><input v-model.number="strength" type="range" min="0" max="1" step="0.01" /></label>
      <label>噪声强度 <output>{{ noise.toFixed(2) }}</output><input v-model.number="noise" type="range" min="0" max="1" step="0.01" /></label>
      <p v-if="mode === 'inpaint'" class="hint">蒙版涂色区域会被重绘，未涂色区域尽量保持原样。</p>
      <button class="primary" :disabled="!canGenerate" @click="generate">{{ busy ? '生成中…' : '开始生成' }}</button>
      <p v-if="status" class="status" role="status">{{ status }}</p>
    </section>

    <section v-if="resultPath" class="workshop-card result">
      <h3>生成结果</h3>
      <img :src="resultPath" alt="工坊生成结果" />
      <a :href="resultPath" target="_blank" rel="noreferrer">打开原图</a>
    </section>
  </section>
</template>

<style scoped>
.gallery-picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; max-height: 300px; overflow: auto; padding: 10px; border: 1px solid var(--bbi-border); border-radius: 10px; }
.gallery-item { display: grid; gap: 5px; min-width: 0; padding: 6px; text-align: left; }
.gallery-item img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; }
.gallery-item span { overflow-wrap: anywhere; font-size: 11px; }
.workshop-page { display: grid; gap: 14px; padding: 4px 2px 24px; color: var(--bbi-ink); }
.page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h2 { margin: 0 0 5px; font-size: 18px; } h3 { margin: 0; font-size: 15px; }
p { margin: 0; color: var(--bbi-ink-soft); font-size: 13px; line-height: 1.55; }
.backend-state { max-width: 48%; color: var(--bbi-ink-soft); font-size: 12px; }
.backend-state.ready { color: var(--bbi-success, #36865c); }
.workshop-card { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius); background: var(--bbi-surface); }
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.file-button, button { border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius-sm); padding: 8px 11px; background: var(--bbi-surface-2); color: var(--bbi-ink); font: inherit; font-size: 13px; cursor: pointer; }
.file-button input { display: none; } button:disabled { opacity: .45; cursor: not-allowed; } button.active { border-color: var(--bbi-accent); color: var(--bbi-accent); }
.source-name { color: var(--bbi-ink-soft); font-size: 12px; overflow-wrap: anywhere; }
.stage { position: relative; width: 100%; display: grid; place-items: center; overflow: hidden; background: repeating-conic-gradient(var(--bbi-surface-2) 0 25%, var(--bbi-surface) 0 50%) 50% / 20px 20px; border-radius: var(--bbi-radius-sm); }
.stage canvas { grid-area: 1 / 1; display: block; width: 100%; height: auto; max-height: 65vh; object-fit: contain; }
.mask-canvas { touch-action: none; cursor: crosshair; }
.empty-stage { min-height: 220px; display: grid; place-items: center; border: 1px dashed var(--bbi-line-strong); border-radius: var(--bbi-radius-sm); color: var(--bbi-ink-soft); font-size: 13px; }
.tools { border-top: 1px solid var(--bbi-line); padding-top: 10px; }
.brush-control { display: flex; align-items: center; gap: 7px; color: var(--bbi-ink-soft); font-size: 12px; }
.brush-control input { width: 110px; }
.controls > label { display: grid; gap: 6px; color: var(--bbi-ink-soft); font-size: 13px; }
.controls select, .controls textarea { width: 100%; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius-sm); padding: 9px; background: var(--bbi-surface-2); color: var(--bbi-ink); font: inherit; }
.controls textarea { resize: vertical; }
.controls output { float: right; color: var(--bbi-ink); }
.hint { padding: 9px; border-radius: var(--bbi-radius-sm); background: var(--bbi-surface-2); }
.primary { justify-self: start; border-color: var(--bbi-accent); background: var(--bbi-accent); color: white; font-weight: 600; padding: 10px 18px; }
.status { overflow-wrap: anywhere; }
.result img { width: 100%; max-height: 70vh; object-fit: contain; border-radius: var(--bbi-radius-sm); }
.result a { color: var(--bbi-accent); font-size: 13px; }
@media (max-width: 520px) { .workshop-card { padding: 10px; } .backend-state { max-width: 100%; } }
</style>
