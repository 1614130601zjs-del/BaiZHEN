import { describe, expect, it } from 'vitest';
import { parseTheaterOutput } from './format';

describe('parseTheaterOutput', () => {
  it('parses title, first image, room metadata and ordered messages', () => {
    const result = parseTheaterOutput([
      'title###雨夜来信###',
      'image###1girl, rainy street, letter###',
      'eggroom###深夜茶话会|3|小雪|旁白|冷静的吐槽者###',
      'eggmsg###left|小雪|你终于来了。###',
      'eggmsg###right|用户|我没有迟到。###',
      'eggend###',
    ].join('\n'));
    expect(result.title).toBe('雨夜来信');
    expect(result.prompt).toBe('1girl, rainy street, letter');
    expect(result.eggBlocks).toHaveLength(1);
    expect(result.eggBlocks[0].room.roomName).toBe('深夜茶话会');
    expect(result.eggBlocks[0].messages).toEqual([
      { side: 'left', speaker: '小雪', text: '你终于来了。' },
      { side: 'right', speaker: '用户', text: '我没有迟到。' },
    ]);
  });

  it('keeps multiple rooms, ignores messages before a room and tolerates missing end marker', () => {
    const result = parseTheaterOutput([
      'eggmsg###left|orphan|ignored###',
      'eggroom###第一间|2|||###',
      'eggmsg###unknown|甲|按左侧显示###',
      'eggroom###第二间|1|||###',
      'eggmsg###right|乙|未闭合房间###',
    ].join('\n'));
    expect(result.eggBlocks).toHaveLength(2);
    expect(result.eggBlocks[0].messages[0].side).toBe('left');
    expect(result.eggBlocks[1].messages[0].text).toBe('未闭合房间');
  });

  it('counts additional images but only selects the first', () => {
    const result = parseTheaterOutput('image###first### image###second###');
    expect(result.prompt).toBe('first');
    expect(result.extraImages).toBe(1);
  });
});
