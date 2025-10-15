"use client"

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ArrowUpIcon,
  ArrowDownIcon,
  MinusIcon,
  BrainCircuit,
  RefreshCw,
  ExternalLink,
  Globe,
  Github,
  Twitter,
  Activity,
  Gauge,
  TrendingUp,
} from "lucide-react"
import { formatCurrency } from "@/lib/mockData"

// Symbols our AI model supports
const AI_SUPPORTED = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "DOT", "AVAX", "LINK", "THETA", "TDROP"])

interface CoinData {
  id: string;
  symbol: string;
  name: string;
  image: { thumb: string; small: string; large: string };
  market_data: {
    current_price: { usd: number; eur: number; gbp: number };
    market_cap: { usd: number };
    total_volume: { usd: number };
    price_change_percentage_24h: number;
    price_change_percentage_7d: number;
    price_change_percentage_30d: number;
    high_24h?: { usd: number };
    low_24h?: { usd: number };
    circulating_supply?: number;
    total_supply?: number;
    market_cap_rank?: number;
  };
  description: { en: string };
  links: {
    homepage: string[];
    blockchain_site: string[];
    official_forum_url: string[];
    chat_url: string[];
    announcement_url: string[];
    twitter_screen_name: string;
    facebook_username: string;
    telegram_channel_identifier: string;
    subreddit_url: string;
    repos_url: { github: string[] };
  };
  platforms: Record<string, string>;
  categories: string[];
}

interface HorizonPrediction {
  predicted_price: number;
  price_range_90: [number, number];
  price_range_50: [number, number];
  predicted_return_pct: number;
  confidence: number;
  cv_r2: number;
}

interface PredictionData {
  symbol: string;
  current_price: number;
  predictions: Record<string, HorizonPrediction>;
  trend: string;
  model: { version: string; trained_at: string };
  error?: string;
}

interface IndicatorsData {
  rsi?: { value: number; signal: string };
  macd?: { histogram: number; signal: string };
  bollinger_bands?: { percent_b: number };
  momentum?: { "7d_pct": number; "14d_pct": number };
  volatility?: { "7d_annualized": number; "30d_annualized": number };
  error?: string;
}

interface CoinDetailsDrawerProps {
  coinId: string | null;
  onClose: () => void;
}

// ---------- Sub-components ----------

function PctBadge({ value }: { value?: number }) {
  const safe = value ?? 0
  const color = safe >= 0 ? "text-green-400" : "text-red-400"
  const Icon = safe >= 0 ? ArrowUpIcon : ArrowDownIcon
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(safe).toFixed(2)}%
    </span>
  )
}

function TrendBadge({ trend }: { trend: string }) {
  const cfg: Record<string, { cls: string; Icon: typeof MinusIcon; label: string }> = {
    bullish: { cls: "bg-green-500/20 text-green-400 border-green-500/30", Icon: ArrowUpIcon, label: "Bullish" },
    bearish: { cls: "bg-red-500/20 text-red-400 border-red-500/30", Icon: ArrowDownIcon, label: "Bearish" },
    neutral: { cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", Icon: MinusIcon, label: "Neutral" },
  }
  const { cls, Icon, label } = cfg[trend] || cfg.neutral
  return (
    <Badge className={`${cls} gap-1`}>
      <Icon className="h-3 w-3" /> {label}
    </Badge>
  )
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const color = pct >= 50 ? "bg-green-500" : pct >= 20 ? "bg-yellow-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-7 text-right">{pct}%</span>
    </div>
  )
}

// ---------- Main Component ----------

export function CoinDetailsDrawer({ coinId, onClose }: CoinDetailsDrawerProps) {
  const [coinData, setCoinData] = useState<CoinData | null>(null);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [indicators, setIndicators] = useState<IndicatorsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!coinId) return;

    setCoinData(null);
    setPrediction(null);
    setIndicators(null);
    setLoading(true);

    const fetchCoinData = async () => {
      try {
        const response = await fetch(`/api/coin/${coinId}`);
        const data = await response.json();
        setCoinData(data);

        // Fetch AI predictions if symbol is supported
        const sym = data?.symbol?.toUpperCase();
        if (sym && AI_SUPPORTED.has(sym)) {
          setAiLoading(true);
          const [predResp, indResp] = await Promise.allSettled([
            fetch("/api/predictions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ symbol: sym }),
            }).then(r => r.json()),
            fetch(`/api/predictions/indicators?symbol=${sym}`).then(r => r.json()),
          ]);
          if (predResp.status === "fulfilled" && !predResp.value.error && predResp.value.predictions) {
            setPrediction(predResp.value);
          }
          if (indResp.status === "fulfilled" && !indResp.value.error) {
            setIndicators(indResp.value);
          }
          setAiLoading(false);
        }
      } catch (error) {
        console.error('Error fetching coin data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCoinData();
  }, [coinId]);

  const sym = coinData?.symbol?.toUpperCase() || "";
  const hasAI = AI_SUPPORTED.has(sym);
  const price = coinData?.market_data?.current_price?.usd || 0;
  const decimals = price < 1 ? 4 : 2;

  return (
    <Sheet open={!!coinId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        aria-label="Coin details"
        className="w-full sm:max-w-[580px] overflow-y-auto p-0"
      >
        {loading ? (
          <div className="flex flex-col h-full">
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
              <SheetTitle className="sr-only">Loading coin details</SheetTitle>
            </SheetHeader>
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </div>
        ) : !coinData ? (
          <div className="flex flex-col h-full text-muted-foreground">
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
              <SheetTitle className="sr-only">Coin not found</SheetTitle>
            </SheetHeader>
            <div className="flex-1 flex items-center justify-center">
              Coin not found
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Hero header */}
            <div className="p-6 pb-4 border-b border-border bg-card/50">
              <SheetHeader className="mb-4">
                <div className="flex items-center gap-4">
                  <img
                    src={coinData.image?.large || coinData.image?.small || coinData.image?.thumb || `https://ui-avatars.com/api/?name=${coinData.symbol}&background=random`}
                    alt={coinData.name}
                    className="w-14 h-14 rounded-full ring-2 ring-border"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <SheetTitle className="text-2xl font-bold">{coinData.name}</SheetTitle>
                      {coinData.market_data?.market_cap_rank && (
                        <Badge variant="outline" className="text-[10px]">
                          #{coinData.market_data.market_cap_rank}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground uppercase text-sm">{coinData.symbol}</p>
                  </div>
                  {prediction && <TrendBadge trend={prediction.trend} />}
                </div>
              </SheetHeader>

              {/* Price + changes */}
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold">
                    {formatCurrency(price, "USD", decimals)}
                  </div>
                  {coinData.market_data && (
                    <div className="flex gap-3 mt-1">
                      <div className="text-xs">
                        <span className="text-muted-foreground">24h </span>
                        <PctBadge value={coinData.market_data.price_change_percentage_24h} />
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">7d </span>
                        <PctBadge value={coinData.market_data.price_change_percentage_7d} />
                      </div>
                      <div className="text-xs">
                        <span className="text-muted-foreground">30d </span>
                        <PctBadge value={coinData.market_data.price_change_percentage_30d} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground space-y-0.5">
                  <div>EUR: {formatCurrency(coinData.market_data.current_price.eur, "EUR", decimals)}</div>
                  <div>GBP: {formatCurrency(coinData.market_data.current_price.gbp, "GBP", decimals)}</div>
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-px bg-border">
              <div className="bg-card p-3 text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Market Cap</div>
                <div className="text-sm font-bold mt-1">
                  ${(coinData.market_data.market_cap.usd / 1e6).toFixed(1)}M
                </div>
              </div>
              <div className="bg-card p-3 text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">24h Volume</div>
                <div className="text-sm font-bold mt-1">
                  ${(coinData.market_data.total_volume.usd / 1e6).toFixed(1)}M
                </div>
              </div>
              <div className="bg-card p-3 text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">24h Range</div>
                <div className="text-sm font-bold mt-1">
                  {coinData.market_data.high_24h?.usd && coinData.market_data.low_24h?.usd
                    ? `${formatCurrency(coinData.market_data.low_24h.usd, "USD", decimals)} - ${formatCurrency(coinData.market_data.high_24h.usd, "USD", decimals)}`
                    : "N/A"}
                </div>
              </div>
            </div>

            {/* Main content */}
            <div className="p-4 space-y-4">
              {/* AI Predictions section */}
              {hasAI && (
                <Card className="border-primary/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <BrainCircuit className="h-4 w-4 text-primary" />
                      AI Price Predictions
                      {aiLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {prediction && prediction.predictions ? (
                      <div className="space-y-3">
                        {Object.entries(prediction.predictions).map(([h, pred]) => {
                          const pct = pred.predicted_return_pct;
                          const range90 = pred.price_range_90;
                          const rangeSpan = range90[1] - range90[0];
                          const predPos = rangeSpan > 0
                            ? Math.min(100, Math.max(0, ((pred.predicted_price - range90[0]) / rangeSpan) * 100))
                            : 50;

                          return (
                            <div key={h} className="p-3 bg-secondary/30 rounded-lg">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded">
                                    {h}
                                  </span>
                                  <span className="text-base font-bold">
                                    {formatCurrency(pred.predicted_price, "USD", decimals)}
                                  </span>
                                </div>
                                <span className={`text-xs font-bold ${pct > 0 ? "text-green-400" : pct < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                                  {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                                </span>
                              </div>

                              {/* Range bar */}
                              <div className="relative h-2.5 bg-secondary/60 rounded-full mb-1.5">
                                <div className="absolute inset-0 bg-primary/10 rounded-full" />
                                <div
                                  className="absolute top-0 h-full w-1.5 bg-primary rounded-full shadow-sm"
                                  style={{ left: `calc(${predPos}% - 3px)` }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-muted-foreground mb-2">
                                <span>{formatCurrency(range90[0], "USD", decimals)}</span>
                                <span className="text-[9px]">90% interval</span>
                                <span>{formatCurrency(range90[1], "USD", decimals)}</span>
                              </div>

                              <ConfidenceBar confidence={pred.confidence} />
                            </div>
                          );
                        })}
                        <div className="text-[10px] text-muted-foreground text-center pt-1">
                          Model {prediction.model.version} · Trained {new Date(prediction.model.trained_at).toLocaleDateString()}
                        </div>
                      </div>
                    ) : aiLoading ? (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1.5" />
                        Loading predictions...
                      </div>
                    ) : (
                      <div className="text-center py-3 text-xs text-muted-foreground">
                        Predictions unavailable — ensure the Python service is running
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Technical Indicators */}
              {indicators && indicators.rsi && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" />
                      Technical Indicators
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      {/* RSI */}
                      <div className="p-2.5 bg-secondary/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-muted-foreground uppercase">RSI (14)</span>
                          <span className={`text-[10px] font-medium ${
                            indicators.rsi.signal === "overbought" ? "text-red-400" :
                            indicators.rsi.signal === "oversold" ? "text-green-400" : "text-yellow-400"
                          }`}>{indicators.rsi.signal}</span>
                        </div>
                        <div className="text-lg font-bold">{indicators.rsi.value}</div>
                        <div className="h-1.5 bg-secondary rounded-full mt-1.5 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-green-500 via-yellow-400 to-red-500 rounded-full"
                            style={{ width: `${indicators.rsi.value}%` }} />
                        </div>
                      </div>

                      {/* MACD */}
                      <div className="p-2.5 bg-secondary/30 rounded-lg">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-muted-foreground uppercase">MACD</span>
                          <span className={`text-[10px] font-medium ${
                            indicators.macd?.signal === "bullish" ? "text-green-400" : "text-red-400"
                          }`}>{indicators.macd?.signal}</span>
                        </div>
                        <div className="text-lg font-bold">{indicators.macd?.histogram.toFixed(2)}</div>
                      </div>

                      {/* Volatility */}
                      {indicators.volatility && (
                        <div className="p-2.5 bg-secondary/30 rounded-lg">
                          <span className="text-[10px] text-muted-foreground uppercase">Volatility</span>
                          <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-lg font-bold">
                              {((indicators.volatility["7d_annualized"] ?? 0) * 100).toFixed(1)}%
                            </span>
                            <span className="text-[10px] text-muted-foreground">7d ann.</span>
                          </div>
                        </div>
                      )}

                      {/* Momentum */}
                      {indicators.momentum && (
                        <div className="p-2.5 bg-secondary/30 rounded-lg">
                          <span className="text-[10px] text-muted-foreground uppercase">Momentum 7d</span>
                          <div className="mt-1">
                            <span className={`text-lg font-bold ${
                              (indicators.momentum["7d_pct"] ?? 0) > 0 ? "text-green-400" : "text-red-400"
                            }`}>
                              {(indicators.momentum["7d_pct"] ?? 0) > 0 ? "+" : ""}
                              {(indicators.momentum["7d_pct"] ?? 0).toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bollinger %B */}
                    {indicators.bollinger_bands && (
                      <div className="mt-3 p-2.5 bg-secondary/30 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground uppercase">Bollinger %B</span>
                          <span className="text-sm font-bold">
                            {(indicators.bollinger_bands.percent_b * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full mt-1.5 overflow-hidden relative">
                          <div className="absolute inset-0 bg-gradient-to-r from-red-500/30 via-green-500/30 to-red-500/30 rounded-full" />
                          <div
                            className="absolute top-0 h-full w-1.5 bg-primary rounded-full"
                            style={{ left: `${Math.min(100, Math.max(0, indicators.bollinger_bands.percent_b * 100))}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
                          <span>Lower</span><span>Middle</span><span>Upper</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Tabs: Overview / Links / Platforms */}
              <Tabs defaultValue="overview">
                <TabsList className="w-full">
                  <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
                  <TabsTrigger value="links" className="flex-1">Links</TabsTrigger>
                  <TabsTrigger value="platforms" className="flex-1">Platforms</TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                  {coinData.description?.en && (
                    <div className="mt-3">
                      <h3 className="text-sm font-semibold mb-2">About {coinData.name}</h3>
                      <div
                        className="text-xs text-muted-foreground leading-relaxed max-h-40 overflow-y-auto prose prose-sm prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: coinData.description.en }}
                      />
                    </div>
                  )}
                  {coinData.categories?.length > 0 && (
                    <div className="mt-3">
                      <h3 className="text-sm font-semibold mb-2">Categories</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {coinData.categories.map((cat) => (
                          <Badge key={cat} variant="secondary" className="text-[10px]">
                            {cat}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {coinData.market_data.circulating_supply && (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between p-2 bg-secondary/30 rounded">
                        <span className="text-muted-foreground">Circulating</span>
                        <span className="font-medium">{(coinData.market_data.circulating_supply / 1e6).toFixed(1)}M</span>
                      </div>
                      {coinData.market_data.total_supply && (
                        <div className="flex justify-between p-2 bg-secondary/30 rounded">
                          <span className="text-muted-foreground">Total Supply</span>
                          <span className="font-medium">{(coinData.market_data.total_supply / 1e6).toFixed(1)}M</span>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="links">
                  <div className="space-y-2 mt-3">
                    {coinData.links.homepage[0] && (
                      <a href={coinData.links.homepage[0]} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors text-sm">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{coinData.links.homepage[0]}</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                    )}
                    {coinData.links.blockchain_site[0] && (
                      <a href={coinData.links.blockchain_site[0]} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors text-sm">
                        <Activity className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 truncate">Blockchain Explorer</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                    )}
                    {coinData.links.twitter_screen_name && (
                      <a href={`https://twitter.com/${coinData.links.twitter_screen_name}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors text-sm">
                        <Twitter className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1">@{coinData.links.twitter_screen_name}</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                    )}
                    {coinData.links.subreddit_url && (
                      <a href={coinData.links.subreddit_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors text-sm">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 truncate">Reddit</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                    )}
                    {coinData.links.repos_url?.github?.[0] && (
                      <a href={coinData.links.repos_url.github[0]} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors text-sm">
                        <Github className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 truncate">GitHub</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </a>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="platforms">
                  <div className="space-y-2 mt-3">
                    {coinData.platforms && Object.entries(coinData.platforms).map(([platform, address]) => (
                      address && (
                        <div key={platform} className="p-2.5 bg-secondary/30 rounded-lg">
                          <div className="text-xs font-medium capitalize">{platform || "Native"}</div>
                          <p className="text-[10px] text-muted-foreground break-all mt-0.5 font-mono">{address}</p>
                        </div>
                      )
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
