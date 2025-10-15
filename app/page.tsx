import { CryptoTable } from "@/components/crypto-table"
import { GaugeChart } from "@/components/gauge-chart"
import { MarketStats } from "@/components/market-stats"
import { TrendingCoins } from "@/components/trending-coins"
import { PredictionPanel } from "@/components/prediction-panel"
import { BackgroundBeams } from "@/components/ui/background-beams"

export default function Home() {
  return (
    <main className="min-h-screen py-6 relative">
      <BackgroundBeams />
      <div className="container mx-auto max-w-[1920px] px-4 relative z-10">
        <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 space-y-6">
              <MarketStats />
              <CryptoTable />
            </div>

            <div className="space-y-6">
              <PredictionPanel />
              <GaugeChart />
            </div>
          </div>

          <TrendingCoins />
        </div>
      </div>
    </main>
  )
}
