from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .analyzer import WindowAnalyzer
from .models import (
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

app = FastAPI(
    title="Lucid Drowsiness API",
    description="Upload a recording plus a timestamp; receive 30s vigilance analytics.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

analyzer = WindowAnalyzer()
state_classifier = DriverStateClassifier()
vitals_simulator = VitalsSimulator()


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
    video: UploadFile,
    timestamp_value: str,
    session_id: str | None,
    driver_id: str | None,
):
    try:
        ts_seconds = parse_timestamp(timestamp_value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    tmp_path = await write_temp_file(video)
    try:
        summary = await run_in_threadpool(
            analyzer.analyze,
            tmp_path,
            ts_seconds,
            session_id,
            driver_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
    return summary


@app.post("/api/perclos", response_model=PerclosResponse)
async def perclos_endpoint(
    video: UploadFile = File(...),
    timestamp: str = Form(..., description="Timestamp within the video (s or HH:MM:SS)"),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
):
    summary = await analyze_request(video, timestamp, session_id, driver_id)
    return PerclosResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        PERCLOS=summary.perclos_percent,
        perclos_30s=summary.perclos_ratio,
        ear_thresh_T=summary.ear_threshold,
    )


@app.post("/api/head-pose", response_model=HeadPoseResponse)
async def head_pose_endpoint(
    video: UploadFile = File(...),
    timestamp: str = Form(...),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
):
    summary = await analyze_request(video, timestamp, session_id, driver_id)
    return HeadPoseResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        pitchdown_avg_30s=summary.pitchdown_avg,
        pitchdown_max_30s=summary.pitchdown_max,
        droop_time_30s=summary.droop_time,
        droop_duty_30s=summary.droop_duty,
        pitch_thresh_Tp=summary.pitch_threshold,
    )


@app.post("/api/yawning", response_model=YawnResponse)
async def yawning_endpoint(
    video: UploadFile = File(...),
    timestamp: str = Form(...),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
):
    summary = await analyze_request(video, timestamp, session_id, driver_id)
    return YawnResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        yawn_count_30s=summary.yawn_count,
        yawn_time_30s=summary.yawn_time,
        yawn_duty_30s=summary.yawn_duty,
        yawn_peak_30s=summary.yawn_peak,
    )


@app.post("/api/quality", response_model=QualityResponse)
async def quality_endpoint(
    video: UploadFile = File(...),
    timestamp: str = Form(...),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
):
    summary = await analyze_request(video, timestamp, session_id, driver_id)
    return QualityResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        confidence=summary.confidence_label,
        fps=summary.fps_observed,
    )


@app.post("/api/window", response_model=WindowAggregateResponse)
async def aggregate_endpoint(
    video: UploadFile = File(...),
    timestamp: str = Form(...),
    session_id: str | None = Form(None),
    driver_id: str | None = Form(None),
):
    summary = await analyze_request(video, timestamp, session_id, driver_id)
    return WindowAggregateResponse(
        ts_end=summary.ts_end_iso,
        session_id=summary.session_id,
        driver_id=summary.driver_id,
        PERCLOS=summary.perclos_percent,
        perclos_30s=summary.perclos_ratio,
        ear_thresh_T=summary.ear_threshold,
        pitchdown_avg_30s=summary.pitchdown_avg,
        pitchdown_max_30s=summary.pitchdown_max,
        droop_time_30s=summary.droop_time,
        droop_duty_30s=summary.droop_duty,
        pitch_thresh_Tp=summary.pitch_threshold,
        yawn_count_30s=summary.yawn_count,
        yawn_time_30s=summary.yawn_time,
        yawn_duty_30s=summary.yawn_duty,
        yawn_peak_30s=summary.yawn_peak,
        confidence=summary.confidence_label,
        fps=summary.fps_observed,
    )


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
"""FastAPI entrypoint wiring request handlers to analyzers and simulators."""
