# Omkar resilience

The AliExpress product-details integration retries transient upstream failures (HTTP 408, 425, 429, 500, 502, 503, 504) with bounded exponential backoff. Permanent authentication and client errors fail immediately. Products are never persisted from incomplete fallback data when authoritative SKU and stock data are unavailable.
