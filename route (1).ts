import { NextResponse } from "next/server";

export const revalidate = 300;

export async function GET() {
  try {
    const response = await fetch("https://api.robinhood.com/rhj/assets", {
      next: { revalidate: 300 },
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Robinhood asset API unavailable" }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" }
    });
  } catch {
    return NextResponse.json({ error: "Failed to load Robinhood Stock Tokens" }, { status: 500 });
  }
}
