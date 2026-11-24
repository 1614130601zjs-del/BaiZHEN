export interface TheaterRoom {
  roomName: string;
  count: string;
  owner: string;
  narrator: string;
  narratorDesc: string;
}
export interface TheaterMessage {
  side: 'left' | 'right';
  speaker: string;
  text: string;
}
export interface TheaterEggBlock {
  room: TheaterRoom;
  messages: TheaterMessage[];
}
export interface ParsedTheaterOutput {
  title: string;
  prompt: string;
  extraImages: number;
  eggBlocks: TheaterEggBlock[];
}

export function normalizeTheaterPrompt(value: unknown): string {
  return String(value ?? '').replace(/\\s+/g, ' ').trim();
}

/** Parse Shizhen's plain-text theater protocol; malformed trailing rooms are retained. */
export function parseTheaterOutput(raw: string): ParsedTheaterOutput {
  const text = String(raw ?? '');
  const titleMatch = text.match(/title###([\\s\\S]*?)###/);
  const images = [...text.matchAll(/image###([\\s\\S]*?)###/g)]
    .map(match => normalizeTheaterPrompt(match[1]))
    .filter(Boolean);
  const eggBlocks: TheaterEggBlock[] = [];
  const marker = /eggroom###([\\s\\S]*?)###|eggmsg###([\\s\\S]*?)###|eggend###/g;
  let room: TheaterRoom | null = null;
  let messages: TheaterMessage[] = [];
  for (const match of text.matchAll(marker)) {
    if (match[1] !== undefined) {
      if (room) eggBlocks.push({ room, messages });
      const parts = match[1].split('|');
      room = {
        roomName: (parts[0] ?? '').trim(),
        count: (parts[1] ?? '').trim(),
        owner: (parts[2] ?? '').trim(),
        narrator: (parts[3] ?? '').trim(),
        narratorDesc: (parts[4] ?? '').trim(),
      };
      messages = [];
    } else if (match[2] !== undefined) {
      if (!room) continue;
      const parts = match[2].split('|');
      messages.push({
        side: (parts[0] ?? '').trim() === 'right' ? 'right' : 'left',
        speaker: (parts[1] ?? '').trim(),
        text: (parts[2] ?? '').trim(),
      });
    } else if (room) {
      eggBlocks.push({ room, messages });
      room = null;
      messages = [];
    }
  }
  if (room) eggBlocks.push({ room, messages });
  return {
    title: titleMatch ? normalizeTheaterPrompt(titleMatch[1]) : '',
    prompt: images[0] ?? '',
    extraImages: Math.max(0, images.length - 1),
    eggBlocks,
  };
}
