import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Panel({ title, children, actions, className = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

interface SliderProps {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  defaultValue?: number;
  disabled?: boolean;
  /** non-linear mapping, e.g. log frequency */
  scale?: 'linear' | 'log';
  title?: string;
}

export function Slider({ label, value, min, max, step, onChange, format, defaultValue, disabled, scale = 'linear', title }: SliderProps) {
  const toPos = (v: number) => (scale === 'log' ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
  const fromPos = (p: number) => (scale === 'log' ? min * Math.pow(max / min, p / 1000) : p);
  // Reserve room for the widest end-of-range label so the track doesn't resize (and shift under the pointer) as the value text changes.
  const valueWidth = format ? Math.max(format(min).length, format(max).length) : Math.max(String(min).length, String(max).length);
  return (
    <label className={`slider ${disabled ? 'disabled' : ''}`} title={title}>
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={scale === 'log' ? 0 : min}
        max={scale === 'log' ? 1000 : max}
        step={scale === 'log' ? 1 : step}
        value={toPos(value)}
        disabled={disabled}
        onChange={(e) => {
          const v = fromPos(Number(e.target.value));
          onChange(scale === 'log' ? Math.round(v / step) * step : v);
        }}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      />
      <span className="slider-value" style={{ minWidth: `${valueWidth}ch` }}>
        {format ? format(value) : value}
      </span>
    </label>
  );
}

/** Numeric text field that commits on Enter/blur; supports arrow-key stepping. */
export function NumberField({
  value,
  onChange,
  step = 1,
  min,
  max,
  format = (v) => String(v),
  parse = (t) => (t.trim() === '' || isNaN(Number(t)) ? null : Number(t)),
  width = '5em',
  title,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  parse?: (t: string) => number | null;
  width?: string;
  title?: string;
  suffix?: string;
}) {
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focused) setText(format(value));
  }, [value, focused, format]);
  const commit = (v: number | null) => {
    if (v === null) return setText(format(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
    setText(format(v));
  };
  return (
    <span className="numfield">
      <input
        ref={ref}
        style={{ width }}
        value={text}
        title={title}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit(parse(text));
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(parse(text));
            ref.current?.blur();
          } else if (e.key === 'Escape') {
            setText(format(value));
            ref.current?.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            commit(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1));
          }
        }}
      />
      {suffix && <span className="numfield-suffix">{suffix}</span>}
    </span>
  );
}

export function Toggle({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
      <span>{children}</span>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  title,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" title={title}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Calls `cb` every animation frame while mounted. */
export function useAnimationFrame(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    let id = 0;
    const loop = () => {
      ref.current();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

/** Size a canvas to its CSS box at device pixel ratio; returns [width, height] in CSS px. */
export function fitCanvas(canvas: HTMLCanvasElement): [number, number, number] {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  return [w, h, dpr];
}

/** Reads a CSS custom property from :root (cached per frame by caller). */
export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
