# Public deployment on Render

1. Put this folder in a GitHub repository.
2. In Render, choose **New → Blueprint** and select the repository. Render will read `render.yaml`.
3. Alternatively create a **Web Service** manually with:
   - Runtime: Python
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - Health Check Path: `/health`

## Public behavior

The app has server-side single-flight protection and a 6-hour cache by default. Concurrent refreshes reuse the same collection job rather than hitting CricClubs repeatedly.

A successful collection is cached under `data/cache`. Render's default filesystem is ephemeral, so the cache can disappear after a restart/redeploy; the next refresh rebuilds it.

## Environment variables

- `CACHE_TTL_SECONDS`: default `21600` (6 hours)
- `RATE_LIMIT_PER_HOUR`: default `6` refresh requests per client IP per hour
- Existing CricClubs variables can still be overridden: `CRICCLUBS_CLUB_ID`, `CRICCLUBS_SERIES_ID`, `CRICCLUBS_TEAM_ID`, `CRICCLUBS_TEAM_NAME`, `CRICCLUBS_SEASON`, `REQUEST_DELAY`.
