import { NextResponse } from "next/server";

export const revalidate = 15;

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, "");

  if (!clean) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  try {
    const response = await fetch(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(clean)}`, {
      next: { revalidate: 15 },
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Quote unavailable" }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" }
    });
  } catch {
    return NextResponse.json({ error: "Failed to load quote" }, { status: 500 });
  }
}
