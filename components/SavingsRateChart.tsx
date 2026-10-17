import type { SavingsSeries } from "@/lib/reports";

type Props = { series: SavingsSeries };

function shortMonth(month: string): string {
  const [, m] = month.split("-").map(Number);
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TEAL = "#14b8a6";
const TEAL_DARK = "#0f766e";
const RED = "#ef4444";

/**
 * Twelve bars of (income − spending + goal contributions) / income. Goal
 * contributions are the darker base of each positive bar; months that
 * overspent go red below the zero line. The dashed line is the average.
 */
export default function SavingsRateChart({ series }: Props) {
  const { points, avg } = series;
  const W = 640;
  const H = 210;
  const padL = 34;
  const padR = 54; // room for the average label beside the plot
  const padT = 22;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxAbs = Math.max(10, ...points.map((p) => Math.abs(p.rate ?? 0)), Math.abs(avg ?? 0));
  const top = Math.ceil(maxAbs / 10) * 10;
  const hasNeg = points.some((p) => (p.rate ?? 0) < 0);
  const bottom = hasNeg ? -Math.ceil(Math.max(...points.map((p) => -(p.rate ?? 0)), 0) / 10) * 10 : 0;
  const range = top - bottom || 1;
  const y = (v: number) => padT + ((top - v) / range) * innerH;
  const zero = y(0);

  const slot = innerW / Math.max(points.length, 1);
  const barW = Math.min(28, slot * 0.6);
  const ticks = [bottom, 0, top].filter((v, i, arr) => arr.indexOf(v) === i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Monthly savings rate">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-white/10" strokeWidth={t === 0 ? 1 : 0.5} />
          <text x={padL - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="currentColor" className="text-[#5a6380]">
            {t}%
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const cx = padL + slot * i + slot / 2;
        const x = cx - barW / 2;
        const label = p.rate === null ? "–" : `${p.rate > 0 ? "+" : ""}${p.rate.toFixed(0)}%`;
        const title =
          p.rate === null
            ? `${shortMonth(p.month)}: no income recorded`
            : `${shortMonth(p.month)}: ${p.rate.toFixed(1)}% kept — income ${fmt(p.income)} €, spent ${fmt(p.expense)} €, into goals ${fmt(p.goal)} €`;
        return (
          <g key={p.month}>
            <title>{title}</title>
            {p.rate !== null && p.rate >= 0 && (
              <>
                {p.goalShare > 0 && (
                  <rect x={x} y={y(p.goalShare)} width={barW} height={Math.max(zero - y(p.goalShare), 1)} fill={TEAL_DARK} rx={2} />
                )}
                {p.freeShare > 0 && (
                  <rect
                    x={x}
                    y={y(p.rate)}
                    width={barW}
                    height={Math.max(y(p.goalShare) - y(p.rate) - (p.goalShare > 0 ? 2 : 0), 1)}
                    fill={TEAL}
                    fillOpacity={0.55}
                    rx={2}
                  />
                )}
              </>
            )}
            {p.rate !== null && p.rate < 0 && (
              <rect x={x} y={zero} width={barW} height={Math.max(y(p.rate) - zero, 1)} fill={RED} fillOpacity={0.6} rx={2} />
            )}
            <text
              x={cx}
              y={p.rate !== null && p.rate < 0 ? y(p.rate) + 10 : y(Math.max(p.rate ?? 0, 0)) - 4}
              textAnchor="middle"
              fontSize={9}
              fill="currentColor"
              className={p.rate === null ? "text-[#5a6380]" : "text-[#9ca3c0]"}
            >
              {label}
            </text>
            <text x={cx} y={H - 6} textAnchor="middle" fontSize={9} fill="currentColor" className="text-[#5a6380]">
              {shortMonth(p.month)}
            </text>
          </g>
        );
      })}
      {avg !== null && (
        <g>
          <line x1={padL} x2={W - padR} y1={y(avg)} y2={y(avg)} stroke="currentColor" className="text-white/40" strokeWidth={1} strokeDasharray="4 3" />
          <text
            x={W - padR + 6}
            y={y(avg)}
            dominantBaseline="middle"
            textAnchor="start"
            fontSize={9}
            fontWeight={600}
            fill="currentColor"
            className="text-white/70"
          >
            avg {avg.toFixed(0)}%
          </text>
        </g>
      )}
    </svg>
  );
}
