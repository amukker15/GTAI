from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


@dataclass(slots=True)
class Sample:
    time: float  # seconds from start of video
    ear: Optional[float]
    mar: Optional[float]
    pitch_down: Optional[float]
    confidence: float
    has_face: bool


@dataclass(slots=True)
class StreamMeta:
    fps: float
    frame_count: int
    duration: float | None
    width: int
    height: int


@dataclass(slots=True)
class AnalysisSummary:
    ts_end_iso: datetime
    session_id: Optional[str]
    driver_id: Optional[str]
    perclos_ratio: float
    perclos_percent: float
    ear_threshold: float
    pitchdown_avg: float
    pitchdown_max: float
    droop_time: float
    droop_duty: float
    pitch_threshold: float
    yawn_count: int
    yawn_time: float
    yawn_duty: float
    yawn_peak: float
    confidence_label: str
    fps_observed: float
    # Quality metrics for PERCLOS assessment
    valid_sample_ratio: float = 0.0  # Ratio of samples with valid EAR measurements
    interpolated_sample_ratio: float = 0.0  # Ratio of samples that were interpolated
    high_confidence_ratio: float = 0.0  # Ratio of high-confidence samples
    perclos_confidence_score: float = 0.0  # Overall confidence in PERCLOS measurement (0-1)


class BaseWindowResponse(BaseModel):
    ts_end: datetime = Field(..., description="ISO timestamp at the window end")
    session_id: str | None = Field(default=None)
    driver_id: str | None = Field(default=None)


class PerclosResponse(BaseWindowResponse):
    PERCLOS: float = Field(..., description="PERCLOS in percent")
    perclos_30s: float = Field(..., description="Fraction during the window")
    ear_thresh_T: float = Field(..., description="Adaptive EAR threshold")


class HeadPoseResponse(BaseWindowResponse):
    pitchdown_avg_30s: float
    pitchdown_max_30s: float
    droop_time_30s: float
    droop_duty_30s: float
    pitch_thresh_Tp: float


class YawnResponse(BaseWindowResponse):
    yawn_count_30s: int
    yawn_time_30s: float
    yawn_duty_30s: float
    yawn_peak_30s: float | None = Field(default=None)


class QualityResponse(BaseWindowResponse):
    confidence: str = Field(..., description="OK/Low depending on face confidence")
    fps: float = Field(..., description="Observed frames per second inside the window")


class WindowAggregateResponse(
    BaseWindowResponse
):  # helpful if the client wants everything with one call
    PERCLOS: float
    perclos_30s: float
    ear_thresh_T: float
    pitchdown_avg_30s: float
    pitchdown_max_30s: float
    droop_time_30s: float
    droop_duty_30s: float
    pitch_thresh_Tp: float
    yawn_count_30s: int
    yawn_time_30s: float
    yawn_duty_30s: float
    yawn_peak_30s: float | None
    confidence: str
    fps: float


class StateReason(BaseModel):
    signal: str
    value: float | str | None = None
    threshold: float | str | None = None
    relation: str


class ThresholdsUsed(BaseModel):
    perclos_high_30s: float
    perclos_concerning_30s: float
    perclos_elevated_30s: float
    yawn_duty_concerning: float
    yawn_duty_high: float
    droop_duty_concerning: float
    droop_duty_high: float
    pitchdown_max_flag: float


class StateRequest(BaseModel):
    ts_end: datetime
    session_id: str
    driver_id: str
    perclos_30s: float | None = None
    ear_thresh_T: float | None = None
    pitchdown_avg_30s: float | None = None
    pitchdown_max_30s: float | None = None
    droop_time_30s: float | None = None
    droop_duty_30s: float | None = None
    pitch_thresh_Tp: float | None = None
    yawn_count_30s: int | None = None
    yawn_time_30s: float | None = None
    yawn_duty_30s: float | None = None
    yawn_peak_30s: float | None = None
    confidence: str | None = None
    fps: float | None = None


class StateResponse(BaseModel):
    ts_end: datetime
    session_id: str
    driver_id: str
    state: str
    risk_score: int
    state_confidence: str
    reasons: list[StateReason]
    thresholds_used: ThresholdsUsed


class SimRange(BaseModel):
    min: float
    max: float


class VitalsSimRequest(BaseModel):
    session_id: str
    driver_id: str
    state: str | None = Field(default=None)
    seed: int | None = Field(default=None)
    widen_for_low_conf: bool = Field(default=False)


class HRSimResponse(BaseModel):
    ts: datetime
    session_id: str
    driver_id: str
    state_used: str
    confidence: str
    hr_bpm: float
    range_used: SimRange
    seed: int | None = None


class HRVSimResponse(BaseModel):
    ts: datetime
    session_id: str
    driver_id: str
    state_used: str
    confidence: str
    hrv_rmssd_ms: float
    range_used: SimRange
    seed: int | None = None


class VitalsSimResponse(BaseModel):
    ts: datetime
    session_id: str
    driver_id: str
    state_used: str
    confidence: str
    hr_bpm: float
    hrv_rmssd_ms: float
    ranges_used: dict[str, SimRange]
    seed: int | None = None
