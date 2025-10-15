"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import {
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon,
  BrainCircuit,
  RefreshCw,
  Activity,
  Shield,
  BarChart3,
  Info,
  TrendingUp,
  Gauge,
} from "lucide-react"
import { formatCurrency } from "@/lib/mockData"
import { PredictionChart } from "@/components/prediction-chart"
import { PredictionAccuracy } from "@/components/prediction-accuracy"
import { BackgroundBeams } from "@/components/ui/background-beams"

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

interface IndicatorsResponse {
  symbol: string
  current_price: number
  rsi: { value: number; period: number; signal: string }
  macd: { macd_line: number; signal_line: number; histogram: number; signal: string }
  bollinger_bands: {
    upper_band: number
    middle_band: number
    lower_band: number
    band_width: number
    percent_b: number
  }
  momentum: { "7d_pct": number; "14d_pct": number }
  volatility: { "7d_annualized": number; "30d_annualized": number }
  volume: { current_volume: number; avg_volume_7d: number; volume_ratio: number }
  data_points: number
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
  status?: string
}

// ------- Constants -------

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "DOT", "AVAX", "LINK", "THETA", "TDROP"]

const HORIZON_LABELS: Record<string, string> = {
  "1h": "1 Hour",
  "6h": "6 Hours",
  "24h": "24 Hours",
}

// ------- Helpers -------

function TrendBadge({ trend }: { trend: string }) {
  const config = {
    bullish: { class: "bg-green-500/20 text-green-400 border-green-500/30", icon: ArrowUpIcon, label: "Bullish" },
    bearish: { class: "bg-red-500/20 text-red-400 border-red-500/30", icon: ArrowDownIcon, label: "Bearish" },
    neutral: { class: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: MinusIcon, label: "Neutral" },
  }[trend] || { class: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: MinusIcon, label: "Neutral" }

  const Icon = config.icon
  return (
    <Badge className={`${config.class} gap-1 text-sm px-3 py-1`}>
      <Icon className="h-3.5 w-3.5" /> {config.label}
    </Badge>
  )
}

function ConfidenceBar({ confidence, size = "md" }: { confidence: number; size?: "sm" | "md" }) {
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
      <div className={`${size === "sm" ? "h-1.5" : "h-2.5"} bg-secondary rounded-full overflow-hidden`}>
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  )
}

function RangeVisualization({
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
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="relative h-4 bg-secondary/60 rounded-full overflow-hidden">
        <div className="absolute inset-0 bg-primary/10 rounded-full" />
        {/* Current price marker */}
        <div className="absolute top-0 h-full w-0.5 bg-muted-foreground/60 z-10" style={{ left: `${currPct}%` }} title="Current" />
        {/* Predicted marker */}
        <div className="absolute top-0 h-full w-2 bg-primary rounded-full z-20 shadow-md" style={{ left: `calc(${predPct}% - 4px)` }} title="Predicted" />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{formatCurrency(low, "USD", decimals)}</span>
        <span className="text-primary font-medium">Predicted: {formatCurrency(predicted, "USD", decimals)}</span>
        <span>{formatCurrency(high, "USD", decimals)}</span>
      </div>
    </div>
  )
}

function SignalBadge({ signal, label }: { signal: string; label?: string }) {
  const isPositive = signal === "bullish" || signal === "overbought"
  const isNegative = signal === "bearish" || signal === "oversold"
  const color = isPositive ? "text-green-400" : isNegative ? "text-red-400" : "text-yellow-400"
  return (
    <span className={`text-xs font-medium ${color}`}>
      {label || signal}
    </span>
  )
}

// ------- Main Page -------

export default function AIPage() {
  const [symbol, setSymbol] = useState("BTC")
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null)
  const [indicators, setIndicators] = useState<IndicatorsResponse | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [intervalMode, setIntervalMode] = useState<"50" | "90">("90")
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [serviceOnline, setServiceOnline] = useState(true)

  const fetchAll = useCallback(async (sym: string) => {
    setLoading(true)
    try {
      const [predResp, indResp, modelResp] = await Promise.allSettled([
        fetch("/api/predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym }),
        }).then((r) => r.json()),
        fetch(`/api/predictions/indicators?symbol=${sym}`).then((r) => r.json()),
        fetch("/api/predictions/model-info").then((r) => r.json()),
      ])

      if (predResp.status === "fulfilled" && !predResp.value.error && predResp.value.predictions) {
        setPrediction(predResp.value)
        setServiceOnline(true)
      } else if (predResp.status === "rejected") {
        setServiceOnline(false)
      }
      if (indResp.status === "fulfilled" && !indResp.value.error) {
        setIndicators(indResp.value)
      }
      if (modelResp.status === "fulfilled" && !modelResp.value.error && !modelResp.value.status) {
        setModelInfo(modelResp.value)
      }
      setLastUpdated(new Date())
    } catch {
      setServiceOnline(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll(symbol)
  }, [symbol, fetchAll])

  // Auto-refresh 60s
  useEffect(() => {
    const interval = setInterval(() => fetchAll(symbol), 60000)
    return () => clearInterval(interval)
  }, [symbol, fetchAll])

  const decimals = prediction && prediction.current_price < 1 ? 6 : 2

  return (
    <main className="min-h-screen py-6 relative">
      <BackgroundBeams />
      <div className="container mx-auto max-w-[1400px] px-4 relative z-10">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BrainCircuit className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">AI Predictions</h1>
              <p className="text-sm text-muted-foreground">
                Multi-horizon price predictions powered by RandomForest ML model
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Service status */}
            <div className="flex items-center gap-2 text-xs">
              <div className={`h-2 w-2 rounded-full ${serviceOnline ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              <span className="text-muted-foreground">{serviceOnline ? "Service Online" : "Service Offline"}</span>
            </div>
            <button
              onClick={() => fetchAll(symbol)}
              disabled={loading}
              className="p-2 rounded-md hover:bg-secondary transition-colors"
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Symbol selector bar */}
        <div className="flex flex-wrap gap-2 mb-6">
          {SYMBOLS.map((sym) => (
            <button
              key={sym}
              onClick={() => setSymbol(sym)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                symbol === sym
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-card border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {sym}
            </button>
          ))}
        </div>

        {!serviceOnline && (
          <Card className="mb-6 border-red-500/30">
            <CardContent className="py-6 text-center">
              <p className="text-red-400 font-medium">Python AI Service is not running</p>
              <p className="text-sm text-muted-foreground mt-1">
                Start it with: <code className="bg-secondary px-2 py-0.5 rounded">cd python_service && uvicorn main:app --port 8000</code>
              </p>
            </CardContent>
          </Card>
        )}

        {prediction && prediction.predictions && (
          <div className={`space-y-6 transition-opacity duration-200 ${loading ? "opacity-60" : "opacity-100"}`}>
            {loading && (
              <div className="text-center text-xs text-muted-foreground py-1">
                <RefreshCw className="h-3 w-3 animate-spin inline mr-1.5" />
                Updating {symbol}...
              </div>
            )}
            {/* Row 1: Price header + trend */}
            <Card>
              <CardContent className="py-5">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="text-sm text-muted-foreground">{symbol} Current Price</div>
                      <div className="text-3xl font-bold">{formatCurrency(prediction.current_price, "USD", decimals)}</div>
                    </div>
                    <TrendBadge trend={prediction.trend} />
                  </div>

                  {/* Quick horizon summary */}
                  <div className="flex gap-4">
                    {Object.entries(prediction.predictions).map(([h, pred]) => {
                      const pct = pred.predicted_return_pct
                      return (
                        <div key={h} className="text-center">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{h}</div>
                          <div className={`text-lg font-bold ${pct > 0 ? "text-green-400" : pct < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                            {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Main row: Chart + indicators (left) | Predictions (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {/* Left: Chart + 4 indicator cards - fills the gap below graph */}
              <div className="lg:col-span-2 flex flex-col gap-4 min-h-0">
                <PredictionChart symbol={symbol} />

                {/* Indicator cards in 2x2 grid directly below chart */}
                {indicators && indicators.rsi && indicators.macd && indicators.bollinger_bands && (
                  <div className="grid grid-cols-2 gap-4">
                    {/* RSI */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Gauge className="h-4 w-4 text-primary" />
                          RSI ({indicators.rsi.period})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-3">
                          <span className="text-2xl font-bold">{indicators.rsi.value}</span>
                          <SignalBadge signal={indicators.rsi.signal} />
                        </div>
                        <div className="mt-2 h-2 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 rounded-full" style={{ width: `${indicators.rsi.value}%` }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                          <span>Oversold (30)</span>
                          <span>Overbought (70)</span>
                        </div>
                      </CardContent>
                    </Card>

                    {/* MACD */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Activity className="h-4 w-4 text-primary" />
                          MACD
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-3">
                          <span className="text-2xl font-bold">{indicators.macd.histogram.toFixed(2)}</span>
                          <SignalBadge signal={indicators.macd.signal} />
                        </div>
                        <div className="mt-2 space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">MACD Line</span>
                            <span>{indicators.macd.macd_line.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Signal Line</span>
                            <span>{indicators.macd.signal_line.toFixed(2)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Bollinger Bands */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-primary" />
                          Bollinger Bands
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-3">
                          <span className="text-2xl font-bold">{(indicators.bollinger_bands.percent_b * 100).toFixed(0)}%</span>
                          <span className="text-xs text-muted-foreground">%B position</span>
                        </div>
                        <div className="mt-2 space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Upper</span>
                            <span>{formatCurrency(indicators.bollinger_bands.upper_band, "USD", decimals)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Middle</span>
                            <span>{formatCurrency(indicators.bollinger_bands.middle_band, "USD", decimals)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Lower</span>
                            <span>{formatCurrency(indicators.bollinger_bands.lower_band, "USD", decimals)}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Volatility & Momentum */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Shield className="h-4 w-4 text-primary" />
                          Volatility & Momentum
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-0.5">Volatility (annualized)</div>
                            <div className="flex gap-3">
                              <div>
                                <span className="text-base font-bold">{((indicators.volatility?.["7d_annualized"] ?? 0) * 100).toFixed(1)}%</span>
                                <span className="text-[10px] text-muted-foreground ml-1">7d</span>
                              </div>
                              <div>
                                <span className="text-base font-bold">{((indicators.volatility?.["30d_annualized"] ?? 0) * 100).toFixed(1)}%</span>
                                <span className="text-[10px] text-muted-foreground ml-1">30d</span>
                              </div>
                            </div>
                          </div>
                          <Separator className="my-1.5" />
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-0.5">Momentum</div>
                            <div className="flex gap-3">
                              <div>
                                <span className={`text-sm font-bold ${(indicators.momentum?.["7d_pct"] ?? 0) > 0 ? "text-green-400" : "text-red-400"}`}>
                                  {(indicators.momentum?.["7d_pct"] ?? 0) > 0 ? "+" : ""}{(indicators.momentum?.["7d_pct"] ?? 0).toFixed(2)}%
                                </span>
                                <span className="text-[10px] text-muted-foreground ml-1">7d</span>
                              </div>
                              <div>
                                <span className={`text-sm font-bold ${(indicators.momentum?.["14d_pct"] ?? 0) > 0 ? "text-green-400" : "text-red-400"}`}>
                                  {(indicators.momentum?.["14d_pct"] ?? 0) > 0 ? "+" : ""}{(indicators.momentum?.["14d_pct"] ?? 0).toFixed(2)}%
                                </span>
                                <span className="text-[10px] text-muted-foreground ml-1">14d</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>

              {/* Right: Horizon predictions - full height */}
              <Card className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-medium flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-primary" />
                      Predictions
                    </CardTitle>
                    <div className="flex bg-secondary/50 rounded-md p-0.5">
                      {(["50", "90"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setIntervalMode(mode)}
                          className={`px-2.5 py-0.5 text-xs rounded transition-colors ${
                            intervalMode === mode
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {mode}%
                        </button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 flex-1">
                  {Object.entries(prediction.predictions).map(([h, pred]) => {
                    const range = intervalMode === "50" ? pred.price_range_50 : pred.price_range_90
                    const pct = pred.predicted_return_pct
                    return (
                      <div key={h} className="p-3 bg-secondary/30 rounded-lg space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-sm">{HORIZON_LABELS[h] || h}</span>
                          <span className={`text-xs font-medium ${pct > 0 ? "text-green-400" : pct < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                            {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                          </span>
                        </div>
                        <div className="text-xl font-bold">
                          {formatCurrency(pred.predicted_price, "USD", decimals)}
                        </div>
                        <RangeVisualization
                          low={range[0]}
                          high={range[1]}
                          predicted={pred.predicted_price}
                          current={prediction.current_price}
                          label={`${intervalMode}% prediction interval`}
                        />
                        <ConfidenceBar confidence={pred.confidence} size="sm" />
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </div>

            {/* Row 3: Prediction Accuracy */}
            <PredictionAccuracy symbol={symbol} />

            {/* Row 4: Volume + Model Transparency */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Volume Analysis */}
              {indicators?.volume && typeof indicators.volume.current_volume === "number" && indicators.volume.current_volume > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Volume Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-xs text-muted-foreground">Current 24h</div>
                        <div className="text-lg font-bold">${(indicators.volume.current_volume / 1e9).toFixed(2)}B</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">7d Average</div>
                        <div className="text-lg font-bold">${(indicators.volume.avg_volume_7d / 1e9).toFixed(2)}B</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Vol Ratio</div>
                        <div className={`text-lg font-bold ${indicators.volume.volume_ratio > 1.2 ? "text-green-400" : indicators.volume.volume_ratio < 0.8 ? "text-red-400" : ""}`}>
                          {indicators.volume.volume_ratio.toFixed(2)}x
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Model Transparency */}
              {modelInfo && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Info className="h-4 w-4 text-primary" />
                      Model Transparency
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Model</span>
                        <span>RandomForest</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Version</span>
                        <span>{modelInfo.version}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Samples</span>
                        <span>{modelInfo.total_training_samples?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Features</span>
                        <span>{modelInfo.features?.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Validation</span>
                        <span>TimeSeriesSplit</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Target</span>
                        <span>log return</span>
                      </div>
                      {modelInfo.horizon_metrics && Object.entries(modelInfo.horizon_metrics).map(([h, m]) => (
                        <div key={h} className="flex justify-between">
                          <span className="text-muted-foreground">R² ({h})</span>
                          <span className={m.cv_r2 < 0 ? "text-yellow-400" : "text-green-400"}>
                            {m.cv_r2?.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-3 pt-2 border-t border-border">
                      Trained: {modelInfo.trained_at ? new Date(modelInfo.trained_at).toLocaleString() : "N/A"}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Last updated */}
            {lastUpdated && (
              <div className="text-center text-xs text-muted-foreground py-2">
                Last updated: {lastUpdated.toLocaleTimeString()} · Auto-refreshes every 60s
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
