"use client";
import { createPortal } from "react-dom";
import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

type Opt = { value: string; label: string; disabled?: boolean };

function parse(children: React.ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.toArray(children).forEach((ch) => {
    if (!isValidElement(ch)) return;
    const p = ch.props as { value?: string | number; disabled?: boolean; children?: React.ReactNode };
    const label = Children.toArray(p.children).join("");
    out.push({ value: String(p.value ?? label), label, disabled: p.disabled });
  });
  return out;
}

type Props = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  defaultOpen?: boolean;
  "aria-label"?: string;
};

/** Lista suspensa no padrão do sistema (substitui o <select> nativo). Aceita <option> como filhos. */
export function Select({ name, value, defaultValue, onChange, children, className = "", style, disabled, defaultOpen, ...rest }: Props) {
  const opts = useMemo(() => parse(children), [children]);
  const [inner, setInner] = useState(defaultValue ?? "");
  const cur = value !== undefined ? value : inner;
  const eff = opts.some((o) => o.value === cur) ? cur : (opts[0]?.value ?? "");
  const selIdx = Math.max(0, opts.findIndex((o) => o.value === eff));
  const [open, setOpen] = useState(!!defaultOpen);
  const [active, setActive] = useState(selIdx);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean }>({ left: 0, top: 0, width: 0, maxH: 280, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  // onde o menu e montado (so valido depois do clique, ja no navegador)
  const host = open && btn.current ? ((btn.current.closest("dialog") as HTMLElement | null) ?? document.body) : null;

  const place = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 180 && above > below;
    setPos({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: r.width, maxH: Math.min(280, Math.max(120, up ? above : below)), up });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !list.current?.contains(t)) setOpen(false); };
    const scroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", place);
    return () => { document.removeEventListener("pointerdown", down); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", place); };
  }, [open, place]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);

  const choose = (i: number) => {
    const o = opts[i];
    if (!o || o.disabled) return;
    if (value === undefined) setInner(o.value);
    if (o.value !== eff) onChange?.(o.value);
    setOpen(false);
    btn.current?.focus();
  };
  const toggle = () => { if (disabled) return; setActive(selIdx); setOpen((o) => !o); };
  const key = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const step = (d: number) => { let i = active; for (let n = 0; n < opts.length; n++) { i = (i + d + opts.length) % opts.length; if (!opts[i].disabled) break; } setActive(i); };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!open) { setActive(selIdx); setOpen(true); } else step(e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === "Home" && open) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && open) { e.preventDefault(); setActive(opts.length - 1); }
    else if ((e.key === "Enter" || e.key === " ") && open) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
    else if (e.key === "Tab") setOpen(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const i = opts.findIndex((o, n) => n > active && o.label.toLowerCase().startsWith(k));
      const j = i >= 0 ? i : opts.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (j >= 0) { if (!open) setOpen(true); setActive(j); }
    }
  };

  return (
    <div className={`sel ${className}`} style={style}>
      {name && <input type="hidden" name={name} value={eff} />}
      <button ref={btn} type="button" className={`sel-btn ${open ? "open" : ""}`} onClick={toggle} onKeyDown={key} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={rest["aria-label"]}>
        <span className="sel-val">{opts[selIdx]?.label ?? ""}</span>
        <svg className="sel-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
      </button>
      {open && host && createPortal(
        <ul ref={list} id={id} role="listbox" onClick={(e) => e.preventDefault()} className={`sel-pop ${pos.up ? "up" : ""}`}
          style={{ left: pos.left, top: pos.top, minWidth: pos.width, maxHeight: pos.maxH, transform: pos.up ? "translateY(-100%)" : undefined }}>
          {opts.map((o, i) => (
            <li key={o.value + i} data-i={i} role="option" aria-selected={o.value === eff} aria-disabled={o.disabled}
              className={`sel-opt ${i === active ? "act" : ""} ${o.value === eff ? "on" : ""}`}
              onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
              <span>{o.label}</span>
              {o.value === eff && <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>}
            </li>
          ))}
        </ul>,
        host,
      )}
    </div>
  );
}
