import { describe, expect, it } from 'vitest';
import { BoundedSet } from '@/autoTag/boundedSet';

describe('BoundedSet', () => {
  it('保留最近加入的身份并淘汰最早身份', () => {
    const values = new BoundedSet<string>(2);
    values.add('a').add('b').add('c');
    expect(values.has('a')).toBe(false);
    expect(values.has('b')).toBe(true);
    expect(values.has('c')).toBe(true);
    expect(values.size).toBe(2);
  });

  it('重复加入会刷新身份的新近度', () => {
    const values = new BoundedSet<string>(2);
    values.add('a').add('b').add('a').add('c');
    expect(values.has('a')).toBe(true);
    expect(values.has('b')).toBe(false);
  });

  it('支持删除、清空并校验容量', () => {
    const values = new BoundedSet<number>(1);
    expect(() => new BoundedSet(0)).toThrow(RangeError);
    values.add(1);
    expect(values.delete(1)).toBe(true);
    values.add(2);
    values.clear();
    expect(values.size).toBe(0);
  });
});
