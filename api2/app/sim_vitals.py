"""Derive heart rate and HRV signals from the latest driver state."""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Tuple

from fastapi import HTTPException

from .config import VITALS_CONFIG
from .models import HRSimResponse, HRVSimResponse, SimRange, VitalsSimRequest, VitalsSimResponse
from .state_store import GLOBAL_STATE_STORE

@dataclass
class _MetricCacheEntry:
    value: float
    timestamp: float


class VitalsSimulator:
    def __init__(self, config=VITALS_CONFIG):
        self.config = config
        self._metric_cache: Dict[Tuple[str, str, str], _MetricCacheEntry] = {}

    def simulate_hr(self, req: VitalsSimRequest) -> HRSimResponse:
        info = self._resolve_state(req)
        value, rng = self._simulate_metric("hr", req, info)
        now = datetime.now(timezone.utc)
        return HRSimResponse(
            ts=now,
            session_id=req.session_id,
            driver_id=req.driver_id,
            state_used=info.state,
            confidence=info.confidence,
            hr_bpm=value,
            range_used=SimRange(min=info.range_hr[0], max=info.range_hr[1]),
            seed=req.seed,
        )

    def simulate_hrv(self, req: VitalsSimRequest) -> HRVSimResponse:
        info = self._resolve_state(req)
        value, _ = self._simulate_metric("hrv", req, info)
        now = datetime.now(timezone.utc)
        return HRVSimResponse(
            ts=now,
            session_id=req.session_id,
            driver_id=req.driver_id,
            state_used=info.state,
            confidence=info.confidence,
            hrv_rmssd_ms=value,
            range_used=SimRange(min=info.range_hrv[0], max=info.range_hrv[1]),
            seed=req.seed,
        )

    def simulate_vitals(self, req: VitalsSimRequest) -> VitalsSimResponse:
        info = self._resolve_state(req)
        hr_value, _ = self._simulate_metric("hr", req, info)
        hrv_value, _ = self._simulate_metric("hrv", req, info)
        now = datetime.now(timezone.utc)
        return VitalsSimResponse(
            ts=now,
            session_id=req.session_id,
            driver_id=req.driver_id,
            state_used=info.state,
            confidence=info.confidence,
            hr_bpm=hr_value,
            hrv_rmssd_ms=hrv_value,
            ranges_used={
                "hr": SimRange(min=info.range_hr[0], max=info.range_hr[1]),
                "hrv": SimRange(min=info.range_hrv[0], max=info.range_hrv[1]),
            },
            seed=req.seed,
        )

    # ------------------------------------------------------------------

    @dataclass
    class _StateInfo:
        state: str
        confidence: str
        range_hr: Tuple[float, float]
        range_hrv: Tuple[float, float]

    def _resolve_state(self, req: VitalsSimRequest) -> _StateInfo:
        state_name = req.state
        confidence = "N/A"
        if state_name:
            state_name = state_name.title()
        else:
            record = GLOBAL_STATE_STORE.latest(req.session_id, req.driver_id, max_age_seconds=120)
            if not record:
                raise HTTPException(status_code=400, detail="no recent state for session/driver")
            state_name = record.state
            confidence = record.confidence
        if state_name not in self.config.ranges:
            raise HTTPException(status_code=400, detail=f"unsupported state '{state_name}'")
        base_hr = list(self.config.ranges[state_name]["hr"])
        base_hrv = list(self.config.ranges[state_name]["hrv"])
        if req.widen_for_low_conf and confidence and confidence != "OK":
            widen = self.config.low_conf_widen_pct
            base_hr[0] = max(0.0, base_hr[0] * (1 - widen))
            base_hr[1] = base_hr[1] * (1 + widen)
            base_hrv[0] = max(0.0, base_hrv[0] * (1 - widen))
            base_hrv[1] = base_hrv[1] * (1 + widen)
        return self._StateInfo(
            state=state_name,
            confidence=confidence,
            range_hr=(base_hr[0], base_hr[1]),
            range_hrv=(base_hrv[0], base_hrv[1]),
        )

    def _simulate_metric(self, metric: str, req: VitalsSimRequest, info: _StateInfo) -> Tuple[float, float]:
        rng = self._build_rng(req.seed, metric)
        min_val, max_val = info.range_hr if metric == "hr" else info.range_hrv
        sampled = self._sample_trunc_normal(rng, min_val, max_val)
        cache_key = (req.session_id, req.driver_id, metric)
        now = time.time()
        use_cache = req.seed is None
        last_entry = None
        if use_cache:
            last_entry = self._metric_cache.get(cache_key)
            if last_entry and now - last_entry.timestamp > self.config.cache_ttl_seconds:
                last_entry = None
        base_value = sampled
        if last_entry:
            base_value = (
                self.config.inertia_keep * last_entry.value
                + self.config.inertia_sample * sampled
                + rng.gauss(0, self.config.noise_std_hr if metric == "hr" else self.config.noise_std_hrv)
            )
        osc_time = now if req.seed is None else req.seed
        osc = self._oscillation(metric, osc_time)
        value = base_value + osc
        value = max(min_val, min(max_val, value))
        if use_cache:
            self._metric_cache[cache_key] = _MetricCacheEntry(value=value, timestamp=now)
        return value, now

    def _build_rng(self, seed: int | None, metric: str) -> random.Random:
        if seed is None:
            return random.Random()
        return random.Random(seed + (1 if metric == "hr" else 7))

    def _sample_trunc_normal(self, rng: random.Random, min_val: float, max_val: float) -> float:
        if min_val >= max_val:
            return min_val
        mid = (min_val + max_val) / 2
        sigma = (max_val - min_val) / max(self.config.sigma_divider, 1e-3)
        for _ in range(8):
            val = rng.gauss(mid, sigma)
            if min_val <= val <= max_val:
                return val
        return max(min_val, min(max_val, rng.uniform(min_val, max_val)))

    def _oscillation(self, metric: str, t_value: float) -> float:
        if metric == "hr":
            return self.config.osc_amp_hr * math.sin(2 * math.pi * t_value / self.config.osc_period_hr)
        return self.config.osc_amp_hrv * math.sin(2 * math.pi * t_value / self.config.osc_period_hrv)

    def clear_cache(self):
        self._metric_cache.clear()
