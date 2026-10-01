# FRCC-Spartans 2026 T20 CricClubs Stats

A local web app that retrieves CricClubs data through its core API and builds
ground-wise, player-by-player statistics for FRCC-Spartans.

## Defaults

- CricClubs clubId: `5135`
- Series/league ID: `135`
- Team ID: `1202`
- Season: `2026`
- Format: Twenty20

## Run

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app:app --reload
```

Open http://127.0.0.1:8000

## What it does

1. Calls CricClubs' schedule API for series 135.
2. Finds FRCC-Spartans fixtures in 2026.
3. Gets each match's scorecard summary and full ball-by-ball feed.
4. Reconstructs batting and bowling figures from the delivery data.
5. Groups player statistics by ground.
6. Shows ground summary, batting, bowling and overall tables.
7. Exports the result as Excel.

The API requires CricClubs' current `x-content-token`. The app generates the
same RSA/PKCS#1 v1.5 timestamp token used by the CricClubs app.

## Notes

- The public CricClubs web UI may be Cloudflare-protected; this app talks to
  CricClubs' core data host instead.
- The implementation deliberately does not scrape HTML.
- If CricClubs changes its API response schema, update the small normalization
  functions in `worker.py`.
- Respect CricClubs' terms and rate limits. The app uses a modest delay between
  matches.
