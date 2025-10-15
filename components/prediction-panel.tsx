"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon,
  BrainCircuit,
  ChevronDown,
  RefreshCw,
  Info,
} from "lucide-react"
import { formatCurrency } from "@/lib/mockData"

// ------- Types -------

interface HorizonPrediction {
  predicted_price: number
  price_range_90: [number, number]
  price_range_50: [number, number]
  predicted_return_pct: number
  confidence: number
  cv_r2: number
}

interface PredictionResponse {
  symbol: string
  current_price: number
  predictions: Record<string, HorizonPrediction>
  trend: "bullish" | "bearish" | "neutral"
  model: {
    name: string
    version: string
    target: string
    horizons: string[]
    trained_at: string
  }
  features_used: number
  error?: string
}

interface ModelInfo {
  version: string
  trained_at: string
  target: string
  horizons: string[]
  horizon_metrics: Record<string, { cv_r2: number; cv_mae: number }>
  symbols: string[]
  features: string[]
  total_training_samples: number
  pipeline_steps: string[]
}

// ------- Constants -------

const SUPPORTED_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "DOT", "AVAX", "LINK", "THETA", "TDROP"]

const HORIZON_LABELS: Record<string, string> = {
  "1h": "1 Hour",
  "6h": "6 Hours",
  "24h": "24 Hours",
}

// ------- Sub-components -------

function TrendBadge({ trend }: { trend: string }) {
  if (trend === "bullish") {
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
        <ArrowUpIcon className="h-3 w-3" /> Bullish
      </Badge>
    )
  }
  if (trend === "bearish") {
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1">
        <ArrowDownIcon className="h-3 w-3" /> Bearish
      </Badge>
    )
  }
  return (
    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1">
      <MinusIcon className="h-3 w-3" /> Neutral
    </Badge>
  )
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  let color = "bg-red-500"
  if (pct >= 50) color = "bg-green-500"
  else if (pct >= 20) color = "bg-yellow-500"

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Confidence</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  )
}

function RangeBar({
  low,
  high,
  predicted,
  current,
  label,
}: {
  low: number
  high: number
  predicted: number
  current: number
  label: string
}) {
  const range = high - low
  if (range === 0) return null

  const predPct = Math.min(100, Math.max(0, ((predicted - low) / range) * 100))
  const currPct = Math.min(100, Math.max(0, ((current - low) / range) * 100))
  const decimals = current < 1 ? 4 : current < 100 ? 2 : 0

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
      </div>
      <div className="relative h-3 bg-secondary/60 rounded-full overflow-hidden">
        {/* Range fill */}
        <div className="absolute inset-0 bg-primary/15 rounded-full" />
        {/* Current price marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-muted-foreground/50 z-10"
          style={{ left: `${currPct}%` }}
        />
        {/* Predicted marker */}
        <div
          className="absolute top-0 h-full w-1.5 bg-primary rounded-full z-20"
          style={{ left: `${predPct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{formatCurrency(low, "USD", decimals)}</span>
        <span>{formatCurrency(high, "USD", decimals)}</span>
      </div>
    </div>
  )
}

function HorizonCard({
  horizon,
  prediction,
  currentPrice,
  intervalMode,
}: {
  horizon: string
  prediction: HorizonPrediction
  currentPrice: number
  intervalMode: "50" | "90"
}) {
  const range =
    intervalMode === "50" ? prediction.price_range_50 : prediction.price_range_90
  const decimals = currentPrice < 1 ? 6 : 2
  const changePct = prediction.predicted_return_pct
  const isPositive = changePct > 0

  return (
    <div className="space-y-3 p-3 bg-secondary/30 rounded-lg">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {HORIZON_LABELS[horizon] || horizon}
        </span>
        <span
          className={`text-xs font-medium ${
            isPositive ? "text-green-400" : changePct < 0 ? "text-red-400" : "text-muted-foreground"
          }`}
        >
          {isPositive ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
      </div>

      <div className="text-xl font-bold">
        {formatCurrency(prediction.predicted_price, "USD", decimals)}
      </div>

      <RangeBar
        low={range[0]}
        high={range[1]}
        predicted={prediction.predicted_price}
        current={currentPrice}
        label={`${intervalMode}% interval`}
      />

      <ConfidenceBar confidence={prediction.confidence} />
    </div>
  )
}

function ModelDetailsPanel({ modelInfo }: { modelInfo: ModelInfo | null }) {
  if (!modelInfo) return null

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-2">
        <Info className="h-3 w-3" />
        Model Details
        <ChevronDown className="h-3 w-3" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 p-3 bg-secondary/20 rounded-lg text-xs space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Model</span>
            <span>RandomForest</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span>{modelInfo.version}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Training Samples</span>
            <span>{modelInfo.total_training_samples?.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Features</span>
            <span>{modelInfo.features?.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Validation</span>
            <span>TimeSeriesSplit (5-fold)</span>
          </div>
          {modelInfo.horizon_metrics &&
            Object.entries(modelInfo.horizon_metrics).map(([h, m]) => (
              <div key={h} className="flex justify-between">
                <span className="text-muted-foreground">R² ({h})</span>
                <span className={m.cv_r2 < 0 ? "text-yellow-400" : "text-green-400"}>
                  {m.cv_r2?.toFixed(4)}
                </span>
              </div>
            ))}
          <div className="text-[10px] text-muted-foreground pt-1 border-t border-border">
            Trained: {modelInfo.trained_at ? new Date(modelInfo.trained_at).toLocaleString() : "N/A"}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ------- Main Component -------

export function PredictionPanel() {
  const [selectedSymbol, setSelectedSymbol] = useState("BTC")
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intervalMode, setIntervalMode] = useState<"50" | "90">("90")
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchPrediction = useCallback(async (symbol: string) => {
    setLoading(true)
    setError(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      const data = await resp.json()
      if (data.error) {
        // Show error but keep stale prediction visible
        setError(data.error)
      } else {
        setPrediction(data)
        setError(null)
        setLastUpdated(new Date())
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Request timed out. The API may be rate-limited — try again in a few seconds.")
      } else {
        setError("Python service unavailable. Start it with: uvicorn main:app")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchModelInfo = useCallback(async () => {
    try {
      const resp = await fetch("/api/predictions/model-info")
      const data = await resp.json()
      if (!data.error) setModelInfo(data)
    } catch {
      // Non-critical, ignore
    }
  }, [])

  useEffect(() => {
    fetchPrediction(selectedSymbol)
    fetchModelInfo()
  }, [selectedSymbol, fetchPrediction, fetchModelInfo])

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => fetchPrediction(selectedSymbol), 60000)
    return () => clearInterval(interval)
  }, [selectedSymbol, fetchPrediction])

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            AI Predictions
          </CardTitle>
          <button
            onClick={() => fetchPrediction(selectedSymbol)}
            disabled={loading}
            className="p-1.5 rounded-md hover:bg-secondary transition-colors"
          >
            <RefreshCw className={`h-4 w-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Symbol selector */}
        <div className="flex flex-wrap gap-1.5 pt-2">
          {SUPPORTED_SYMBOLS.map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedSymbol(sym)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                selectedSymbol === sym
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {sym}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <div className="text-center py-6">
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ensure the Python service is running on port 8000
            </p>
          </div>
        ) : loading && !prediction ? (
          <div className="text-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Fetching prediction...</p>
          </div>
        ) : prediction && prediction.predictions ? (
          <>
            {/* Header: Symbol + Current Price + Trend */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Current Price</div>
                <div className="text-2xl font-bold">
                  {formatCurrency(
                    prediction.current_price,
                    "USD",
                    prediction.current_price < 1 ? 4 : 2
                  )}
                </div>
              </div>
              <TrendBadge trend={prediction.trend} />
            </div>

            {/* Interval toggle */}
            <div className="flex items-center gap-2 justify-end">
              <span className="text-xs text-muted-foreground">Interval:</span>
              <div className="flex bg-secondary/50 rounded-md p-0.5">
                <button
                  onClick={() => setIntervalMode("50")}
                  className={`px-2.5 py-0.5 text-xs rounded transition-colors ${
                    intervalMode === "50"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  50%
                </button>
                <button
                  onClick={() => setIntervalMode("90")}
                  className={`px-2.5 py-0.5 text-xs rounded transition-colors ${
                    intervalMode === "90"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  90%
                </button>
              </div>
            </div>

            {/* Horizon cards */}
            <Tabs defaultValue="1h" className="w-full">
              <TabsList className="w-full">
                {Object.keys(prediction.predictions).map((h) => (
                  <TabsTrigger key={h} value={h} className="flex-1">
                    {h}
                  </TabsTrigger>
                ))}
              </TabsList>
              {Object.entries(prediction.predictions).map(([h, pred]) => (
                <TabsContent key={h} value={h}>
                  <HorizonCard
                    horizon={h}
                    prediction={pred}
                    currentPrice={prediction.current_price}
                    intervalMode={intervalMode}
                  />
                </TabsContent>
              ))}
            </Tabs>

            {/* All horizons summary */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {Object.entries(prediction.predictions).map(([h, pred]) => {
                const pct = pred.predicted_return_pct
                return (
                  <div key={h} className="p-2 bg-secondary/20 rounded-lg">
                    <div className="text-[10px] text-muted-foreground uppercase">
                      {h}
                    </div>
                    <div
                      className={`text-sm font-bold ${
                        pct > 0 ? "text-green-400" : pct < 0 ? "text-red-400" : "text-muted-foreground"
                      }`}
                    >
                      {pct > 0 ? "+" : ""}
                      {pct.toFixed(2)}%
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Model details collapsible */}
            <ModelDetailsPanel modelInfo={modelInfo} />

            {/* Last updated */}
            {lastUpdated && (
              <div className="text-center text-[10px] text-muted-foreground">
                Updated {lastUpdated.toLocaleTimeString()}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
