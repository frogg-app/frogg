# Serving the mockups

- Public URL: https://sensor-wealth-friendly-reader.trycloudflare.com/ (round 1: `/round-1/index.html`)
- Local: http://127.0.0.1:55871/
- Static server: `python3 serve.py 55871` (cwd `design-exploration/mockups/`), PID 228520. Also accepts `POST /feedback/round-N` → writes `round-N/feedback.json` (index-page notes).
- Tunnel: `cloudflared --config /tmp/frogg-cf.yml tunnel --url http://127.0.0.1:55871`, PID 238050. Log: `/tmp/frogg-mock-tunnel.log`.
  - `--config` points at a minimal file on purpose: `~/.cloudflared/config.yml` holds the workp.ad ingress rules, which otherwise hijack the quick tunnel and return 404.
- Stop: `kill 228520 238050`. Quick-tunnel URLs change on every restart; update this file if restarted.
