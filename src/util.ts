export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 83.456 -> "1:23.45" (hours shown when needed). */
export function fmtTime(sec: number, decimals = 2): string {
  if (!Number.isFinite(sec)) sec = 0;
  const neg = sec < 0;
  sec = Math.abs(sec);
  // Round to the precision actually shown before splitting it up, so 59.999 s
  // reads as 1:00.00 instead of 0:60.00.
  const unit = 10 ** decimals;
  sec = Math.round(sec * unit) / unit;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = s.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0');
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return neg ? `-${body}` : body;
}

/** Parses "1:23.4", "83.4", "1:02:03" into seconds, or null. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim());
  if (parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function barBeat(pos: number, bpm: number, offset: number, beatsPerBar: number): string {
  const beat = 60 / bpm;
  const beats = Math.floor((pos - offset) / beat + 1e-6);
  const bar = Math.floor(beats / beatsPerBar) + 1;
  const b = ((beats % beatsPerBar) + beatsPerBar) % beatsPerBar + 1;
  return `${bar}.${b}`;
}

export const fmtPct = (rate: number) => `${Math.round(rate * 100)}%`;

export function fmtFreq(f: number) {
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : `${Math.round(f)}`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export const isTextInput = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type)));
