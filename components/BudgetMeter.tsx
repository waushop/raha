type Props = {
  total: number;
  budget: number;
  month: string;
};

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function currentDayOfMonth(): number {
  return new Date().getDate();
}

function isCurrentMonth(month: string): boolean {
  const now = new Date();
  return month === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function BudgetMeter({ total, budget, month }: Props) {
  if (budget <= 0) return null;

  const pct = (total / budget) * 100;
  const overBudget = total > budget;
  const remaining = budget - total;
  const usedPct = Math.min(pct, 100);

  // Pace calculation (only for current month)
  const isCurrent = isCurrentMonth(month);
  const totalDays = daysInMonth(month);
  const dayNow = isCurrent ? currentDayOfMonth() : totalDays;
  const monthProgress = dayNow / totalDays;
  const expectedSpend = budget * monthProgress;
  const pace = expectedSpend > 0 ? ((total - expectedSpend) / expectedSpend) * 100 : 0;
  const isAheadOfPace = total > expectedSpend;

  // Color transitions: green -> yellow -> orange -> red
  let barColor = "from-teal-500 to-emerald-400";
  let textColor = "text-teal-400";
  if (pct > 60) { barColor = "from-yellow-500 to-amber-400"; textColor = "text-yellow-400"; }
  if (pct > 80) { barColor = "from-orange-500 to-amber-500"; textColor = "text-orange-400"; }
  if (pct > 95) { barColor = "from-red-500 to-rose-500"; textColor = "text-red-400"; }

  return (
    <div className="card rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${barColor} flex items-center justify-center shadow-lg`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </span>
          <div>
            <h2 className="text-sm font-bold text-white">Eelarve</h2>
            {isCurrent && (
              <p className="text-[9px] text-[#4a5568]">
                Päev {dayNow}/{totalDays}
                {Math.abs(pace) > 3 && (
                  <span className={`ml-1.5 font-bold ${isAheadOfPace ? "text-red-400/60" : "text-teal-400/60"}`}>
                    {isAheadOfPace ? "tempost ees" : "tempost maas"}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <span className={`text-sm font-bold font-mono tabular-nums ${textColor}`}>{Math.min(pct, 999).toFixed(0)}%</span>
          <span className="text-[10px] text-[#4a5568] ml-1">kasutatud</span>
        </div>
      </div>

      {/* Budget bar with pace marker */}
      <div className="relative">
        <div className="h-3 w-full rounded-full overflow-hidden bg-white/5">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-1000 ease-out`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        {/* Pace marker (expected spend position) */}
        {isCurrent && monthProgress < 0.97 && (
          <div
            className="absolute top-0 h-3 w-0.5 bg-white/30 rounded-full"
            style={{ left: `${monthProgress * 100}%` }}
            title={`Oodatav: ${fmt(expectedSpend)} €`}
          />
        )}
      </div>

      <div className="flex justify-between text-xs mt-2">
        <span className="text-[#4a5568] font-mono tabular-nums">{fmt(total)} €</span>
        {overBudget ? (
          <span className="text-red-400 font-bold font-mono tabular-nums">+{fmt(total - budget)} € üle</span>
        ) : (
          <span className="text-[#4a5568] font-mono tabular-nums">{fmt(remaining)} € järel</span>
        )}
        <span className="text-[#8892b0] font-mono tabular-nums">{fmt(budget)} €</span>
      </div>
    </div>
  );
}
