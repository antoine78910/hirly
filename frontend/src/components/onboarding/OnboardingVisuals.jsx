import { useEffect, useState } from "react";
import {
  motion,
  animate,
  useMotionValue,
  useSpring,
  useTransform,
  useMotionValueEvent,
} from "framer-motion";
import { Gem } from "lucide-react";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { ob } from "./onboardingTheme";

const EASE_OUT = [0.4, 0, 0.2, 1];
const EASE_SMOOTH = [0.16, 1, 0.3, 1];

const CHART_COPY = {
  en: {
    interviewRateLabel: "Your interview rate",
    interviewRateCaption: (brand) =>
      `${brand} makes it easy to apply to more of the right jobs, increasing interviews.`,
    compareOwn: "On your own",
    compareWith: (brand) => `With ${brand}`,
    compareCaption: (brand) =>
      `${brand} makes it easy to apply to more of the right jobs, increasing interviews.`,
    jobOffersAxis: "# of Job Offers",
    month2: "Month 2",
    month6: "Month 6",
    traditionalSearch: "Traditional Job Search",
    longTermCaption: (brand) =>
      `80% of ${brand} users significantly increased job offers in 6 months.`,
  },
  fr: {
    interviewRateLabel: "Votre taux d'entretiens",
    interviewRateCaption: (brand) =>
      `${brand} vous aide à postuler plus facilement aux bonnes offres, et à obtenir plus d'entretiens.`,
    compareOwn: "Tout seul",
    compareWith: (brand) => `Avec ${brand}`,
    compareCaption: (brand) =>
      `${brand} vous aide à postuler plus facilement aux bonnes offres, et à obtenir plus d'entretiens.`,
    jobOffersAxis: "Nombre d'offres",
    month2: "Mois 2",
    month6: "Mois 6",
    traditionalSearch: "Recherche classique",
    longTermCaption: (brand) =>
      `80 % des utilisateurs ${brand} ont nettement augmenté leurs offres en 6 mois.`,
  },
};

function chartCopy(lang) {
  return CHART_COPY[lang === "fr" ? "fr" : "en"];
}

function ChartCard({ label, children, caption }) {
  return (
    <div className={`${ob.card} p-3 sm:p-4`}>
      {label ? <p className={`text-xs ${ob.muted} mb-2 font-medium`}>{label}</p> : null}
      {children}
      {caption ? (
        <p className={`text-center text-[11px] sm:text-xs ${ob.muted} mt-2 leading-snug`}>{caption}</p>
      ) : null}
    </div>
  );
}

const RATE_CURVE = "M 48 120 Q 120 108 168 72 T 264 32";
const RATE_FILL = `${RATE_CURVE} L 264 136 L 48 136 Z`;
const RATE_POINTS = [
  { cx: 48, cy: 120, delay: 0.2 },
  { cx: 120, cy: 100, delay: 0.55 },
  { cx: 168, cy: 72, delay: 0.9 },
];
const DIAMOND_DELAY = 1.3;
const RATE_END = { x: 264, y: 32 };

export function InterviewRateChart({ lang = "en" }) {
  const copy = chartCopy(lang);
  return (
    <ChartCard label={copy.interviewRateLabel}>
      <svg viewBox="0 0 320 160" className="w-full max-h-[22dvh] sm:max-h-[26dvh] h-auto" aria-hidden>
        <defs>
          <linearGradient id="rateFillLight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[40, 80, 120].map((y, i) => (
          <motion.line
            key={`h-${y}`}
            x1="24"
            y1={y}
            x2="296"
            y2={y}
            stroke="#E4E4E7"
            strokeDasharray="4 4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: i * 0.04 }}
          />
        ))}
        {[72, 136, 200, 264].map((x, i) => (
          <motion.line
            key={`v-${x}`}
            x1={x}
            y1="24"
            x2={x}
            y2="136"
            stroke="#E4E4E7"
            strokeDasharray="4 4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: 0.1 + i * 0.04 }}
          />
        ))}

        <motion.line
          x1="24"
          y1="136"
          x2="296"
          y2="136"
          stroke="#A1A1AA"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45 }}
        />

        <motion.path
          d={RATE_CURVE}
          fill="none"
          stroke="#7C3AED"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.25, ease: EASE_OUT, delay: 0.15 }}
        />

        <motion.path
          d={RATE_FILL}
          fill="url(#rateFillLight)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, delay: 0.95, ease: EASE_OUT }}
        />

        {RATE_POINTS.map(({ cx, cy, delay }) => (
          <motion.circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r="5"
            fill="#7C3AED"
            stroke="#fff"
            strokeWidth="2"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, delay, ease: EASE_OUT }}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          />
        ))}

        <g transform={`translate(${RATE_END.x}, ${RATE_END.y})`}>
          <motion.g
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.18, 1], opacity: 1 }}
            transition={{
              scale: { duration: 0.45, delay: DIAMOND_DELAY, ease: EASE_OUT, times: [0, 0.65, 1] },
              opacity: { duration: 0.15, delay: DIAMOND_DELAY },
            }}
          >
            <circle cx="0" cy="0" r="14" fill="#7C3AED" />
            <foreignObject x="-10" y="-10" width="20" height="20">
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Gem size={14} color="#fff" strokeWidth={2.5} />
              </div>
            </foreignObject>
          </motion.g>
        </g>
      </svg>

      <motion.p
        className={`text-center text-xs sm:text-sm ${ob.muted} mt-4 leading-relaxed`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 1.65 }}
      >
        {copy.interviewRateCaption(BRAND.NAME)}
      </motion.p>
    </ChartCard>
  );
}

const OWN_TARGET_PCT = 5;
const SWIIPR_TARGET_X = 2;
const SWIIPR_START_X = 1;
/** Max column height (px) inside the track — scales visually via transform */
const OWN_BAR_PX = 44;
const SWIIPR_BAR_PX = 104;
const SWIIPR_SCALE_AT_1X = OWN_BAR_PX / SWIIPR_BAR_PX;

function formatMultiplierLabel(value) {
  const clamped = Math.min(SWIIPR_TARGET_X, Math.max(SWIIPR_START_X, value));
  if (clamped >= 1.95) return "2x";
  return `${clamped.toFixed(1)}x`;
}

export function Compare2xChart({ lang = "en" }) {
  const copy = chartCopy(lang);
  const ownTarget = useMotionValue(0);
  const swiiprMultiplier = useMotionValue(SWIIPR_START_X);
  const ownMotion = useSpring(ownTarget, { stiffness: 85, damping: 20, mass: 0.5 });

  const [ownLabel, setOwnLabel] = useState(0);
  const [swiiprLabel, setSwiiprLabel] = useState("1.0x");
  const [endReveal, setEndReveal] = useState(false);

  useEffect(() => {
    ownTarget.set(0);
    swiiprMultiplier.set(SWIIPR_START_X);
    setSwiiprLabel("1.0x");
    setEndReveal(false);

    const ownAnim = animate(ownTarget, OWN_TARGET_PCT, {
      duration: 2,
      delay: 0.2,
      ease: EASE_SMOOTH,
    });
    const swiiprAnim = animate(swiiprMultiplier, SWIIPR_TARGET_X, {
      duration: 2.6,
      delay: 0.55,
      ease: EASE_SMOOTH,
      onUpdate: (value) => setSwiiprLabel(formatMultiplierLabel(value)),
      onComplete: () => {
        setSwiiprLabel("2x");
        setEndReveal(true);
      },
    });

    return () => {
      ownAnim.stop();
      swiiprAnim.stop();
    };
  }, [ownTarget, swiiprMultiplier]);

  useMotionValueEvent(ownMotion, "change", (v) => {
    setOwnLabel(Math.round(v));
  });

  const ownScale = useTransform(ownMotion, [0, OWN_TARGET_PCT], [0, 1]);
  const swiiprScale = useTransform(
    swiiprMultiplier,
    [SWIIPR_START_X, SWIIPR_TARGET_X],
    [SWIIPR_SCALE_AT_1X, 1],
  );
  const ownLabelBottom = useTransform(ownScale, (s) => 8 + (OWN_BAR_PX * s) / 2);
  const swiiprLabelBottom = useTransform(swiiprScale, (s) => 8 + (SWIIPR_BAR_PX * s) / 2);

  return (
    <div className={`${ob.card} mx-auto w-full max-w-lg p-5 sm:p-6`}>
      <div className="flex items-end justify-center gap-6 sm:gap-12">
        <div className="flex flex-1 max-w-[9.5rem] flex-col items-center sm:max-w-[11rem]">
          <p className="mb-4 text-center text-sm font-medium text-zinc-600 sm:text-base">{copy.compareOwn}</p>
          <div className="relative flex h-48 w-full flex-col justify-end overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 p-2 sm:h-60 sm:p-2.5">
            <motion.div
              className="w-full origin-bottom rounded-xl bg-zinc-300 will-change-transform"
              style={{ height: OWN_BAR_PX, scaleY: ownScale }}
            />
            <motion.span
              className="absolute left-1/2 -translate-x-1/2 translate-y-1/2 text-sm font-bold tabular-nums text-zinc-700 sm:text-base"
              style={{ bottom: ownLabelBottom }}
            >
              {ownLabel}%
            </motion.span>
          </div>
        </div>

        <div className="flex flex-1 max-w-[9.5rem] flex-col items-center sm:max-w-[11rem]">
          <p className={`mb-4 text-center text-sm font-semibold sm:text-base ${ob.accent}`}>{copy.compareWith(BRAND.NAME)}</p>
          <div className="relative flex h-48 w-full flex-col justify-end overflow-hidden rounded-2xl border border-violet-200 bg-zinc-50 p-2 shadow-sm sm:h-60 sm:p-2.5">
            <motion.div
              className="gradient-linkedin w-full origin-bottom rounded-xl will-change-transform"
              style={{ height: SWIIPR_BAR_PX, scaleY: swiiprScale }}
            />

            {!endReveal ? (
              <motion.span
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 translate-y-1/2 font-display text-xl font-black leading-none tabular-nums text-white drop-shadow-sm sm:text-3xl"
                style={{ bottom: swiiprLabelBottom }}
              >
                {swiiprLabel}
              </motion.span>
            ) : (
              <motion.div
                className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-col items-center gap-1.5 sm:inset-x-2.5 sm:bottom-2.5 sm:gap-2"
                initial={{ opacity: 0, scale: 0.88, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE_SMOOTH }}
              >
                <span className="rounded-xl bg-white/95 p-1.5 shadow-sm sm:p-2">
                  <Logo size={28} className="sm:hidden" />
                  <Logo size={36} className="hidden sm:block" />
                </span>
                <span className="font-display text-xl font-black leading-none tabular-nums text-white sm:text-3xl">
                  2x
                </span>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      <motion.p
        className={`mt-5 text-center text-xs leading-snug sm:mt-6 sm:text-sm ${ob.muted}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: endReveal ? 1 : 0, y: endReveal ? 0 : 6 }}
        transition={{ duration: 0.55, ease: EASE_SMOOTH, delay: endReveal ? 0.12 : 0 }}
      >
        {copy.compareCaption(BRAND.NAME)}
      </motion.p>
    </div>
  );
}

const LT_AXIS = { left: 40, right: 280, top: 36, bottom: 148 };
const LT_START = { x: 56, y: 128 };
const LT_SWIIPR_END = { x: 264, y: 48 };
const LT_TRAD_END = { x: 264, y: 118 };
const LT_SWIIPR_CURVE = `M ${LT_START.x} ${LT_START.y} Q 120 118 180 95 T ${LT_SWIIPR_END.x} ${LT_SWIIPR_END.y}`;
const LT_TRAD_CURVE = `M ${LT_START.x} ${LT_START.y} Q 140 125 200 120 T ${LT_TRAD_END.x} ${LT_TRAD_END.y}`;
const LT_SWIIPR_FILL = `${LT_SWIIPR_CURVE} L ${LT_SWIIPR_END.x} ${LT_AXIS.bottom} L ${LT_START.x} ${LT_AXIS.bottom} Z`;

function LongTermBrandBadge({ x, y, delay }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay, ease: EASE_OUT }}
      >
        <foreignObject x="-42" y="-14" width="84" height="22">
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "5px",
              width: "100%",
              height: "100%",
            }}
          >
            <img
              src={`${process.env.PUBLIC_URL || ""}/logo.png`}
              alt=""
              width="16"
              height="16"
              style={{ display: "block", objectFit: "contain" }}
            />
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#7C3AED", lineHeight: 1 }}>
              {BRAND.NAME}
            </span>
          </div>
        </foreignObject>
      </motion.g>
    </g>
  );
}

export function LongTermResultsChart({ lang = "en" }) {
  const copy = chartCopy(lang);
  const gridY = [60, 92, 124];
  const gridX = [56, 160, 264];

  return (
    <ChartCard>
      <svg viewBox="0 0 320 196" className="w-full max-h-[24dvh] sm:max-h-[28dvh] h-auto" aria-hidden>
        <defs>
          <linearGradient id="ltFillLight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.38" />
            <stop offset="45%" stopColor="#7C3AED" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
          </linearGradient>
        </defs>

        <text x={LT_AXIS.left} y={24} fill="#52525B" fontSize="11" fontWeight="600">
          {copy.jobOffersAxis}
        </text>

        {gridY.map((y, i) => (
          <motion.line
            key={`gy-${y}`}
            x1={LT_AXIS.left}
            y1={y}
            x2={LT_AXIS.right}
            y2={y}
            stroke="#E4E4E7"
            strokeDasharray="4 4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: i * 0.05 }}
          />
        ))}
        {gridX.map((x, i) => (
          <motion.line
            key={`gx-${x}`}
            x1={x}
            y1={LT_AXIS.top}
            x2={x}
            y2={LT_AXIS.bottom}
            stroke="#E4E4E7"
            strokeDasharray="4 4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: 0.1 + i * 0.05 }}
          />
        ))}

        <motion.line
          x1={LT_AXIS.left}
          y1={LT_AXIS.top}
          x2={LT_AXIS.left}
          y2={LT_AXIS.bottom}
          stroke="#A1A1AA"
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45 }}
        />
        <motion.line
          x1={LT_AXIS.left}
          y1={LT_AXIS.bottom}
          x2={LT_AXIS.right}
          y2={LT_AXIS.bottom}
          stroke="#A1A1AA"
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, delay: 0.08 }}
        />

        <text x={LT_START.x - 8} y={168} fill="#71717A" fontSize="11" textAnchor="middle">
          {copy.month2}
        </text>
        <text x={LT_SWIIPR_END.x} y={168} fill="#71717A" fontSize="11" textAnchor="middle">
          {copy.month6}
        </text>

        <motion.path
          d={LT_SWIIPR_CURVE}
          fill="none"
          stroke="#7C3AED"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.35, ease: EASE_OUT }}
        />

        <motion.path
          d={LT_SWIIPR_FILL}
          fill="url(#ltFillLight)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.95, ease: EASE_OUT }}
        />

        <motion.path
          d={LT_TRAD_CURVE}
          fill="none"
          stroke="#EF4444"
          strokeWidth="2.5"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0.5 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.1, delay: 0.55, ease: EASE_OUT }}
        />

        <motion.circle
          cx={LT_START.x}
          cy={LT_START.y}
          r="6"
          fill="#7C3AED"
          stroke="#fff"
          strokeWidth="2"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          style={{ transformOrigin: `${LT_START.x}px ${LT_START.y}px` }}
        />

        <motion.circle
          cx={LT_SWIIPR_END.x}
          cy={LT_SWIIPR_END.y}
          r="6"
          fill="#7C3AED"
          stroke="#fff"
          strokeWidth="2"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, delay: 1.2 }}
          style={{ transformOrigin: `${LT_SWIIPR_END.x}px ${LT_SWIIPR_END.y}px` }}
        />

        <motion.circle
          cx={LT_TRAD_END.x}
          cy={LT_TRAD_END.y}
          r="6"
          fill="#EF4444"
          stroke="#fff"
          strokeWidth="2"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35, delay: 1.45 }}
          style={{ transformOrigin: `${LT_TRAD_END.x}px ${LT_TRAD_END.y}px` }}
        />

        <motion.text
          x={168}
          y={140}
          fill="#EF4444"
          fontSize="10"
          textAnchor="middle"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 1.55 }}
        >
          {copy.traditionalSearch}
        </motion.text>

        <LongTermBrandBadge x={LT_SWIIPR_END.x} y={LT_SWIIPR_END.y - 18} delay={1.25} />
      </svg>

      <motion.p
        className={`text-center text-xs sm:text-sm ${ob.muted} mt-4 leading-relaxed`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 1.7 }}
      >
        {copy.longTermCaption(BRAND.NAME)}
      </motion.p>
    </ChartCard>
  );
}

export function InterviewTargetDashes({ count, max = 8 }) {
  return (
    <div className="flex gap-1.5 sm:gap-2 mt-3 sm:mt-4">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 sm:h-2 flex-1 rounded-full transition-colors ${i < count ? "gradient-linkedin" : "bg-zinc-200"}`}
        />
      ))}
    </div>
  );
}
