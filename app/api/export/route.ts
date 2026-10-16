import { NextRequest, NextResponse } from "next/server";
import { exportCsv } from "@/app/actions";
import { isAuthenticated } from "@/lib/auth";
import { isValidMonth } from "@/lib/months";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month") ?? undefined;
  const year = searchParams.get("year") ?? undefined;
  if (month !== undefined && !isValidMonth(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  if (year !== undefined && !/^\d{4}$/.test(year)) return NextResponse.json({ error: "year must be YYYY" }, { status: 400 });

  const csv = await exportCsv(month, year);
  const filename = month ? `expenses-${month}.csv` : year ? `expenses-${year}.csv` : "expenses.csv";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
