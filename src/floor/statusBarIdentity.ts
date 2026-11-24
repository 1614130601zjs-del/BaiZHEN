export function statusBarHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildStatusBarTaskKey(chatId: string, messageId: string, swipeId: number, ordinal: number, prompt: string): string {
  return `statusbar:${statusBarHash(chatId)}:${messageId}:${swipeId}:${ordinal}:${statusBarHash(prompt)}`;
}
