export type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; text: string; number: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'divider' };

export function sanitizeMarkdownSource(source: string): string {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '');
}

export function isSafeMarkdownUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      Boolean(url.hostname) &&
      url.hostname.includes('.') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function tokenizeMarkdown(source: string): MarkdownBlock[] {
  const lines = sanitizeMarkdownSource(source).replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      if (code === null) code = [];
      else {
        blocks.push({ type: 'code', text: code.join('\n') });
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'divider' });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      blocks.push({ type: 'bullet', text: bullet[1] });
      continue;
    }
    const numbered = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      blocks.push({ type: 'numbered', number: numbered[1], text: numbered[2] });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      blocks.push({ type: 'quote', text: quote[1] });
      continue;
    }
    paragraph.push(trimmed);
  }

  flushParagraph();
  if (code !== null && code.length > 0) blocks.push({ type: 'code', text: code.join('\n') });
  return blocks;
}
