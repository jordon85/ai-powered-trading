"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { fearGreedData, FearGreedData } from "@/lib/mockData"
import { useAutoRefresh } from "@/hooks/useAutoRefresh"

const fetchFearGreed = async (): Promise<FearGreedData> => {
  const res = await fetch("/api/fear-greed", {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 600 },
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => null)
    throw new Error(errorData?.error || `Failed to fetch Fear & Greed index: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()

  return {
    value: data.value,
    classification: data.classification,
    timestamp: new Date(data.timestamp).toISOString(),
  }
}

export function GaugeChart() {
  const [mounted, setMounted] = useState(false)
  const { data, loading, error } = useAutoRefresh(fetchFearGreed, 600000)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  const currentData = data ?? fearGreedData
  const { value, classification, timestamp } = currentData
  const rotation = (value / 100) * 180

  const sweep = (value / 100) * 360

  let gradientColor = "from-red-500 via-yellow-400 to-green-500"
  let classColor = "text-yellow-500"
  let ringColor = "#22c55e"

  if (classification === "Extreme Fear") {
    classColor = "text-red-600"
    ringColor = "#ef4444"
  } else if (classification === "Fear") {
    classColor = "text-orange-500"
    ringColor = "#f97316"
  } else if (classification === "Neutral") {
    classColor = "text-yellow-500"
    ringColor = "#facc15"
  } else if (classification === "Greed") {
    classColor = "text-lime-500"
    ringColor = "#22c55e"
  } else if (classification === "Extreme Greed") {
    classColor = "text-green-600"
    ringColor = "#16a34a"
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Fear &amp; Greed Index</CardTitle>
          <span className={`text-[11px] px-2 py-0.5 rounded-full bg-muted/70 ${classColor}`}>
            {error ? "Fallback" : classification}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        <div className="flex items-center justify-between gap-4">
          {/* Left text block */}
          <div className="flex-1 space-y-1">
            <div className="text-xs text-muted-foreground">Market sentiment</div>
            <div className="text-2xl font-semibold">
              {loading && !data ? "…" : value}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Updated {new Date(timestamp).toLocaleTimeString()}
            </div>
          </div>

          {/* Right circular gauge */}
          <div className="flex-shrink-0">
            <div className="relative w-24 h-24">
              {/* Donut background using conic gradient */}
              <div
                className="w-full h-full rounded-full"
                style={{
                  backgroundImage: `conic-gradient(${ringColor} ${sweep}deg, #1f2937 ${sweep}deg 360deg)`,
                }}
              />
              {/* Inner cut-out */}
              <div className="absolute inset-2 rounded-full bg-background flex items-center justify-center">
                <span className="text-sm font-semibold">{value}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}