import { NextRequest, NextResponse } from "next/server";
import { exportCsv } from "@/app/actions";
import { isAuthenticated } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month") ?? undefined;
  const year = searchParams.get("year") ?? undefined;

  const csv = await exportCsv(month, year);
  const filename = month ? `kulud-${month}.csv` : year ? `kulud-${year}.csv` : "kulud.csv";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
