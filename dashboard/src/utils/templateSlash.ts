import type { MessageTemplate } from '../services/api';

/** Flatten header/body/footer the same way the send-template API does. */
export function composeTemplateText(template: {
  header?: string | null;
  body: string;
  footer?: string | null;
}): string {
  return [template.header, template.body, template.footer].filter(Boolean).join('\n\n');
}

export type SlashQuery = { start: number; query: string };

/**
 * If the caret is inside a `/token` that starts at the beginning of the draft or after
 * whitespace, return that token so the composer can offer templates. URLs like `https://`
 * do not match.
 */
export function slashQueryAt(text: string, cursor: number): SlashQuery | null {
  const pos = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, pos);
  const match = before.match(/(^|[\s\n])\/([^\s]*)$/);
  if (!match) return null;
  const query = match[2] ?? '';
  const start = before.length - query.length - 1;
  return { start, query };
}

export function filterTemplatesBySlash(templates: MessageTemplate[], query: string): MessageTemplate[] {
  const q = query.trim().toLowerCase();
  const ranked = templates
    .map(template => {
      const name = template.name.toLowerCase();
      let score = 0;
      if (!q) score = 1;
      else if (name === q) score = 3;
      else if (name.startsWith(q)) score = 2;
      else if (name.includes(q)) score = 1;
      return { template, score };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name));
  return ranked.slice(0, 8).map(row => row.template);
}

export function applyTemplateAtSlash(
  text: string,
  cursor: number,
  replacement: string,
): { text: string; cursor: number } | null {
  const slash = slashQueryAt(text, cursor);
  if (!slash) return null;
  const before = text.slice(0, slash.start);
  const after = text.slice(cursor);
  const next = before + replacement + after;
  return { text: next, cursor: before.length + replacement.length };
}

/** Insert when the operator picked from the list without a live `/` token. */
export function insertTemplateText(text: string, cursor: number, replacement: string): { text: string; cursor: number } {
  const applied = applyTemplateAtSlash(text, cursor, replacement);
  if (applied) return applied;
  if (!text.trim()) return { text: replacement, cursor: replacement.length };
  const before = text.slice(0, cursor).replace(/\s*$/, '');
  const after = text.slice(cursor);
  const gap = before ? '\n\n' : '';
  const next = before + gap + replacement + after;
  return { text: next, cursor: (before + gap + replacement).length };
}
