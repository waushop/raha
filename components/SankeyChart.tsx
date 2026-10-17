import type { SankeyLayout } from "@/lib/reports";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtShort = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0));

type Props = { layout: SankeyLayout };

/**
 * Pure-SVG three-column flow: income → groups → categories. Nodes are
 * rectangles, links are cubic-bezier ribbons in the group's colour, every
 * shape carries a <title> with the amount and share of income.
 */
export default function SankeyChart({ layout }: Props) {
  const { width, height, nodeWidth, nodes, ribbons } = layout;
  const labelPad = 6;
  // Room for labels outside the left and right columns.
  const padL = 0;
  const padR = 0;
  const groups = nodes.filter((n) => n.column === 1);

  return (
    <div>
      <svg
        viewBox={`${-padL} -4 ${width + padL + padR} ${height + 8}`}
        className="w-full h-auto"
        role="img"
        aria-label="Flow of income into category groups and categories"
      >
        <g>
          {ribbons.map((r, i) => (
            <path key={i} d={r.d} fill={r.color} fillOpacity={0.3} stroke="none">
              <title>{`${labelOf(nodes, r.source)} → ${labelOf(nodes, r.target)}: ${fmt(r.value)} € (${r.pct.toFixed(1)}%)`}</title>
            </path>
          ))}
        </g>
        <g>
          {nodes.map((n) => {
            const labelX = n.column === 2 ? n.x - labelPad : n.x + nodeWidth + labelPad;
            const anchor = n.column === 2 ? "end" : "start";
            const show = n.h >= 9;
            return (
              <g key={n.id}>
                <rect x={n.x} y={n.y} width={nodeWidth} height={Math.max(n.h, 1)} rx={2} fill={n.color} fillOpacity={0.95}>
                  <title>{`${n.label}: ${fmt(n.value)} € (${n.pct.toFixed(1)}%)`}</title>
                </rect>
                {show && (
                  <text
                    x={labelX}
                    y={n.y + n.h / 2}
                    dominantBaseline="middle"
                    textAnchor={anchor}
                    fontSize={11}
                    fontWeight={n.column === 0 ? 700 : 500}
                    fill="currentColor"
                    className="text-[#9ca3c0]"
                    style={{ paintOrder: "stroke", stroke: "var(--bg-card-solid, #141827)", strokeWidth: 3, strokeLinejoin: "round" }}
                  >
                    {n.label}
                    {n.h >= 16 && (
                      <tspan className="text-[#5a6380]" fontSize={9} fontWeight={400} dx={4}>
                        {fmtShort(n.value)}
                      </tspan>
                    )}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {/* Readable legend for small screens: the middle column with amounts. */}
      <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
        {groups.map((g) => (
          <li key={g.id} className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: g.color }} aria-hidden />
            <span className="text-[11px] text-white/80 truncate flex-1">{g.label}</span>
            <span className="text-[10px] font-mono text-[#9ca3c0] tabular-nums shrink-0">{fmtShort(g.value)} €</span>
            <span className="text-[9px] text-[#5a6380] tabular-nums shrink-0 w-8 text-right">{g.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelOf(nodes: SankeyLayout["nodes"], id: string): string {
  return nodes.find((n) => n.id === id)?.label ?? id;
}
