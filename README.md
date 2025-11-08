# ElectrumFallbackClient

Inspired by wagmi's fallback transport for RPC clients, this electrum-cash client allows for defining the fallback and ranking strategies.

## Getting started

A simple initialization routine is available for url-based connection strings:

```javascript
const electrum = ElectrumFallbackClient.FromHostUrls(ElectrumWebSocket, [
    'wss://bch.imaginary.cash:50004', 'ws://blackie.c3-soft.com:50003'
  ], { rank: true });
```

See in-code documentation for more customizations.
