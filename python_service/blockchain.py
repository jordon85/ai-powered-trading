import os
from web3 import Web3
from cachetools import TTLCache

# Cache balances for 60 seconds (blockchain RPC calls are slow)
_balance_cache: TTLCache = TTLCache(maxsize=64, ttl=60)


def get_balance(address: str):
    # Check cache first
    cache_key = address.lower()
    if cache_key in _balance_cache:
        return _balance_cache[cache_key]

    infura_key = os.environ.get("INFURA_API_KEY")
    if infura_key:
        provider_url = f"https://mainnet.infura.io/v3/{infura_key}"
    else:
        provider_url = "https://eth.llamarpc.com"

    w3 = Web3(Web3.HTTPProvider(provider_url))

    if not w3.is_connected():
        return {"error": "Cannot connect to Ethereum network"}

    try:
        if not w3.is_address(address):
            return {"error": "Invalid Ethereum address"}

        checksum = w3.to_checksum_address(address)
        balance = w3.eth.get_balance(checksum)
        eth_balance = w3.from_wei(balance, "ether")
        result = {"address": address, "balance_eth": float(eth_balance)}

        _balance_cache[cache_key] = result
        return result
    except Exception as e:
        return {"error": str(e)}
