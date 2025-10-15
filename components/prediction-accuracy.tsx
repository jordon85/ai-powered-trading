"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Target,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
} from "lucide-react"

interface HorizonStats {
  total_predictions: number
  mae: number | null
  direction_accuracy: number | null
  range_hit_rate_90: number | null
  avg_return_error_pct: number | null
  best_prediction_error: number | null
  worst_prediction_error: number | null
}

interface AccuracyData {
  symbol: string
  horizons: Record<string, HorizonStats>
  overall: {
    total_evaluated: number
    mae: number | null
    direction_accuracy: number | null
    range_hit_rate_90: number | null
  }
  pending_backfill: number
}

interface PredictionRecord {
  symbol: string
  horizon: string
  predicted_at: string
  current_price: number
  predicted_price: number
  predicted_return_pct: number
  actual_price: number | null
  actual_return_pct: number | null
  absolute_error: number | null
  direction_correct: number | null
  in_range_90: number | null
  backfilled_at: string | null
}

const HORIZON_LABELS: Record<string, string> = {
  "1h": "1 Hour",
  "6h": "6 Hours",
  "24h": "24 Hours",
}

function StatCard({
  label,
  value,
  suffix,
  icon: Icon,
  color,
}: {
  label: string
  value: string | number | null
  suffix?: string
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="p-3 bg-secondary/30 rounded-lg space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        {label}
      </div>
      <div className="text-lg font-bold">
        {value !== null && value !== undefined ? (
          <>
            {value}
            {suffix && <span className="text-xs text-muted-foreground ml-0.5">{suffix}</span>}
          </>
        ) : (
          <span className="text-muted-foreground text-sm">--</span>
        )}
      </div>
    </div>
  )
}

function HorizonAccuracyRow({ horizon, stats }: { horizon: string; stats: HorizonStats }) {
  const dirColor =
    stats.direction_accuracy !== null
      ? stats.direction_accuracy >= 55
        ? "text-green-400"
        : stats.direction_accuracy >= 45
        ? "text-yellow-400"
        : "text-red-400"
      : "text-muted-foreground"

  const rangeColor =
    stats.range_hit_rate_90 !== null
      ? stats.range_hit_rate_90 >= 80
        ? "text-green-400"
        : stats.range_hit_rate_90 >= 60
        ? "text-yellow-400"
        : "text-red-400"
      : "text-muted-foreground"

  return (
    <div className="grid grid-cols-4 gap-2 p-2.5 bg-secondary/20 rounded-lg text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Horizon</div>
        <div className="font-medium">{HORIZON_LABELS[horizon] || horizon}</div>
        <div className="text-[10px] text-muted-foreground">{stats.total_predictions} samples</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">MAE</div>
        <div className="font-medium">
          {stats.mae !== null ? `$${stats.mae.toLocaleString()}` : "--"}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Direction</div>
        <div className={`font-medium ${dirColor}`}>
          {stats.direction_accuracy !== null ? `${stats.direction_accuracy}%` : "--"}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">In Range</div>
        <div className={`font-medium ${rangeColor}`}>
          {stats.range_hit_rate_90 !== null ? `${stats.range_hit_rate_90}%` : "--"}
        </div>
      </div>
    </div>
  )
}

function RecentPredictionRow({ record }: { record: PredictionRecord }) {
  const isBackfilled = record.backfilled_at !== null
  const time = new Date(record.predicted_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
  const date = new Date(record.predicted_at).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })

  return (
    <div className="flex items-center gap-2 p-2 bg-secondary/10 rounded text-xs">
      <div className="w-16 shrink-0">
        <div className="font-medium">{record.symbol}</div>
        <div className="text-[10px] text-muted-foreground">{record.horizon}</div>
      </div>
      <div className="flex-1 flex items-center gap-1.5">
        <span className="text-muted-foreground">${record.current_price.toLocaleString()}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">${record.predicted_price.toLocaleString()}</span>
      </div>
      <div className="w-20 text-right">
        {isBackfilled ? (
          <div className="space-y-0.5">
            <div className="text-muted-foreground">
              Actual: ${record.actual_price?.toLocaleString()}
            </div>
            <div className="flex items-center justify-end gap-1">
              {record.direction_correct ? (
                <CheckCircle2 className="h-3 w-3 text-green-400" />
              ) : (
                <XCircle className="h-3 w-3 text-red-400" />
              )}
              <span
                className={
                  record.direction_correct ? "text-green-400" : "text-red-400"
                }
              >
                ${record.absolute_error?.toFixed(0)}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Pending</span>
          </div>
        )}
      </div>
      <div className="w-14 text-right text-[10px] text-muted-foreground">
        {date}
        <br />
        {time}
      </div>
    </div>
  )
}

export function PredictionAccuracy({ symbol }: { symbol?: string }) {
  const [accuracy, setAccuracy] = useState<AccuracyData | null>(null)
  const [history, setHistory] = useState<PredictionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [backfilling, setBackfilling] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = symbol ? `?symbol=${symbol}` : ""
      const [accResp, histResp] = await Promise.all([
        fetch(`/api/predictions/accuracy${params}`),
        fetch(`/api/predictions/history${params}&limit=10`),
      ])
      const accData = await accResp.json()
      const histData = await histResp.json()

      if (!accData.error) setAccuracy(accData)
      if (Array.isArray(histData)) setHistory(histData)
    } catch {
      // Non-critical
    } finally {
      setLoading(false)
    }
  }, [symbol])

  const handleBackfill = useCallback(async () => {
    setBackfilling(true)
    try {
      await fetch("/api/predictions/backfill", { method: "POST" })
      // Refresh data after backfill
      await fetchData()
    } catch {
      // ignore
    } finally {
      setBackfilling(false)
    }
  }, [fetchData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-backfill on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/predictions/backfill", { method: "POST" }).catch(() => {})
    }, 5000)
    return () => clearTimeout(timer)
  }, [])

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Prediction Accuracy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[100px] flex items-center justify-center text-muted-foreground text-sm">
            Loading accuracy data...
          </div>
        </CardContent>
      </Card>
    )
  }

  const hasData = accuracy && accuracy.overall.total_evaluated > 0
  const hasHistory = history.length > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Prediction Accuracy
          </CardTitle>
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            className="p-1.5 rounded-md hover:bg-secondary transition-colors"
            title="Backfill actual prices for elapsed predictions"
          >
            <RefreshCw
              className={`h-4 w-4 text-muted-foreground ${backfilling ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!hasData && !hasHistory ? (
          <div className="text-center py-6 space-y-2">
            <Target className="h-8 w-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No accuracy data yet</p>
            <p className="text-xs text-muted-foreground">
              Predictions are being logged automatically. Accuracy data will appear
              after predictions are evaluated (1h minimum).
            </p>
            {accuracy && accuracy.pending_backfill > 0 && (
              <p className="text-xs text-primary">
                {accuracy.pending_backfill} predictions awaiting evaluation
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Overall summary cards */}
            {hasData && accuracy && (
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  label="MAE"
                  value={accuracy.overall.mae !== null ? `$${accuracy.overall.mae.toLocaleString()}` : null}
                  icon={Target}
                  color="text-blue-400"
                />
                <StatCard
                  label="Direction"
                  value={accuracy.overall.direction_accuracy}
                  suffix="%"
                  icon={
                    accuracy.overall.direction_accuracy !== null &&
                    accuracy.overall.direction_accuracy >= 50
                      ? TrendingUp
                      : TrendingDown
                  }
                  color={
                    accuracy.overall.direction_accuracy !== null &&
                    accuracy.overall.direction_accuracy >= 50
                      ? "text-green-400"
                      : "text-red-400"
                  }
                />
                <StatCard
                  label="In Range"
                  value={accuracy.overall.range_hit_rate_90}
                  suffix="%"
                  icon={CheckCircle2}
                  color={
                    accuracy.overall.range_hit_rate_90 !== null &&
                    accuracy.overall.range_hit_rate_90 >= 70
                      ? "text-green-400"
                      : "text-yellow-400"
                  }
                />
              </div>
            )}

            {/* Per-horizon breakdown */}
            {hasData && accuracy && Object.keys(accuracy.horizons).length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Per Horizon
                </div>
                {Object.entries(accuracy.horizons).map(([h, stats]) => (
                  <HorizonAccuracyRow key={h} horizon={h} stats={stats} />
                ))}
              </div>
            )}

            {/* Pending indicator */}
            {accuracy && accuracy.pending_backfill > 0 && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1">
                <Clock className="h-3.5 w-3.5" />
                {accuracy.pending_backfill} predictions awaiting evaluation
              </div>
            )}

            {/* Recent predictions log */}
            {hasHistory && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Recent Predictions
                </div>
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {history.map((record, i) => (
                    <RecentPredictionRow key={i} record={record} />
                  ))}
                </div>
              </div>
            )}

            {/* Total evaluated */}
            {hasData && accuracy && (
              <div className="text-center text-[10px] text-muted-foreground">
                Based on {accuracy.overall.total_evaluated} evaluated predictions
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
