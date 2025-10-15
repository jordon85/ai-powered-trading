import pandas as pd
import httpx
from bs4 import BeautifulSoup
from cachetools import TTLCache
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

_agg_cache: TTLCache = TTLCache(maxsize=8, ttl=300)
_robots_cache: TTLCache = TTLCache(maxsize=32, ttl=3600)

COINS = [
    "bitcoin", "ethereum", "solana", "binancecoin", "ripple",
    "cardano", "dogecoin", "polkadot", "avalanche-2", "chainlink",
]


async def aggregate_data():
    """Fetch real market data from CoinGecko and compute aggregate metrics."""
    cache_key = "aggregate"
    if cache_key in _agg_cache:
        return _agg_cache[cache_key]

    url = "https://api.coingecko.com/api/v3/coins/markets"
    params = {
        "vs_currency": "usd",
        "ids": ",".join(COINS),
        "order": "market_cap_desc",
        "sparkline": "false",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()

    coins = resp.json()
    df = pd.DataFrame(coins)

    total_market_cap = float(df["market_cap"].sum())

    # BTC dominance
    btc_row = df[df["symbol"] == "btc"]
    btc_dominance = round(float(btc_row["market_cap"].iloc[0]) / total_market_cap * 100, 2) if len(btc_row) > 0 else 0

    # ETH dominance
    eth_row = df[df["symbol"] == "eth"]
    eth_dominance = round(float(eth_row["market_cap"].iloc[0]) / total_market_cap * 100, 2) if len(eth_row) > 0 else 0

    result = {
        "mean_price": round(float(df["current_price"].mean()), 2),
        "median_price": round(float(df["current_price"].median()), 2),
        "max_price": round(float(df["current_price"].max()), 2),
        "min_price": round(float(df["current_price"].min()), 2),
        "std_dev": round(float(df["current_price"].std()), 2),
        "total_market_cap": round(total_market_cap, 0),
        "total_volume_24h": round(float(df["total_volume"].sum()), 0),
        "avg_price_change_24h": round(float(df["price_change_percentage_24h"].mean()), 2),
        "btc_dominance": btc_dominance,
        "eth_dominance": eth_dominance,
        "count": len(df),
        "coins": [
            {
                "symbol": row["symbol"].upper(),
                "name": row["name"],
                "price": row["current_price"],
                "market_cap": row["market_cap"],
                "volume_24h": row["total_volume"],
                "change_24h": row["price_change_percentage_24h"],
            }
            for _, row in df.iterrows()
        ],
    }

    _agg_cache[cache_key] = result
    return result


def _check_robots(url: str) -> bool:
    """Check if scraping is allowed by robots.txt."""
    cache_key = urlparse(url).netloc
    if cache_key in _robots_cache:
        return _robots_cache[cache_key]

    try:
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        rp = RobotFileParser()
        rp.set_url(robots_url)
        rp.read()
        allowed = rp.can_fetch("*", url)
    except Exception:
        allowed = True  # if robots.txt is unreachable, proceed

    _robots_cache[cache_key] = allowed
    return allowed


async def scrape_data(url: str):
    """Scrape a URL and extract structured page information with robots.txt respect."""
    # Check robots.txt
    if not _check_robots(url):
        return {"error": f"Scraping disallowed by robots.txt for {url}"}

    try:
        async with httpx.AsyncClient(
            timeout=10,
            follow_redirects=True,
            verify=False,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CryptoSkope/1.0)"},
        ) as client:
            # Retry up to 3 times
            last_error = None
            for attempt in range(3):
                try:
                    resp = await client.get(url)
                    break
                except httpx.TransportError as e:
                    last_error = e
                    if attempt == 2:
                        return {"error": f"Failed after 3 retries: {str(last_error)}"}

        soup = BeautifulSoup(resp.text, "html.parser")

        title = soup.title.string.strip() if soup.title and soup.title.string else None

        meta_desc = None
        meta_tag = soup.find("meta", attrs={"name": "description"})
        if meta_tag:
            meta_desc = meta_tag.get("content")

        link_count = len(soup.find_all("a", href=True))
        text_preview = soup.get_text(separator=" ", strip=True)[:200]

        return {
            "url": url,
            "title": title,
            "meta_description": meta_desc,
            "page_length": len(resp.text),
            "link_count": link_count,
            "text_preview": text_preview,
            "status_code": resp.status_code,
        }
    except Exception as e:
        return {"error": str(e)}
