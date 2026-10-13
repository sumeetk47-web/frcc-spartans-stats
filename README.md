# FRCC-Spartans 2026 T20 + P40 CricClubs Stats

A local web app that retrieves CricClubs data through its core API and builds
ground-wise, player-by-player statistics for FRCC-Spartans.

## Defaults

- CricClubs clubId: `5135`
- T20 series/league ID: `135`
- Premier Series (P40) league ID: `137`
- Team ID: `1202`
- Season: `2026`
- Formats: Twenty20 and P40 (40 overs)

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

1. Lets you select 2026 T20 (series 135) or 2026 Premier Series P40 (series 137), then calls CricClubs' schedule API for that series.
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

### Over-phase analysis

The dashboard now supports phase-specific batting and bowling views for:
- All Overs
- 1–6 Overs
- 7–16 Overs
- 17–20 Overs

Phase figures are derived from CricClubs ball-by-ball/over data because the scorecard summary does not expose phase splits. The existing All Overs figures continue to use official scorecard values where available, with ball-by-ball as fallback.


### P40 over phases
For 2026 Premier Series (P40), the phase selector changes to 1–8, 9–32, and 33–40 overs. T20 retains its 1–6, 7–16, and 17–20 phases. The Better/Bad Batting and Bowling Matchups and player dashboard work for whichever series is selected.
