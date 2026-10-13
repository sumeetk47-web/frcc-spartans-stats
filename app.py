import json
import os
import shutil
import threading
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from worker import run_job

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)
CACHE = DATA / "cache"
CACHE.mkdir(exist_ok=True)
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", str(6 * 60 * 60)))
RATE_LIMIT_PER_HOUR = int(os.getenv("RATE_LIMIT_PER_HOUR", "6"))

app = FastAPI(title="FRCC-Spartans 2026 T20 + P40 Stats")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))

jobs = {}
lock = threading.Lock()
in_progress_job = None
requests_by_ip = defaultdict(deque)


def series_config(series_id):
    configs = {
        135: {"label": "T20", "format": "Twenty20", "overs": 20},
        137: {"label": "P40 Premier Series", "format": "P40", "overs": 40},
    }
    if series_id not in configs:
        raise HTTPException(400, "Unsupported series. Choose 2026 T20 or 2026 Premier Series (P40).")
    return configs[series_id]


def cache_paths(series_id):
    label = series_config(series_id)["label"].replace(" ", "-")
    return CACHE / f"result_{series_id}.json", CACHE / f"FRCC-Spartans-2026-{label}.xlsx"


def cache_ready(series_id=135):
    result, excel = cache_paths(series_id)
    if not result.exists() or not excel.exists():
        return False
    return (time.time() - result.stat().st_mtime) < CACHE_TTL_SECONDS


def copy_cache_to_job(job_id, series_id=135):
    outdir = DATA / job_id
    outdir.mkdir(parents=True, exist_ok=True)
    result, excel = cache_paths(series_id)
    shutil.copy2(result, outdir / "result.json")
    shutil.copy2(excel, outdir / excel.name)

def client_allowed(request: Request):
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    q = requests_by_ip[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= RATE_LIMIT_PER_HOUR:
        return False
    q.append(now)
    return True


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/health")
def health():
    return {"status": "ok", "cache_ready": cache_ready(135), "supported_series": [135, 137]}


@app.get("/api/cache")
def cache_status(request: Request):
    try:
        series_id = int(request.query_params.get("series", "135"))
    except ValueError:
        series_id = 135
    result, _ = cache_paths(series_id)
    if not result.exists():
        return {"ready": False}
    age = max(0, time.time() - result.stat().st_mtime)
    return {"ready": cache_ready(series_id), "age_seconds": int(age), "ttl_seconds": CACHE_TTL_SECONDS}


@app.post("/api/jobs")
def create_job(request: Request, background_tasks: BackgroundTasks):
    global in_progress_job
    if not client_allowed(request):
        raise HTTPException(429, "Refresh limit reached. Please wait before requesting another update.")
    try:
        series_id = int(request.query_params.get("series", "135"))
    except ValueError:
        raise HTTPException(400, "Invalid series ID.")
    cfg = series_config(series_id)

    with lock:
        if in_progress_job:
            existing = jobs.get(in_progress_job)
            if existing and existing.get("status") in {"queued", "running"}:
                if existing.get("series_id", 135) != series_id:
                    raise HTTPException(409, "Another competition is currently being fetched. Please wait for it to finish, then try again.")
                return {"job_id": in_progress_job, "reused": True}

        job_id = uuid.uuid4().hex
        jobs[job_id] = {"status": "queued", "progress": 0, "message": "Queued", "series_id": series_id}
        in_progress_job = job_id

    force_refresh = request.query_params.get("refresh", "0").lower() in {"1", "true", "yes"}

    if cache_ready(series_id) and not force_refresh:
        copy_cache_to_job(job_id, series_id)
        with lock:
            jobs[job_id] = {
                "status": "done", "progress": 100,
                "message": f"Loaded cached 2026 {cfg['label']} data. Use Refresh when you want a new CricClubs fetch."
            }
            in_progress_job = None
        return {"job_id": job_id, "cached": True}

    background_tasks.add_task(run_job, job_id, jobs, lock, series_id, cfg["format"])
    return {"job_id": job_id, "cached": False}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    with lock:
        job = jobs.get(job_id)
    if not job:
        p = DATA / job_id / "result.json"
        if p.exists():
            return {"status": "done", "progress": 100, "message": "Complete"}
        raise HTTPException(404, "Unknown job")
    return job


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: str):
    p = DATA / job_id / "result.json"
    if not p.exists():
        raise HTTPException(404, "Result not ready")
    return json.loads(p.read_text(encoding="utf-8"))


@app.get("/api/jobs/{job_id}/excel")
def job_excel(job_id: str):
    outdir = DATA / job_id
    candidates = list(outdir.glob("FRCC-Spartans-2026-*.xlsx"))
    if not candidates:
        raise HTTPException(404, "Excel file not ready")
    p = candidates[0]
    return FileResponse(p, filename=p.name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
