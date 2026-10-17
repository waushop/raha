import { ArrowDown, ArrowUp, Calendar, Repeat, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Insight = {
  icon: LucideIcon;
  text: string;
  type: "info" | "warning" | "success";
};

type Props = {
  thisTotal: number;
  prevTotal: number;
  avgMonthly: number;
  recurringCount: number;
  thisCount: number;
  daysLeft: number;
  predicted: number;
};

export default function Insights({ thisTotal, prevTotal, avgMonthly, recurringCount, thisCount, daysLeft, predicted }: Props) {
  const insights: Insight[] = [];

  // Spending pace
  if (thisTotal > 0 && avgMonthly > 0) {
    const ratio = thisTotal / avgMonthly;
    if (ratio > 1.2) {
      insights.push({ icon: TrendingUp, text: `Spending ${((ratio - 1) * 100).toFixed(0)}% above your average this month`, type: "warning" });
    } else if (ratio < 0.8) {
      insights.push({ icon: TrendingDown, text: `Spending ${((1 - ratio) * 100).toFixed(0)}% below average — nice!`, type: "success" });
    }
  }

  // vs previous month
  if (prevTotal > 0 && thisTotal > 0) {
    const diff = ((thisTotal - prevTotal) / prevTotal) * 100;
    if (Math.abs(diff) > 15) {
      insights.push({
        icon: diff > 0 ? ArrowUp : ArrowDown,
        text: `${Math.abs(diff).toFixed(0)}% ${diff > 0 ? "more" : "less"} than last month so far`,
        type: diff > 0 ? "warning" : "success",
      });
    }
  }

  // Predicted overshoot
  if (predicted > avgMonthly * 1.3 && avgMonthly > 0) {
    insights.push({ icon: TriangleAlert, text: `On track to spend ${((predicted / avgMonthly - 1) * 100).toFixed(0)}% more than usual`, type: "warning" });
  }

  // Missing recurring
  if (recurringCount > 0 && thisCount === 0) {
    insights.push({ icon: Repeat, text: `${recurringCount} recurring expenses haven't been added yet`, type: "info" });
  }

  // End of month
  if (daysLeft <= 3 && daysLeft > 0 && thisTotal > 0) {
    insights.push({ icon: Calendar, text: `${daysLeft} day${daysLeft > 1 ? "s" : ""} left in the month`, type: "info" });
  }

  // Nothing to show
  if (insights.length === 0) return null;

  const colorMap = {
    info: "border-blue-500/10 bg-blue-500/5",
    warning: "border-amber-500/10 bg-amber-500/5",
    success: "border-teal-500/10 bg-teal-500/5",
  };

  return (
    <div className="space-y-2">
      {insights.slice(0, 3).map((insight, i) => (
        <div key={i} className={`card rounded-xl px-4 py-2.5 flex items-center gap-3 border ${colorMap[insight.type]}`}>
          <insight.icon size={16} className="shrink-0 text-[#9ca3c0]" />
          <span className="text-xs text-white/80">{insight.text}</span>
        </div>
      ))}
    </div>
  );
}
