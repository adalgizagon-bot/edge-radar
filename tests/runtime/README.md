# Workerd transport compatibility (local only)

Run from the repository root:

```sh
npx wrangler@4 dev --local --config tests/runtime/wrangler.toml --ip 127.0.0.1 --port 8799
curl --fail http://127.0.0.1:8799
```

The JSON must have `ok=true` and four passing cases: HTTP 200, 3xx without following, timeout, and connection failure. The fixture imports the production deadline/redirect/error classification functions. All traffic is local loopback; port 18999 must be closed. No D1 binding, cron, remote deployment, authorization or market request is used. Stop the local server after testing. This is compatibility validation, not a benchmark of Cloudflare CPU.
