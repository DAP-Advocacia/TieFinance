"use client";
import { useEffect } from "react";

/**
 * Revela cards, painéis e filtros com fade + subida suave quando entram na tela (inclusive ao rolar).
 * Usa data-rv (React não mexe nesse atributo). Sem JS/ com "reduzir movimento" tudo aparece normalmente.
 */
export function useReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const SEL = ".metric,.panel,.filters,.notice";
    const io = new IntersectionObserver(
      (entries) => {
        let n = 0;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.style.setProperty("--d", Math.min(n++, 7) * 70 + "ms");
          el.dataset.rv = "1";
          io.unobserve(el);
        }
      },
      { threshold: 0.05, rootMargin: "0px 0px -3% 0px" },
    );
    const scan = () => {
      root.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
        if (el.dataset.rv !== undefined || el.parentElement?.closest(".metric,.panel")) return;
        el.dataset.rv = "0";
        io.observe(el);
      });
    };
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });
    scan();
    return () => { io.disconnect(); mo.disconnect(); };
  }, [ref]);
}
