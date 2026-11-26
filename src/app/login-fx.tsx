"use client";
import { useEffect, useRef } from "react";

/** Nome em texto vetorial (sempre nítido): letras entram uma a uma e um brilho dourado passa por cima. */
export function Wordmark({ text = "TieFinance" }: { text?: string }) {
  const letters = (anim: boolean) => [...text].map((ch, i) => <span key={i} style={anim ? { ["--i" as string]: i } : undefined}>{ch}</span>);
  return (
    <div className="wordmark-text" role="img" aria-label={text}>
      <div className="wm-base" aria-hidden="true">{letters(true)}</div>
      <div className="wm-shine" aria-hidden="true">{letters(false)}</div>
    </div>
  );
}

/** Poeira dourada subindo devagar (canvas). Pausa com a aba oculta e respeita "reduzir movimento". */
function Dust() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => { w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const mk = (init: boolean) => ({ x: Math.random() * w, y: init ? Math.random() * h : h + 10, r: 0.6 + Math.random() * 1.9, v: 8 + Math.random() * 22, ph: Math.random() * 6.28, a: 0.15 + Math.random() * 0.45, sw: 6 + Math.random() * 16 });
    resize();
    const N = Math.round(Math.min(70, Math.max(26, (w * h) / 16000)));
    const ps = Array.from({ length: N }, () => mk(true));
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.y -= p.v * dt;
        p.ph += dt * 0.8;
        if (p.y < -10) Object.assign(p, mk(false));
        const x = p.x + Math.sin(p.ph) * p.sw;
        const tw = 0.55 + 0.45 * Math.sin(p.ph * 2.3);
        const g = ctx.createRadialGradient(x, p.y, 0, x, p.y, p.r * 4);
        g.addColorStop(0, `rgba(244,208,104,${p.a * tw})`);
        g.addColorStop(1, "rgba(244,208,104,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, p.y, p.r * 4, 0, 6.2832); ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return <canvas ref={ref} className="fx-dust" aria-hidden="true" />;
}

/** Fundo animado do painel azul: orbes de luz, anéis em órbita, feixe de luz e poeira dourada. */
export function Backdrop() {
  return (
    <div className="fx" aria-hidden="true">
      <i className="fx-orb o1" /><i className="fx-orb o2" /><i className="fx-orb o3" />
      <i className="fx-ring r1" /><i className="fx-ring r2" /><i className="fx-ring r3" />
      <i className="fx-beam" />
      <Dust />
    </div>
  );
}

/** Paralaxe suave do símbolo seguindo o mouse (CSS vars --mx/--my no painel). */
export function useParallax(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(pointer: coarse)").matches) return;
    const mv = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", String(((e.clientX - r.left) / r.width - 0.5) * 2));
      el.style.setProperty("--my", String(((e.clientY - r.top) / r.height - 0.5) * 2));
    };
    const lv = () => { el.style.setProperty("--mx", "0"); el.style.setProperty("--my", "0"); };
    el.addEventListener("mousemove", mv);
    el.addEventListener("mouseleave", lv);
    return () => { el.removeEventListener("mousemove", mv); el.removeEventListener("mouseleave", lv); };
  }, [ref]);
}
