import { captureGenerationSnapshot, decideSeed, generateImage } from '@/generate';
import { effectiveOrientation, type Orientation } from '@/backends/size';
import { inferRenderProfile } from '@/autoTag/renderProfile';
import { makeCharacterBindingKey } from '@/backends/shizhenArtistProfiles';
import { resultToBase64ForUpload } from '@/floor/storage';
import { deleteUserImage, uploadUserImage } from '@/st/images';
import { getContext } from '@/st/context';
import { settings } from '@/state/settings';
import type { GenerationMeta } from '@/generationMeta';
import { buildStatusBarTaskKey, statusBarHash } from '@/floor/statusBarIdentity';

const STORE_KEY = 'baibai_image_statusbar_cache';
const IMAGE_FOLDER = '柏宝绘_状态栏';
const MAX_HISTORY_PER_TASK = 24;

interface StatusBarImage {
  path: string;
  createdAt: number;
  meta?: GenerationMeta;
}
interface StatusBarTask {
  taskKey: string;
  prompt: string;
  chatId: string;
  messageId: string;
  ordinal: number;
  images: StatusBarImage[];
  currentIndex: number;
  updatedAt: number;
}
interface StatusBarStore { tasks: Record<string, StatusBarTask> }

let memoryStore: StatusBarStore = { tasks: {} };
const observedBodies = new WeakSet<Node>();
const hookedIframes = new WeakSet<HTMLIFrameElement>();
const liveCards = new WeakSet<Element>();
const activeTasks = new Set<string>();
let bound = false;

function store(): StatusBarStore {
  const ctx = getContext();
  const extensions = ctx?.extensionSettings;
  if (!extensions) return memoryStore;
  const raw = extensions[STORE_KEY] as Partial<StatusBarStore> | undefined;
  if (!raw || typeof raw !== 'object' || !raw.tasks || typeof raw.tasks !== 'object') {
    extensions[STORE_KEY] = memoryStore;
    return memoryStore;
  }
  memoryStore = raw as StatusBarStore;
  return memoryStore;
}
function persist(): void {
  const ctx = getContext();
  if (ctx?.extensionSettings) ctx.extensionSettings[STORE_KEY] = memoryStore;
  ctx?.saveSettingsDebounced?.();
}
function fnv(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
export function parseMarker(value: unknown): string {
  const text = String(value ?? '');
  return text.match(/image###([\s\S]*?)###/)?.[1]?.trim() || '';
}

/** Resolve the marker from the scanning node, its data-tag children, or its containing message. */
export function statusBarPromptForTarget(target: Element): string {
  // External stable stages are keyed only by their own marker; never scrape rendered card text.
  if (target.hasAttribute('data-ql-stable')) return parseMarker(target.getAttribute('data-tag'));
  const values: unknown[] = [
    target.getAttribute('data-qlPrompt'),
    target.textContent,
    target.getAttribute('data-tag'),
    ...Array.from(target.querySelectorAll('[data-tag]'), node => node.getAttribute('data-tag')),
  ];
  for (const value of values) {
    const prompt = parseMarker(value);
    if (prompt) return prompt;
  }
  let ancestor = target.parentElement;
  while (ancestor && !ancestor.matches('.mes')) {
    const prompt = parseMarker(ancestor.getAttribute('data-tag'));
    if (prompt) return prompt;
    ancestor = ancestor.parentElement;
  }
  return '';
}

function collectDocs(root: Document = document, depth = 0, out: Document[] = []): Document[] {
  if (!out.includes(root)) out.push(root);
  if (depth >= 3) return out;
  for (const frame of Array.from(root.querySelectorAll('iframe'))) {
    try {
      const inner = frame.contentDocument;
      if (inner) collectDocs(inner, depth + 1, out);
    } catch {
      console.warn('[柏宝绘] 跨域 iframe 无法读取，其中的状态栏图片标记不会被接管。');
    }
  }
  return out;
}

function taskIdentity(frame: Element, prompt: string, doc: Document): { taskKey: string; chatId: string; messageId: string; ordinal: number } {
  const message = frame.closest('.mes[mesid], .mes');
  const messageId = message?.getAttribute('mesid') || 'external';
  const scope = message || doc;
  const same = [
    ...(frame.matches('.scanning, [data-qlPrompt]') ? [frame] : []),
    ...Array.from(scope.querySelectorAll('.scanning, [data-qlPrompt]')),
  ].filter(node => statusBarPromptForTarget(node) === prompt);
  const ordinal = frame.hasAttribute('data-ql-stable') ? 0 : Math.max(0, same.indexOf(frame));
  const context = getContext();
  const messageIndex = Number(messageId);
  const swipeId = Number.isInteger(messageIndex) ? Number(context?.chat[messageIndex]?.swipe_id ?? 0) || 0 : 0;
  const chatId = context?.getCurrentChatId() || 'chat';
  const taskKey = buildStatusBarTaskKey(chatId, messageId, swipeId, ordinal, prompt);
  return { taskKey, chatId, messageId, ordinal };
}

function ensurePosition(frame: HTMLElement): void {
  if (getComputedStyle(frame).position === 'static') frame.style.position = 'relative';
}
function makeButton(doc: Document, label: string, title: string): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.style.cssText = 'border:1px solid rgba(255,255,255,.55);border-radius:18px;padding:6px 11px;background:rgba(20,25,32,.72);color:#fff;font:12px sans-serif;cursor:pointer;pointer-events:auto;';
  return button;
}

function renderCard(frame: HTMLElement, task: StatusBarTask): void {
  frame.querySelector('.bbi-statusbar-card')?.remove();
  const item = task.images[task.currentIndex];
  if (!item) return;
  ensurePosition(frame);
  const doc = frame.ownerDocument;
  const card = doc.createElement('div');
  card.className = 'bbi-statusbar-card';
  card.dataset.taskKey = task.taskKey;
  card.style.cssText = 'position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;';
  const image = doc.createElement('img');
  image.src = item.path;
  image.alt = '柏宝绘状态栏图片';
  image.loading = 'eager';
  image.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
  card.append(image);

  const controls = doc.createElement('div');
  controls.style.cssText = 'position:absolute;inset:auto 8px 8px;z-index:7;display:flex;justify-content:center;align-items:center;gap:6px;opacity:.95;';
  const previous = makeButton(doc, '‹', '上一张');
  previous.disabled = task.currentIndex <= 0;
  previous.onclick = () => { task.currentIndex = Math.max(0, task.currentIndex - 1); persist(); renderCard(frame, task); };
  const count = doc.createElement('span');
  count.textContent = `${task.currentIndex + 1}/${task.images.length}`;
  count.style.cssText = 'color:#fff;text-shadow:0 1px 3px #000;font:12px sans-serif;';
  const next = makeButton(doc, '›', '下一张');
  next.disabled = task.currentIndex >= task.images.length - 1;
  next.onclick = () => { task.currentIndex = Math.min(task.images.length - 1, task.currentIndex + 1); persist(); renderCard(frame, task); };
  const reroll = makeButton(doc, '重 Roll', '重新生成一张状态栏图片');
  reroll.onclick = () => void generateForFrame(frame, task.prompt, task);
  const remove = makeButton(doc, '删除', '删除当前状态栏图片');
  remove.onclick = () => void removeCurrent(frame, task);
  controls.append(previous, count, next, reroll, remove);
  card.append(controls);
  frame.append(card);
  liveCards.add(card);
}

function showTrigger(frame: HTMLElement, prompt: string, identity: ReturnType<typeof taskIdentity>): void {
  if (frame.querySelector('.bbi-statusbar-trigger')) return;
  ensurePosition(frame);
  const button = makeButton(frame.ownerDocument, '定格此刻', '点击生成状态栏图片');
  button.className = 'bbi-statusbar-trigger';
  button.style.cssText += ';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:8;padding:10px 24px;';
  button.onclick = () => void generateForFrame(frame, prompt, {
    taskKey: identity.taskKey, prompt, chatId: identity.chatId, messageId: identity.messageId,
    ordinal: identity.ordinal, images: [], currentIndex: -1, updatedAt: Date.now(),
  });
  frame.append(button);
}

function showError(frame: HTMLElement, message: string, retry: () => void): void {
  frame.querySelector('.bbi-statusbar-error')?.remove();
  const error = frame.ownerDocument.createElement('div');
  error.className = 'bbi-statusbar-error';
  error.style.cssText = 'position:absolute;inset:0;z-index:9;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;background:rgba(0,0,0,.78);color:#fff;font:12px sans-serif;padding:12px;text-align:center;';
  const text = frame.ownerDocument.createElement('span');
  text.textContent = `状态栏生图失败：${message}`;
  const button = makeButton(frame.ownerDocument, '重试', '重试状态栏生图');
  button.onclick = retry;
  error.append(text, button);
  frame.append(error);
}

async function removeCurrent(frame: HTMLElement, task: StatusBarTask): Promise<void> {
  const current = task.images[task.currentIndex];
  if (!current) return;
  try {
    await deleteUserImage(current.path);
    task.images.splice(task.currentIndex, 1);
    task.currentIndex = Math.min(task.currentIndex, task.images.length - 1);
    task.updatedAt = Date.now();
    if (!task.images.length) {
      delete store().tasks[task.taskKey];
      persist();
      frame.querySelector('.bbi-statusbar-card')?.remove();
      showTrigger(frame, task.prompt, {
        taskKey: task.taskKey, chatId: task.chatId, messageId: task.messageId, ordinal: task.ordinal,
      });
    } else {
      persist();
      renderCard(frame, task);
    }
  } catch (error) {
    showError(frame, error instanceof Error ? error.message : String(error), () => void removeCurrent(frame, task));
  }
}

async function generateForFrame(frame: HTMLElement, prompt: string, task: StatusBarTask): Promise<void> {
  if (activeTasks.has(task.taskKey) || !settings.enabled) return;
  let output: Awaited<ReturnType<typeof generateImage>> | undefined;
  activeTasks.add(task.taskKey);
  frame.dataset.bbiStatusbarBusy = '1';
  frame.dataset.bbiStatusbarBusyTask = task.taskKey;
  frame.querySelector('.bbi-statusbar-trigger,.bbi-statusbar-error')?.remove();
  const loading = frame.ownerDocument.createElement('div');
  loading.className = 'bbi-statusbar-loading';
  loading.textContent = '柏宝绘：正在生成状态栏画面…';
  loading.style.cssText = 'position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);color:#fff;font:13px sans-serif;';
  ensurePosition(frame);
  frame.append(loading);
  try {
    const snapshot = captureGenerationSnapshot();
    if (!snapshot.status.configured) throw new Error(snapshot.status.reason || '生图后端尚未配置');
    const context = getContext();
    const currentCharacter = context?.characters?.[Number(context?.characterId)];
    const orientation: Orientation = frame.clientWidth > frame.clientHeight ? 'landscape' : 'portrait';
    output = await generateImage({
      prompt,
      seed: decideSeed(snapshot.backend),
      size: effectiveOrientation(snapshot.orientation, orientation),
      characterKey: makeCharacterBindingKey(currentCharacter?.avatar, currentCharacter?.name, context?.characterId),
      characterName: currentCharacter?.name || context?.name2 || '',
      artistTarget: 'statusBar',
      renderProfile: inferRenderProfile(prompt),
    }, undefined, {}, snapshot);
    if (!settings.enabled || !frame.isConnected || frame.dataset.bbiStatusbarTask !== task.taskKey || statusBarPromptForTarget(frame) !== prompt) return;
    const base64 = await resultToBase64ForUpload(output.result);
    const format = /^[a-z0-9]+$/i.test(output.result.format) ? output.result.format.toLowerCase() : 'png';
    const filename = `status_${statusBarHash(task.taskKey)}_${Date.now().toString(36)}.${format}`;
    const path = await uploadUserImage(IMAGE_FOLDER, filename, base64, format);
    if (!settings.enabled || !frame.isConnected || frame.dataset.bbiStatusbarTask !== task.taskKey || statusBarPromptForTarget(frame) !== prompt) {
      await deleteUserImage(path).catch(() => undefined);
      return;
    }
    task.images.push({ path, createdAt: Date.now(), meta: output.meta });
    if (task.images.length > MAX_HISTORY_PER_TASK) {
      const removed = task.images.splice(0, task.images.length - MAX_HISTORY_PER_TASK);
      await Promise.all(removed.map(item => deleteUserImage(item.path).catch(() => undefined)));
    }
    task.currentIndex = task.images.length - 1;
    task.updatedAt = Date.now();
    store().tasks[task.taskKey] = task;
    persist();
    renderCard(frame, task);
  } catch (error) {
    if (frame.isConnected && frame.dataset.bbiStatusbarTask === task.taskKey && statusBarPromptForTarget(frame) === prompt) {
      const message = error instanceof Error ? error.message : String(error);
      showError(frame, message, () => void generateForFrame(frame, prompt, task));
    }
  } finally {
    output?.result.revoke();
    loading.remove();
    if (frame.dataset.bbiStatusbarBusyTask === task.taskKey) {
      frame.dataset.bbiStatusbarBusy = '0';
      frame.dataset.bbiStatusbarBusyTask = '';
    }
    activeTasks.delete(task.taskKey);
    if (settings.enabled && frame.dataset.bbiStatusbarTask === task.taskKey && statusBarPromptForTarget(frame) === prompt
      && !frame.querySelector('.bbi-statusbar-card') && !frame.querySelector('.bbi-statusbar-error')) {
      showTrigger(frame, prompt, {
        taskKey: task.taskKey, chatId: task.chatId, messageId: task.messageId, ordinal: task.ordinal,
      });
    }
    processFrames();
  }
}

function repairSerializedCards(doc: Document): void {
  for (const card of Array.from(doc.querySelectorAll<HTMLElement>('.bbi-statusbar-card'))) {
    if (liveCards.has(card)) continue;
    const taskKey = card.dataset.taskKey || '';
    const frame = card.parentElement;
    const task = taskKey ? store().tasks[taskKey] : undefined;
    card.remove();
    if (frame && task?.images?.length) renderCard(frame, task);
  }
}

function processFrames(): void {
  if (!settings.enabled) {
    // 功能关闭时移除注入界面，但保留本地历史缓存；重新开启后可继续查看。
    for (const doc of collectDocs()) {
      doc.querySelectorAll('.bbi-statusbar-card,.bbi-statusbar-trigger,.bbi-statusbar-error,.bbi-statusbar-loading')
        .forEach(node => node.remove());
    }
    return;
  }
  for (const doc of collectDocs()) {
    repairSerializedCards(doc);
    const frames = Array.from(doc.querySelectorAll<HTMLElement>('.scanning, [data-qlPrompt]')).filter(frame => {
      const prompt = statusBarPromptForTarget(frame);
      if (!prompt) return false;
      return !Array.from(frame.querySelectorAll('.scanning, [data-qlPrompt]'))
        .some(child => statusBarPromptForTarget(child) === prompt);
    });
    for (const frame of frames) {
      const prompt = statusBarPromptForTarget(frame);
      if (!prompt) continue;
      const identity = taskIdentity(frame, prompt, doc);
      if (frame.dataset.bbiStatusbarPrompt !== prompt || frame.dataset.bbiStatusbarTask !== identity.taskKey) {
        frame.dataset.bbiStatusbarPrompt = prompt;
        frame.dataset.bbiStatusbarTask = identity.taskKey;
        frame.dataset.bbiStatusbarAutoStarted = '';
        frame.querySelectorAll('.bbi-statusbar-card,.bbi-statusbar-trigger,.bbi-statusbar-error,.bbi-statusbar-loading').forEach(node => node.remove());
      }
      if ((frame.dataset.bbiStatusbarBusy === '1' && frame.dataset.bbiStatusbarBusyTask === identity.taskKey)
        || frame.querySelector('.bbi-statusbar-error')) continue;
      const cached = store().tasks[identity.taskKey];
      if (cached?.images?.length) {
        if (!frame.querySelector('.bbi-statusbar-card')) renderCard(frame, cached);
        continue;
      }
      if (frame.hasAttribute('data-ql-autoarm') && !frame.dataset.bbiStatusbarAutoStarted) {
        frame.dataset.bbiStatusbarAutoStarted = '1';
        void generateForFrame(frame, prompt, {
          taskKey: identity.taskKey, prompt, chatId: identity.chatId, messageId: identity.messageId,
          ordinal: identity.ordinal, images: [], currentIndex: -1, updatedAt: Date.now(),
        });
      } else {
        showTrigger(frame, prompt, identity);
      }
    }
  }
}

function attachDocuments(): void {
  for (const doc of collectDocs()) {
    const target = doc.body || doc.documentElement;
    if (!target || observedBodies.has(target)) continue;
    observedBodies.add(target);
    const observer = new MutationObserver(() => {
      attachDocuments();
      processFrames();
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-tag', 'data-qlprompt', 'data-ql-stable', 'data-ql-autoarm'] });
    for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
      if (hookedIframes.has(frame)) continue;
      hookedIframes.add(frame);
      frame.addEventListener('load', () => { attachDocuments(); processFrames(); });
    }
  }
}

export function refreshStatusBarObserver(): void {
  if (bound) processFrames();
}

export function bindStatusBarObserver(): boolean {
  if (bound) return true;
  if (!document.body) return false;
  bound = true;
  attachDocuments();
  processFrames();
  return true;
}
