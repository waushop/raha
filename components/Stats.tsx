const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  totalExpenses: number;
  totalMonths: number;
  totalAmount: number;
  avgPerExpense: number;
  mostExpensiveMonth: { month: string; total: number } | null;
  cheapestMonth: { month: string; total: number } | null;
};

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

export default function Stats({ totalExpenses, totalMonths, totalAmount, avgPerExpense, mostExpensiveMonth, cheapestMonth }: Props) {
  return (
    <div className="card rounded-2xl p-5">
      <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        All-time stats
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="surface p-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Total tracked</p>
          <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(totalAmount)} €</p>
        </div>
        <div className="surface p-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Expenses</p>
          <p className="text-lg font-bold text-white tabular-nums">{totalExpenses}</p>
        </div>
        <div className="surface p-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Avg per expense</p>
          <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(avgPerExpense)} €</p>
        </div>
        <div className="surface p-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Months tracked</p>
          <p className="text-lg font-bold text-white tabular-nums">{totalMonths}</p>
        </div>
        {mostExpensiveMonth && (
          <div className="surface p-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Most expensive</p>
            <p className="text-sm font-bold text-red-400 font-mono tabular-nums">{fmt(mostExpensiveMonth.total)} €</p>
            <p className="text-[9px] text-[#5a6380] capitalize">{monthLabel(mostExpensiveMonth.month)}</p>
          </div>
        )}
        {cheapestMonth && (
          <div className="surface p-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Cheapest</p>
            <p className="text-sm font-bold text-teal-400 font-mono tabular-nums">{fmt(cheapestMonth.total)} €</p>
            <p className="text-[9px] text-[#5a6380] capitalize">{monthLabel(cheapestMonth.month)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
