import { describe, expect, it } from 'vitest';

import { buildStatusBarTaskKey } from '@/floor/statusBarIdentity';

describe('状态栏任务身份', () => {
  it('相同聊天、消息、swipe、序号和提示词得到稳定 key', () => {
    const args = ['chat-a', '12', 2, 1, '1girl, sunset'] as const;
    expect(buildStatusBarTaskKey(...args)).toBe(buildStatusBarTaskKey(...args));
  });

  it('不同聊天或消息不会共用历史任务', () => {
    const base = buildStatusBarTaskKey('chat-a', '12', 0, 0, '1girl');
    expect(buildStatusBarTaskKey('chat-b', '12', 0, 0, '1girl')).not.toBe(base);
    expect(buildStatusBarTaskKey('chat-a', '13', 0, 0, '1girl')).not.toBe(base);
  });

  it('同一消息的不同 swipe 和标记序号相互隔离', () => {
    const base = buildStatusBarTaskKey('chat-a', '12', 0, 0, '1girl');
    expect(buildStatusBarTaskKey('chat-a', '12', 1, 0, '1girl')).not.toBe(base);
    expect(buildStatusBarTaskKey('chat-a', '12', 0, 1, '1girl')).not.toBe(base);
  });

  it('提示词修改后不会复用旧图缓存', () => {
    expect(buildStatusBarTaskKey('chat-a', '12', 0, 0, '1girl'))
      .not.toBe(buildStatusBarTaskKey('chat-a', '12', 0, 0, '1girl, blue eyes'));
  });
});
