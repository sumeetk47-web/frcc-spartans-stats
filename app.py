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

app = FastAPI(title="FRCC-Spartans 2026 T20 Stats")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))

jobs = {}
lock = threading.Lock()
in_progress_job = None
requests_by_ip = defaultdict(deque)


def cache_ready():
    result = CACHE / "result.json"
    excel = CACHE / "FRCC-Spartans-2026-T20.xlsx"
    if not result.exists() or not excel.exists():
        return False
    return (time.time() - result.stat().st_mtime) < CACHE_TTL_SECONDS


def copy_cache_to_job(job_id):
    outdir = DATA / job_id
    outdir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(CACHE / "result.json", outdir / "result.json")
    shutil.copy2(CACHE / "FRCC-Spartans-2026-T20.xlsx", outdir / "FRCC-Spartans-2026-T20.xlsx")


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
    return {"status": "ok", "cache_ready": cache_ready()}


@app.get("/api/cache")
def cache_status():
    result = CACHE / "result.json"
    if not result.exists():
        return {"ready": False}
    age = max(0, time.time() - result.stat().st_mtime)
    return {"ready": cache_ready(), "age_seconds": int(age), "ttl_seconds": CACHE_TTL_SECONDS}


@app.post("/api/jobs")
def create_job(request: Request, background_tasks: BackgroundTasks):
    global in_progress_job
    if not client_allowed(request):
        raise HTTPException(429, "Refresh limit reached. Please wait before requesting another update.")

    with lock:
        if in_progress_job:
            existing = jobs.get(in_progress_job)
            if existing and existing.get("status") in {"queued", "running"}:
                return {"job_id": in_progress_job, "reused": True}

        job_id = uuid.uuid4().hex
        jobs[job_id] = {"status": "queued", "progress": 0, "message": "Queued"}
        in_progress_job = job_id

    force_refresh = request.query_params.get("refresh", "0").lower() in {"1", "true", "yes"}

    if cache_ready() and not force_refresh:
        copy_cache_to_job(job_id)
        with lock:
            jobs[job_id] = {
                "status": "done", "progress": 100,
                "message": "Loaded cached 2026 data. Use Refresh when you want a new CricClubs fetch."
            }
            in_progress_job = None
        return {"job_id": job_id, "cached": True}

    background_tasks.add_task(run_job, job_id, jobs, lock)
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
    p = DATA / job_id / "FRCC-Spartans-2026-T20.xlsx"
    if not p.exists():
        raise HTTPException(404, "Excel file not ready")
    return FileResponse(p, filename=p.name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
