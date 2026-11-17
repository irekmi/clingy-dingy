export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** UUID v4 (działa też poza secure context). */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function roomCode(len = 5): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

export const ROOM_CODE_RE = /^[A-Z0-9]{4,8}$/;

export function cleanNick(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
}
