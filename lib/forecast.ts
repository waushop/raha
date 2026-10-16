// End-of-month forecast.
//
//   forecast = spent so far
//            + recurring items from last month not entered yet (bills still to come)
//            + average variable spend per day × days remaining
//
// "Variable" means non-recurring rows; the per-day rate comes from the last
// six full months so a mortgage paid on the 2nd doesn't make day 2 look like
// a disaster. With no history at all we fall back to a straight-line
// projection of this month's total.
export type ForecastInput = {
  spent: number;
  dayOfMonth: number;
  totalDays: number;
  missingRecurring: number;
  variableDaily: number | null;
};

export type Forecast = {
  predicted: number;
  spent: number;
  dueRecurring: number;
  variableRemaining: number;
  method: "model" | "linear";
};

export function forecastMonth(i: ForecastInput): Forecast {
  const remaining = Math.max(0, i.totalDays - i.dayOfMonth);
  if (i.variableDaily === null) {
    const linear = i.dayOfMonth > 0 ? (i.spent / i.dayOfMonth) * i.totalDays : i.spent;
    return { predicted: linear, spent: i.spent, dueRecurring: 0, variableRemaining: Math.max(0, linear - i.spent), method: "linear" };
  }
  const variableRemaining = i.variableDaily * remaining;
  return {
    predicted: i.spent + i.missingRecurring + variableRemaining,
    spent: i.spent,
    dueRecurring: i.missingRecurring,
    variableRemaining,
    method: "model",
  };
}

/** Mean per-day variable spend across months, each weighted by its own length. */
export function variableDailyRate(months: Array<{ total: number; days: number }>): number | null {
  if (months.length === 0) return null;
  const perDay = months.map((m) => (m.days > 0 ? m.total / m.days : 0));
  return perDay.reduce((s, v) => s + v, 0) / perDay.length;
}
