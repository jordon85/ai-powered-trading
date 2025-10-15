import axios from "axios";

const BASE_URL =
  process.env.NEXT_PUBLIC_PYTHON_URL || "http://127.0.0.1:8000";

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Response types

export interface ModelInfo {
  name: string;
  version: string;
  target: string;
  horizons: string[];
  trained_at: string;
}

export interface HorizonPrediction {
  predicted_price: number;
  price_range_90: [number, number];
  price_range_50: [number, number];
  predicted_return_pct: number;
  confidence: number;
  cv_r2: number;
}

export interface PredictionResponse {
  symbol: string;
  current_price: number;
  predictions: Record<string, HorizonPrediction>;
  trend: "bullish" | "bearish" | "neutral";
  model: ModelInfo;
  features_used: number;
}

export interface CoinData {
  symbol: string;
  name: string;
  price: number;
  market_cap: number;
  volume_24h: number;
  change_24h: number;
}

export interface AggregateResponse {
  mean_price: number;
  median_price: number;
  max_price: number;
  min_price: number;
  std_dev: number;
  total_market_cap: number;
  total_volume_24h: number;
  avg_price_change_24h: number;
  btc_dominance: number;
  eth_dominance: number;
  count: number;
  coins: CoinData[];
}

export interface ScrapeResponse {
  url: string;
  title: string | null;
  meta_description: string | null;
  page_length: number;
  link_count: number;
  text_preview: string;
  status_code: number;
}

export interface BlockchainBalanceResponse {
  address: string;
  balance_eth: number;
}

export interface RiskDetails {
  volatility_score: number;
  drawdown_score: number;
  instability_score: number;
  momentum_score: number;
  sharpe_score: number;
  weights: string;
}

export interface RiskResponse {
  symbol: string;
  risk_score: number;
  risk_label: "low" | "moderate" | "high" | "very_high" | "extreme";
  volatility: number;
  max_drawdown: number;
  sharpe_ratio: number;
  data_points: number;
  details: RiskDetails;
}

export interface RSIData {
  value: number;
  period: number;
  signal: "overbought" | "oversold" | "neutral";
}

export interface MACDData {
  macd_line: number;
  signal_line: number;
  histogram: number;
  signal: "bullish" | "bearish";
}

export interface BollingerData {
  upper_band: number;
  middle_band: number;
  lower_band: number;
  band_width: number;
  percent_b: number;
}

export interface IndicatorsResponse {
  symbol: string;
  current_price: number;
  rsi: RSIData;
  macd: MACDData;
  bollinger_bands: BollingerData;
  momentum: { "7d_pct": number; "14d_pct": number };
  volatility: { "7d_annualized": number; "30d_annualized": number };
  volume: {
    current_volume: number;
    avg_volume_7d: number;
    volume_ratio: number;
  };
  data_points: number;
}

// API functions

export async function getPrediction(
  symbol: string
): Promise<PredictionResponse> {
  const { data } = await api.post("/predict", { symbol });
  return data;
}

export async function getAggregateData(): Promise<AggregateResponse> {
  const { data } = await api.get("/aggregate");
  return data;
}

export async function scrapeUrl(url: string): Promise<ScrapeResponse> {
  const { data } = await api.post("/scrape", { url });
  return data;
}

export async function getBlockchainBalance(
  address: string
): Promise<BlockchainBalanceResponse> {
  const { data } = await api.post("/blockchain/balance", { address });
  return data;
}

export async function calculateRisk(
  symbol: string,
  priceData: number[]
): Promise<RiskResponse> {
  const { data } = await api.post("/risk", { symbol, data: priceData });
  return data;
}

export async function getMarketIndicators(
  symbol: string = "BTC"
): Promise<IndicatorsResponse> {
  const { data } = await api.get("/market/indicators", {
    params: { symbol },
  });
  return data;
}

export async function getModelInfo(): Promise<Record<string, unknown>> {
  const { data } = await api.get("/model/info");
  return data;
}

export async function checkPythonServiceHealth(): Promise<boolean> {
  try {
    await api.get("/");
    return true;
  } catch {
    return false;
  }
}
