import { NextRequest, NextResponse } from "next/server";

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get("symbol") || "";
    const limit = request.nextUrl.searchParams.get("limit") || "20";
    let url = `${PYTHON_URL}/predictions/history?limit=${limit}`;
    if (symbol) url += `&symbol=${symbol}`;
    const resp = await fetch(url);
    const data = await resp.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Python service unavailable" },
      { status: 503 }
    );
  }
}
