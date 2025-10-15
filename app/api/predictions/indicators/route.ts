import { NextRequest, NextResponse } from "next/server";

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get("symbol") || "BTC";
    const resp = await fetch(
      `${PYTHON_URL}/market/indicators?symbol=${symbol}`
    );
    const data = await resp.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Python service unavailable" },
      { status: 503 }
    );
  }
}
