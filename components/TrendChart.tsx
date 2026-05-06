type DataPoint = { month: string; total: number };

type Props = {
  data: DataPoint[];
  currentMonth: string;
};

function shortMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
  return label.replace(".", "").slice(0, 3);
}

const fmt = (n: number) =>
  n >= 1000
    ? `${(n / 1000).toFixed(1)}k`
    : n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function TrendChart({ data, currentMonth }: Props) {
  if (data.length < 2) return null;

  const maxTotal = Math.max(...data.map((d) => d.total));
  const minTotal = Math.min(...data.map((d) => d.total));
  const avg = data.reduce((s, d) => s + d.total, 0) / data.length;
  const padding = (maxTotal - minTotal) * 0.15 || 100;
  const chartMin = Math.max(0, minTotal - padding);
  const chartMax = maxTotal + padding;
  const range = chartMax - chartMin || 1;

  const chartW = 540;
  const chartH = 120;
  const padX = 30;
  const padTop = 28;
  const padBot = 22;
  const innerW = chartW - padX * 2;
  const innerH = chartH - padTop - padBot;

  function yPos(val: number) {
    return padTop + innerH - ((val - chartMin) / range) * innerH;
  }

  const points = data.map((d, i) => ({
    x: padX + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
    y: yPos(d.total),
    ...d,
  }));

  const avgY = yPos(avg);

  // Smooth curve
  function smoothPath(pts: typeof points): string {
    if (pts.length < 2) return "";
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  const linePath = smoothPath(points);
  const areaPath = `${linePath} L${points[points.length - 1].x},${chartH - padBot} L${points[0].x},${chartH - padBot} Z`;

  // Current month stats
  const currentData = data.find(d => d.month === currentMonth);
  const prevData = data.length >= 2 ? data[data.length - 2] : null;
  const diffFromAvg = currentData ? ((currentData.total - avg) / avg) * 100 : 0;

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </span>
        <h2 className="text-sm font-bold text-white">Trend</h2>
        <span className="text-[10px] text-[#5a6380] font-medium ml-auto">{data.length} kuud</span>
      </div>

      {/* Quick insight */}
      <div className="flex items-center gap-3 mb-3 ml-10">
        <span className="text-[10px] text-[#5a6380]">
          Keskmine: <span className="font-mono text-[#9ca3c0] font-semibold">{fmt(avg)} €</span>
        </span>
        {currentData && Math.abs(diffFromAvg) > 1 && (
          <span className={`text-[10px] font-bold ${diffFromAvg > 0 ? "text-red-400/60" : "text-teal-400/60"}`}>
            {diffFromAvg > 0 ? "+" : ""}{diffFromAvg.toFixed(0)}% vs keskmine
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="trendLineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>

        {/* Average line */}
        <line
          x1={padX}
          y1={avgY}
          x2={chartW - padX}
          y2={avgY}
          stroke="rgba(45, 212, 191, 0.2)"
          strokeWidth="1"
          strokeDasharray="6 4"
        />
        <text x={chartW - padX + 4} y={avgY + 3} fill="rgba(45, 212, 191, 0.4)" fontSize="8" fontFamily="ui-monospace, monospace">
          avg
        </text>

        {/* Area fill */}
        <path d={areaPath} fill="url(#trendAreaGrad)" />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="url(#trendLineGrad)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points + labels */}
        {points.map((p) => {
          const isCurrent = p.month === currentMonth;
          return (
            <g key={p.month}>
              {isCurrent && (
                <>
                  <circle cx={p.x} cy={p.y} r="12" fill="#ec4899" opacity="0.08" />
                  <circle cx={p.x} cy={p.y} r="8" fill="#ec4899" opacity="0.12" />
                </>
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={isCurrent ? 4.5 : 2.5}
                fill={isCurrent ? "#ec4899" : "#8b5cf6"}
                stroke="#1a1a2e"
                strokeWidth="2"
              />
              <text
                x={p.x}
                y={p.y - 10}
                textAnchor="middle"
                fill={isCurrent ? "#ffffff" : "rgba(255,255,255,0.3)"}
                fontSize="9"
                fontWeight={isCurrent ? "700" : "500"}
                fontFamily="ui-monospace, monospace"
              >
                {fmt(p.total)}
              </text>
              <text
                x={p.x}
                y={chartH - 6}
                textAnchor="middle"
                fill={isCurrent ? "#ec4899" : "rgba(255,255,255,0.2)"}
                fontSize="9"
                fontWeight={isCurrent ? "700" : "400"}
                style={{ textTransform: "capitalize" }}
              >
                {shortMonth(p.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
