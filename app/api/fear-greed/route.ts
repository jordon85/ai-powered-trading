import { NextResponse } from "next/server";

interface FearGreedApiResponse {
  data: {
    value: string;
    value_classification: string;
    timestamp: string;
  }[];
}

export async function GET() {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1&format=json", {
      headers: {
        Accept: "application/json",
      },
      // Cache for 10 minutes at the edge
      next: { revalidate: 600 },
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      return NextResponse.json(
        { error: errorData?.error || `Failed to fetch data: ${res.status} ${res.statusText}` },
        { status: res.status }
      );
    }

    const json: FearGreedApiResponse = await res.json();
    const latest = json.data?.[0];

    if (!latest) {
      return NextResponse.json(
        { error: "No data returned from Fear & Greed API" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      value: Number(latest.value),
      classification: latest.value_classification,
      timestamp: Number(latest.timestamp) * 1000,
    });
  } catch (error) {
    console.error("Error fetching Fear & Greed data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

