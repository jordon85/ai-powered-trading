"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from "recharts"
import { TrendingUp } from "lucide-react"

interface ChartDataPoint {
  time: string
  timestamp: number
  price: number | null
  predicted: number | null
  upper90: number | null
  lower90: number | null
  upper50: number | null
  lower50: number | null
  pastPredicted?: number | null
  pastActual?: number | null
}

interface PredictionChartProps {
  symbol?: string
}

interface PastPrediction {
  timestamp: number
  predicted_price: number
  actual_price: number | null
  direction_correct: number | null
  horizon: string
}

export function PredictionChart({ symbol = "BTC" }: PredictionChartProps) {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [pastPredictions, setPastPredictions] = useState<PastPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<"full" | "prediction">("full")

  const COINGECKO_IDS: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    SOL: "solana",
    BNB: "binancecoin",
    XRP: "ripple",
    ADA: "cardano",
    DOGE: "dogecoin",
    DOT: "polkadot",
    AVAX: "avalanche-2",
    LINK: "chainlink",
    THETA: "theta-token",
    TDROP: "thetadrop",
  }

  const fetchChartData = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch last 24h of real prices
      const coinId = COINGECKO_IDS[symbol] || "bitcoin"
      const priceResp = await fetch(`/api/crypto/ohlc?id=${coinId}&days=1`)
      const priceData = await priceResp.json()

      // Fetch prediction + history in parallel
      const [predResp, histResp] = await Promise.all([
        fetch("/api/predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        }),
        fetch(`/api/predictions/history?symbol=${symbol}&limit=20`),
      ])
      const predData = await predResp.json()
      const histData = await histResp.json().catch(() => [])

      // Store past predictions for chart overlay
      if (Array.isArray(histData)) {
        setPastPredictions(
          histData
            .filter((r: { backfilled_at: string | null }) => r.backfilled_at)
            .map((r: { predicted_at_ts: number; predicted_price: number; actual_price: number | null; direction_correct: number | null; horizon: string }) => ({
              timestamp: r.predicted_at_ts * 1000,
              predicted_price: r.predicted_price,
              actual_price: r.actual_price,
              direction_correct: r.direction_correct,
              horizon: r.horizon,
            }))
        )
      }

      if (!priceData || !predData || predData.error) {
        setLoading(false)
        return
      }

      // Build chart data from OHLC — use close price
      const points: ChartDataPoint[] = []

      if (Array.isArray(priceData)) {
        // OHLC format: [timestamp, open, high, low, close]
        for (const candle of priceData) {
          const ts = candle[0]
          const close = candle[4] ?? candle[1] // close or open
          points.push({
            time: new Date(ts).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            timestamp: ts,
            price: close,
            predicted: null,
            upper90: null,
            lower90: null,
            upper50: null,
            lower50: null,
          })
        }
      }

      // Add prediction points going forward
      if (predData.predictions) {
        const lastTs = points.length > 0 ? points[points.length - 1].timestamp : Date.now()
        const currentPrice = predData.current_price

        // Current point — bridge between actual and predicted
        points.push({
          time: "Now",
          timestamp: lastTs,
          price: currentPrice,
          predicted: currentPrice,
          upper90: currentPrice,
          lower90: currentPrice,
          upper50: currentPrice,
          lower50: currentPrice,
        })

        // Future prediction points
        const horizonMs: Record<string, number> = {
          "1h": 3600000,
          "6h": 21600000,
          "24h": 86400000,
        }

        for (const [h, pred] of Object.entries(predData.predictions) as [
          string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          any
        ][]) {
          const futureTs = lastTs + (horizonMs[h] || 3600000)
          points.push({
            time: `+${h}`,
            timestamp: futureTs,
            price: null,
            predicted: pred.predicted_price,
            upper90: pred.price_range_90?.[1],
            lower90: pred.price_range_90?.[0],
            upper50: pred.price_range_50?.[1],
            lower50: pred.price_range_50?.[0],
          })
        }
      }

      setChartData(points)
    } catch (err) {
      console.error("Chart data fetch error:", err)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    fetchChartData()
  }, [fetchChartData])

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Price & Prediction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">
            Loading chart...
          </div>
        </CardContent>
      </Card>
    )
  }

  if (chartData.length === 0) {
    return null
  }

  // Find the "Now" index for reference line
  const nowIndex = chartData.findIndex((d) => d.time === "Now")

  // Calculate Y domain with padding
  const allPrices = chartData
    .flatMap((d) => [d.price, d.predicted, d.upper90, d.lower90])
    .filter((v): v is number => v !== null)
  const minY = Math.min(...allPrices)
  const maxY = Math.max(...allPrices)
  const padding = (maxY - minY) * 0.1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
        <p className="font-medium mb-1">{label}</p>
        {payload.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (entry: any) => {
            if (entry.value == null) return null
            return (
              <p key={entry.dataKey} style={{ color: entry.color }}>
                {entry.name}: ${Number(entry.value).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            )
          }
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            {symbol} Price &amp; Prediction
          </CardTitle>
          <div className="inline-flex items-center rounded-full border border-border bg-muted text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode("full")}
              className={`px-2.5 py-1 rounded-full transition-colors ${
                viewMode === "full"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              Full
            </button>
            <button
              type="button"
              onClick={() => setViewMode("prediction")}
              className={`px-2.5 py-1 rounded-full transition-colors ${
                viewMode === "prediction"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              Future
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="gradientPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradientPred" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradientBand90" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minY - padding, maxY + padding]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`
              }
              width={60}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* 90% confidence band (only in full view) */}
            {viewMode === "full" && (
              <>
                <Area
                  type="monotone"
                  dataKey="upper90"
                  stroke="none"
                  fill="transparent"
                  name="Upper 90%"
                  connectNulls={false}
                />
                <Area
                  type="monotone"
                  dataKey="lower90"
                  stroke="none"
                  fill="url(#gradientBand90)"
                  name="Lower 90%"
                  connectNulls={false}
                />
              </>
            )}

            {/* Actual price (only in full view) */}
            {viewMode === "full" && (
              <Area
                type="monotone"
                dataKey="price"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#gradientPrice)"
                name="Price"
                connectNulls={false}
              />
            )}

            {/* Predicted line (always shown) */}
            <Area
              type="monotone"
              dataKey="predicted"
              stroke="#22c55e"
              strokeWidth={2}
              strokeDasharray="6 3"
              fill="url(#gradientPred)"
              name="Predicted"
              connectNulls={false}
            />

            {/* "Now" reference line */}
            {nowIndex >= 0 && (
              <ReferenceLine
                x={chartData[nowIndex].time}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            )}

            {/* Current price dot */}
            {nowIndex >= 0 && chartData[nowIndex].price && (
              <ReferenceDot
                x={chartData[nowIndex].time}
                y={chartData[nowIndex].price!}
                r={4}
                fill="hsl(var(--primary))"
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
            )}

            {/* Past prediction dots overlay (only in full view) */}
            {viewMode === "full" &&
              pastPredictions.map((pp, i) => {
                // Find the closest chart data point by timestamp
                const closest = chartData.reduce((prev, curr) =>
                  Math.abs(curr.timestamp - pp.timestamp) < Math.abs(prev.timestamp - pp.timestamp) ? curr : prev
                )
                if (Math.abs(closest.timestamp - pp.timestamp) > 7200000) return null // skip if >2h off
                return (
                  <ReferenceDot
                    key={`past-pred-${i}`}
                    x={closest.time}
                    y={pp.predicted_price}
                    r={3}
                    fill={pp.direction_correct ? "#22c55e" : "#ef4444"}
                    stroke="hsl(var(--background))"
                    strokeWidth={1.5}
                  />
                )
              })}
          </AreaChart>
        </ResponsiveContainer>
        {viewMode === "full" && pastPredictions.length > 0 && (
          <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              Past prediction (correct direction)
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              Past prediction (wrong direction)
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
