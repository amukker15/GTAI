from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
from collections import OrderedDict
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from threading import Lock, Thread

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .analyzer import WindowAnalyzer
from .models import (
    AnalysisSummary,
    HeadPoseResponse,
    HRSimResponse,
    HRVSimResponse,
    PerclosResponse,
    QualityResponse,
    StateRequest,
    StateResponse,
    VitalsSimRequest,
    VitalsSimResponse,
    WindowAggregateResponse,
    YawnResponse,
)
from .utils import parse_timestamp
from .state_classifier import DriverStateClassifier
from .state_store import GLOBAL_STATE_STORE
from .sim_vitals import VitalsSimulator
from .video import VideoWindowExtractor
from . import snowflake_db

app = FastAPI(
    title="Lucid Drowsiness API",
    description="Upload a recording plus a timestamp; receive 15s vigilance analytics.",
    version="0.1.0",
)

# Serve developer footage files from the repo's footage/ directory at /footage
# This makes files placed in api2/footage accessible to the frontend/dev proxy.
footage_dir = Path(__file__).resolve().parents[1] / "footage"
if footage_dir.exists():
    app.mount("/footage", StaticFiles(directory=str(footage_dir)), name="footage")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

analyzer = WindowAnalyzer()
state_classifier = DriverStateClassifier()
vitals_simulator = VitalsSimulator()

ANALYSIS_CACHE_MAX = int(os.getenv("ANALYSIS_CACHE_MAX", "256"))
_analysis_cache: "OrderedDict[str, AnalysisSummary]" = OrderedDict()
_cache_lock = Lock()
_warmers_inflight: set[str] = set()
_warmers_lock = Lock()
BASE_DIR = Path(__file__).resolve().parents[1]
CACHE_DIR = Path(os.getenv("ANALYSIS_CACHE_DIR", BASE_DIR / ".analysis_cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_CACHE_DIR = CACHE_DIR / "videos"
UPLOAD_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _video_signature(video_path: Path) -> str:
    try:
        stat = video_path.stat()
        return f"{video_path.resolve()}::{stat.st_mtime}:{stat.st_size}"
    except FileNotFoundError:
        return str(video_path.resolve())


def _timestamp_token(timestamp_seconds: float) -> str:
    return f"{round(float(timestamp_seconds), 3):.3f}"


def _cache_file_path(signature: str) -> Path:
    digest = hashlib.sha256(signature.encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}.json"


def _materialize_upload_for_cache(tmp_path: Path, original_name: str | None) -> Path:
    """Convert an uploaded temp file into a stable, content-addressed cache entry."""
    suffix = Path(original_name or tmp_path.name).suffix or ".mp4"
    digest = hashlib.sha256()
    with tmp_path.open("rb") as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            digest.update(chunk)
    final_path = UPLOAD_CACHE_DIR / f"{digest.hexdigest()}{suffix}"
    if final_path.exists():
        tmp_path.unlink(missing_ok=True)
    else:
        tmp_path.replace(final_path)
    return final_path


def _cache_key(signature: str, timestamp_token: str) -> str:
    return f"{signature}::{timestamp_token}"


def _summary_to_record(summary: AnalysisSummary) -> dict:
    data = asdict(summary)
    ts_value = summary.ts_end_iso
    if isinstance(ts_value, datetime):
        data["ts_end_iso"] = ts_value.isoformat()
    else:
        data["ts_end_iso"] = str(ts_value)
    return data


def _record_to_summary(record: dict) -> AnalysisSummary:
    payload = record.copy()
    ts_value = payload.get("ts_end_iso")
    if isinstance(ts_value, str):
        payload["ts_end_iso"] = datetime.fromisoformat(ts_value)
    return AnalysisSummary(**payload)


def _persist_cache_entry(signature: str, timestamp_token: str, summary: AnalysisSummary):
    cache_file = _cache_file_path(signature)
    entries = {}
    if cache_file.exists():
        try:
            with cache_file.open("r", encoding="utf-8") as existing:
                payload = json.load(existing)
                entries = payload.get("entries", {})
        except Exception as exc:
            print(f"[Cache] Failed to read cache file {cache_file}: {exc}")
            entries = {}
    entries[timestamp_token] = _summary_to_record(summary)
    tmp_path = cache_file.with_suffix(".tmp")
    payload = {"video_signature": signature, "entries": entries}
    with tmp_path.open("w", encoding="utf-8") as tmp:
        json.dump(payload, tmp)
    tmp_path.replace(cache_file)


def _set_cache_entry(signature: str, timestamp_token: str, summary: AnalysisSummary, persist: bool = True):
    cache_key = _cache_key(signature, timestamp_token)
    clone = copy.deepcopy(summary)
    with _cache_lock:
        _analysis_cache[cache_key] = clone
        _analysis_cache.move_to_end(cache_key)
        while len(_analysis_cache) > ANALYSIS_CACHE_MAX:
            _analysis_cache.popitem(last=False)
    if persist:
        _persist_cache_entry(signature, timestamp_token, clone)
    return copy.deepcopy(clone)


def _load_summary_from_disk(signature: str, timestamp_token: str):
    cache_file = _cache_file_path(signature)
    if not cache_file.exists():
        return None
    try:
        with cache_file.open("r", encoding="utf-8") as cached:
            payload = json.load(cached)
    except Exception as exc:
        print(f"[Cache] Failed to load disk cache {cache_file}: {exc}")
        return None
    record = payload.get("entries", {}).get(timestamp_token)
    if not record:
        return None
    summary = _record_to_summary(record)
    _set_cache_entry(signature, timestamp_token, summary, persist=False)
    return copy.deepcopy(summary)


def _get_cached_summary(video_path: Path, timestamp_seconds: float):
    signature = _video_signature(video_path)
    token = _timestamp_token(timestamp_seconds)
    cache_key = _cache_key(signature, token)
    with _cache_lock:
        summary = _analysis_cache.get(cache_key)
        if summary is not None:
            _analysis_cache.move_to_end(cache_key)
            return copy.deepcopy(summary)
    return _load_summary_from_disk(signature, token)


def _store_cached_summary(video_path: Path, timestamp_seconds: float, summary):
    signature = _video_signature(video_path)
    token = _timestamp_token(timestamp_seconds)
    _set_cache_entry(signature, token, summary, persist=True)


def _warm_cache_for_video(video_path: Path):
    try:
        extractor = VideoWindowExtractor(video_path)
        duration = extractor.meta.duration or 0
    except Exception as exc:
        print(f"[CacheWarm] Failed to inspect video {video_path}: {exc}")
        return

    ts = 30.0
    while ts <= max(duration, 0):
        existing = _get_cached_summary(video_path, ts)
        if existing is None:
            try:
                summary = analyzer.analyze(video_path, ts, None, None)
                _store_cached_summary(video_path, ts, summary)
            except Exception as exc:
                print(f"[CacheWarm] Failed to precompute {video_path} @ {ts}s: {exc}")
                break
        ts += 30.0


def _ensure_cache_warm(video_path: Path):
    signature = _video_signature(video_path)
    with _warmers_lock:
        if signature in _warmers_inflight:
            return
        _warmers_inflight.add(signature)

    def _worker():
        try:
            _warm_cache_for_video(video_path)
        finally:
            with _warmers_lock:
                _warmers_inflight.discard(signature)

    Thread(target=_worker, daemon=True).start()


def save_analysis_to_snowflake(summary, session_id: str | None, driver_id: str | None):
    """Save analysis results to Snowflake database"""
    try:
        # Create measurement data for Snowflake
        measurement_data = {
            "driver_id": driver_id or session_id or "demo_driver",
            "session_id": session_id or "demo_session", 
            "ts": summary.ts_end_iso,
            "perclos": summary.perclos_ratio,
            "perclos_percent": summary.perclos_percent,
            "ear_threshold": summary.ear_threshold,
            "pitchdown_avg": summary.pitchdown_avg,
            "pitchdown_max": summary.pitchdown_max,
            "droop_time": summary.droop_time,
            "droop_duty": summary.droop_duty,
            "pitch_threshold": summary.pitch_threshold,
            "yawn_count": summary.yawn_count,
            "yawn_time": summary.yawn_time,
            "yawn_duty": summary.yawn_duty,
            "yawn_peak": summary.yawn_peak,
            "confidence": summary.confidence_label,
            "fps": summary.fps_observed
        }
        
        # Insert into Snowflake
        rows_affected = snowflake_db.insert_drowsiness_measurement(measurement_data)
        print(f"[Snowflake] Successfully saved analysis data for session {measurement_data['session_id']}")
        return True
    except Exception as e:
        # Reduce noise in demo mode - Snowflake connection issues are expected
        if "404 Not Found" in str(e) or "login-request" in str(e):
            # Snowflake connection issue - expected in demo mode
            pass
        else:
            print(f"[Snowflake] Unexpected error saving analysis: {e}")
        # Don't fail the whole request if Snowflake is down
        return False


async def write_temp_file(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "window.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            tmp.write(chunk)
        tmp_path = Path(tmp.name)
    await upload.close()
    return tmp_path


async def analyze_request(
    video: UploadFile | None,
    timestamp_value: str,
    session_id: str | None,
    driver_id: str | None,
    *,
    disable_cache: bool = False,
):
    try:
        ts_seconds = parse_timestamp(timestamp_value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # If no video uploaded, use the auto-detected video file from footage directory
    if video is None:
        video_path = find_video_file()
        if not video_path:
            raise HTTPException(
                status_code=404,
                detail="No video file found in footage directory and no video uploaded"
            )

        _ensure_cache_warm(video_path)

        if not disable_cache:
            cached = _get_cached_summary(video_path, ts_seconds)
            if cached:
                return cached

        try:
            summary = await run_in_threadpool(
                analyzer.analyze,
                video_path,
                ts_seconds,
                session_id,
                driver_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if not disable_cache:
            _store_cached_summary(video_path, ts_seconds, summary)
        return summary
    else:
        # Uploaded videos are deduped into a content-addressed cache unless the
        # caller explicitly disables caching (useful for interactive testers).
        tmp_path = await write_temp_file(video)
        cached_video_path = tmp_path
        if not disable_cache:
            try:
                cached_video_path = await run_in_threadpool(
                    _materialize_upload_for_cache,
                    tmp_path,
                    video.filename,
                )
            except Exception:
                cached_video_path = tmp_path

            cached = _get_cached_summary(cached_video_path, ts_seconds)
            if cached:
                return cached

        try:
            summary = await run_in_threadpool(
                analyzer.analyze,
                cached_video_path,
                ts_seconds,
                session_id,
                driver_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            try:
                if cached_video_path == tmp_path and tmp_path.exists():
                    os.unlink(tmp_path)
            except FileNotFoundError:
                pass

        if not disable_cache:
            _store_cached_summary(cached_video_path, ts_seconds, summary)
        return summary


@app.post("/api/perclos", response_model=PerclosResponse)
async def perclos_endpoint(
    video: UploadFile | None = File(None),
    timestamp: str = Form(..., description="Timestamp within the video (s or HH:MM:SS)"),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
    disable_cache: bool = Form(False),
):
    summary = await analyze_request(
        video,
        timestamp,
        session_id,
        driver_id,
        disable_cache=disable_cache,
    )
    return PerclosResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        PERCLOS=summary.perclos_percent,
        perclos_15s=summary.perclos_ratio,
        ear_thresh_T=summary.ear_threshold,
    )


@app.post("/api/head-pose", response_model=HeadPoseResponse)
async def head_pose_endpoint(
    video: UploadFile | None = File(None),
    timestamp: str = Form(...),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
    disable_cache: bool = Form(False),
):
    summary = await analyze_request(
        video,
        timestamp,
        session_id,
        driver_id,
        disable_cache=disable_cache,
    )
    return HeadPoseResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        pitchdown_avg_15s=summary.pitchdown_avg,
        pitchdown_max_15s=summary.pitchdown_max,
        droop_time_15s=summary.droop_time,
        droop_duty_15s=summary.droop_duty,
        pitch_thresh_Tp=summary.pitch_threshold,
    )


@app.post("/api/yawning", response_model=YawnResponse)
async def yawning_endpoint(
    video: UploadFile | None = File(None),
    timestamp: str = Form(...),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
    disable_cache: bool = Form(False),
):
    summary = await analyze_request(
        video,
        timestamp,
        session_id,
        driver_id,
        disable_cache=disable_cache,
    )
    return YawnResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        yawn_count_15s=summary.yawn_count,
        yawn_time_15s=summary.yawn_time,
        yawn_duty_15s=summary.yawn_duty,
        yawn_peak_15s=summary.yawn_peak,
    )


@app.post("/api/quality", response_model=QualityResponse)
async def quality_endpoint(
    video: UploadFile | None = File(None),
    timestamp: str = Form(...),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
    disable_cache: bool = Form(False),
):
    summary = await analyze_request(
        video,
        timestamp,
        session_id,
        driver_id,
        disable_cache=disable_cache,
    )
    return QualityResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        confidence=summary.confidence_label,
        fps=summary.fps_observed,
    )


@app.post("/api/window", response_model=WindowAggregateResponse)
async def aggregate_endpoint(
    video: UploadFile | None = File(None),
    timestamp: str = Form(...),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
    disable_cache: bool = Form(False),
):
    summary = await analyze_request(
        video,
        timestamp,
        session_id,
        driver_id,
        disable_cache=disable_cache,
    )
    
    # Save to Snowflake database
    save_analysis_to_snowflake(summary, session_id, driver_id)
    
    return WindowAggregateResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        PERCLOS=summary.perclos_percent,
        perclos_15s=summary.perclos_ratio,
        ear_thresh_T=summary.ear_threshold,
        pitchdown_avg_15s=summary.pitchdown_avg,
        pitchdown_max_15s=summary.pitchdown_max,
        droop_time_15s=summary.droop_time,
        droop_duty_15s=summary.droop_duty,
        pitch_thresh_Tp=summary.pitch_threshold,
        yawn_count_15s=summary.yawn_count,
        yawn_time_15s=summary.yawn_time,
        yawn_duty_15s=summary.yawn_duty,
        yawn_peak_15s=summary.yawn_peak,
        confidence=summary.confidence_label,
        fps=summary.fps_observed,
    )


@app.post("/api/status")
async def save_driver_status(
    status: str = Form(..., description="Driver status: OK, DROWSY_SOON, or ASLEEP"),
    driver_id: str | None = Form(None),
    session_id: str | None = Form(None)
):
    """Save driver status to Snowflake STATUS_TABLE"""
    try:
        # Validate status values
        valid_statuses = ["OK", "DROWSY_SOON", "ASLEEP"]
        if status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Status must be one of: {valid_statuses}")
        
        # Insert into STATUS_TABLE
        try:
            rows_affected = snowflake_db.insert_status(status)
            timestamp = datetime.now().isoformat()
            print(f"[Snowflake] Saved status {status} at {timestamp}")
            return {"success": True, "status": status, "timestamp": timestamp, "rows_affected": rows_affected}
        except Exception as snowflake_error:
            # Handle Snowflake connection issues gracefully
            timestamp = datetime.now().isoformat()
            print(f"[Snowflake] Connection failed, running in demo mode. Status: {status} at {timestamp}")
            return {"success": True, "status": status, "timestamp": timestamp, "demo_mode": True, "note": "Snowflake not connected - demo mode"}
        
    except Exception as e:
        print(f"[Snowflake] Error saving status: {e}")
        # Don't fail the request if Snowflake is down
        return {"success": False, "error": str(e)}


@app.post("/v1/state", response_model=StateResponse)
async def classify_state(payload: StateRequest):
    response = state_classifier.classify(payload)
    GLOBAL_STATE_STORE.record(response)
    return response


@app.post("/v1/sim/hr", response_model=HRSimResponse)
async def simulate_hr(payload: VitalsSimRequest):
    return vitals_simulator.simulate_hr(payload)


@app.post("/v1/sim/hrv", response_model=HRVSimResponse)
async def simulate_hrv(payload: VitalsSimRequest):
    return vitals_simulator.simulate_hrv(payload)


@app.post("/v1/sim/vitals", response_model=VitalsSimResponse)
async def simulate_vitals(payload: VitalsSimRequest):
    return vitals_simulator.simulate_vitals(payload)


def find_video_file():
    """Find the first video file in the footage directory"""
    footage_dir = Path(__file__).parent.parent / "footage"
    
    # Common video file extensions
    video_extensions = ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v']
    
    if not footage_dir.exists():
        return None
        
    for video_file in footage_dir.iterdir():
        if video_file.is_file() and video_file.suffix.lower() in video_extensions:
            return video_file
    
    return None

@app.get("/api/footage/video")
async def serve_demo_video():
    """Serve the demo video file for frontend consumption"""
    from fastapi.responses import FileResponse
    from fastapi import Response
    
    footage_path = find_video_file()
    
    if not footage_path or not footage_path.exists():
        raise HTTPException(
            status_code=404, 
            detail="No video file found in footage directory. Please add a video file (mp4, mov, avi, etc.)"
        )
    
    # Determine appropriate MIME type based on file extension
    mime_types = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime', 
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm',
        '.m4v': 'video/mp4'
    }
    
    media_type = mime_types.get(footage_path.suffix.lower(), 'video/mp4')
    
    response = FileResponse(
        path=footage_path,
        media_type=media_type,
        filename=f"demo_video{footage_path.suffix}"
    )
    
    # Add CORS headers explicitly for this endpoint
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    
    return response


@app.get("/api/footage/info")
async def get_video_info():
    """Get metadata about the current video file"""
    footage_path = find_video_file()
    
    if not footage_path:
        raise HTTPException(
            status_code=404, 
            detail="No video file found in footage directory"
        )
    
    # Import video metadata extraction
    from .video import VideoWindowExtractor
    
    try:
        extractor = VideoWindowExtractor(footage_path)
        return {
            "filename": footage_path.name,
            "duration": extractor.meta.duration,
            "fps": extractor.meta.fps,
            "width": extractor.meta.width,
            "height": extractor.meta.height,
            "format": footage_path.suffix.lower()
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to extract video metadata: {str(e)}"
        )


@app.post("/api/session/reset")
async def reset_session(session_id: str | None = Form(None)):
    """Reset session by clearing Snowflake data for demo purposes"""
    try:
        # Clear drowsiness measurements for this session
        if session_id:
            query = "DELETE FROM DROWSINESS_MEASUREMENTS WHERE session_id = %s"
            rows_affected = snowflake_db.execute(query, (session_id,))
        else:
            # Clear all demo data if no session specified
            query = "DELETE FROM DROWSINESS_MEASUREMENTS WHERE driver_id = %s OR session_id = %s"
            rows_affected = snowflake_db.execute(query, ("demo_driver", "demo_session"))
        
        return {"success": True, "rows_cleared": rows_affected}
    except Exception as e:
        # Reduce noise for expected Snowflake connection issues in demo mode
        if "404 Not Found" not in str(e) and "login-request" not in str(e):
            print(f"[Snowflake] Unexpected error resetting session: {e}")
        # Return success even if Snowflake fails, for demo purposes
        return {"success": True, "rows_cleared": 0, "warning": "Demo mode - Snowflake not connected"}


@app.get("/api/measurements")
async def get_measurements(
    session_id: str | None = None,
    driver_id: str | None = None,
    limit: int = 100
):
    """Get recent drowsiness measurements from Snowflake"""
    try:
        if session_id:
            query = "SELECT * FROM DROWSINESS_MEASUREMENTS WHERE session_id = %s ORDER BY ts DESC LIMIT %s"
            results = snowflake_db.fetchall(query, (session_id, limit))
        elif driver_id:
            query = "SELECT * FROM DROWSINESS_MEASUREMENTS WHERE driver_id = %s ORDER BY ts DESC LIMIT %s"
            results = snowflake_db.fetchall(query, (driver_id, limit))
        else:
            query = "SELECT * FROM DROWSINESS_MEASUREMENTS ORDER BY ts DESC LIMIT %s"
            results = snowflake_db.fetchall(query, (limit,))
        
        return {"measurements": results}
    except Exception as e:
        print(f"[Snowflake] Failed to fetch measurements: {e}")
        return {"measurements": []}


"""FastAPI entrypoint wiring request handlers to analyzers and simulators."""
