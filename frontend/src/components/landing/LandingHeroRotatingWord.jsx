import { useEffect, useMemo, useRef } from "react";
import {
  getLandingHeroJobLabel,
  getLandingHeroRotatingLabels,
} from "../../lib/landingHeroCopy";

const WIDTH_BUFFER = 6;

const isMobileViewport = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

/** Shorter words stay tight on the right; longer words (e.g. alternance) get side breathing room. */
function getSlotMargins(width, widths) {
  const minW = Math.min(...widths);
  const maxW = Math.max(...widths);
  const baseMl = isMobileViewport() ? 5 : 8;

  if (maxW <= minW) return { ml: baseMl, mr: 0 };

  const ratio = (width - minW) / (maxW - minW);
  const maxPull = isMobileViewport() ? 10 : 14;
  const mr = Math.round(-maxPull * (1 - ratio));
  const ml = ratio >= 0.85
    ? Math.round(baseMl + 4 + ratio * 6)
    : baseMl;

  return { ml, mr };
}

/**
 * Client-only animated word cycle for the landing hero (ported from EE NewHeroAnimatedWord).
 * Words are ordered short → long; width and margins animate per word to limit layout jumps.
 */
export default function LandingHeroRotatingWord({ lang = "fr", contractType = null }) {
  const wordTrackRef = useRef(null);
  const wordWrapperRef = useRef(null);
  const tlRef = useRef(null);

  const labels = useMemo(() => {
    const base = getLandingHeroRotatingLabels(lang);
    if (!base.length) return [getLandingHeroJobLabel(lang, null)];
    return [...base, base[0]];
  }, [lang]);

  const initialLabel = useMemo(() => {
    if (contractType) return getLandingHeroJobLabel(lang, contractType);
    return labels[0] ?? getLandingHeroJobLabel(lang, null);
  }, [contractType, lang, labels]);

  useEffect(() => {
    const track = wordTrackRef.current;
    const wrapper = wordWrapperRef.current;
    if (!track || !wrapper) return;

    const scaledMargin = (index, widths) => getSlotMargins(widths[index] ?? 0, widths);

    const applySlot = (index, widths, itemHeight) => {
      const w = Math.ceil(widths[index] ?? 0) + WIDTH_BUFFER;
      const m = scaledMargin(index, widths);
      wrapper.style.width = `${w}px`;
      wrapper.style.height = `${itemHeight}px`;
      wrapper.style.marginLeft = `${m.ml}px`;
      wrapper.style.marginRight = `${m.mr}px`;
    };

    const build = () => {
      try {
        const firstChild = track.children[0];
        if (!firstChild) return;

        wrapper.style.display = "inline-block";
        wrapper.style.verticalAlign = "baseline";
        wrapper.style.width = "auto";
        wrapper.style.minWidth = "0";

        const children = Array.from(track.children);
        const measureEl = firstChild.cloneNode(false);
        measureEl.className = firstChild.className;
        measureEl.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap;";
        wrapper.appendChild(measureEl);

        const widths = children.map((el) => {
          measureEl.textContent = el.textContent;
          return measureEl.offsetWidth || measureEl.getBoundingClientRect().width || 0;
        });

        wrapper.removeChild(measureEl);
        const itemHeight =
          Math.max(
            ...children.map(
              (el) => el.offsetHeight || el.getBoundingClientRect().height || 0
            ),
            firstChild.getBoundingClientRect().height
          ) || 0;

        if (itemHeight === 0 || widths.every((w) => w === 0)) return;

        applySlot(0, widths, itemHeight);

        if (!window.__hirly_gsap) return;

        const gsap = window.__hirly_gsap;
        gsap.set(track, { y: 0, willChange: "transform" });

        if (tlRef.current) {
          tlRef.current.kill();
          tlRef.current = null;
        }

        const slide = 0.6;
        const pause = 0.5;
        const ease = "power2.inOut";
        const stepCount = labels.length - 1;

        const slotTween = (index) => {
          const m = scaledMargin(index, widths);
          return {
            width: Math.ceil(widths[index] ?? 0) + WIDTH_BUFFER,
            marginLeft: `${m.ml}px`,
            marginRight: `${m.mr}px`,
            duration: slide,
            ease,
          };
        };

        const tl = gsap.timeline({ repeat: -1 });

        for (let step = 1; step <= stepCount; step += 1) {
          tl.to(track, { y: -itemHeight * step, duration: slide, ease, delay: step === 1 ? 3 : 0 })
            .to(wrapper, slotTween(step), "<")
            .to({}, { duration: pause });
        }

        tl.set(track, { y: 0 }).set(wrapper, {
          width: Math.ceil(widths[0] ?? 0) + WIDTH_BUFFER,
          marginLeft: `${scaledMargin(0, widths).ml}px`,
          marginRight: `${scaledMargin(0, widths).mr}px`,
        });

        tlRef.current = tl;
      } catch {
        // Animation is non-critical.
      }
    };

    let cancelled = false;
    let rafId1;
    let rafId2;

    (async () => {
      try {
        const mod = await import("gsap");
        if (cancelled) return;
        window.__hirly_gsap = mod?.default ?? mod;
        build();
      } catch {
        // GSAP failed to load — static first label remains visible.
      }
    })();

    try {
      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(build);
      });
    } catch {
      // ignore
    }

    const onResize = () => {
      try {
        build();
      } catch {
        // ignore
      }
    };

    window.addEventListener("resize", onResize);
    document.fonts?.ready?.then(() => {
      if (!cancelled) build();
    });

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      if (rafId1) cancelAnimationFrame(rafId1);
      if (rafId2) cancelAnimationFrame(rafId2);
      if (tlRef.current) tlRef.current.kill();
    };
  }, [labels]);

  return (
    <span
      ref={wordWrapperRef}
      className="relative inline-block shrink-0 align-baseline h-[1.05em] min-w-[3ch] overflow-hidden whitespace-nowrap text-violet-500 translate-y-[0.02em]"
      aria-label={initialLabel}
    >
      <div ref={wordTrackRef} className="leading-[1]">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`} className="block">
            {label}
          </span>
        ))}
      </div>
    </span>
  );
}
