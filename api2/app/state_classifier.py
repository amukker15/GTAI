"""Rule-based driver state classification with hysteresis."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Tuple

from .config import STATE_THRESHOLDS, StateThresholds
from .models import StateReason, StateRequest, StateResponse, ThresholdsUsed

logger = logging.getLogger("lucid.state")


@dataclass
class _StateCacheEntry:
    state: str
    timestamp: datetime
    consecutive_lower: int = 0


class DriverStateClassifier:
    def __init__(self, thresholds: StateThresholds | None = None):
        self.thresholds = thresholds or STATE_THRESHOLDS
        self._cache: Dict[Tuple[str, str], _StateCacheEntry] = {}

    def classify(self, bucket: StateRequest) -> StateResponse:
        seen = set()
        reasons: list[StateReason] = []
        signals = self._extract_signals(bucket, reasons, seen)

        state_confidence = "OK"
        confidence_label = (bucket.confidence or "OK").upper()
        if confidence_label != "OK":
            self._push_reason(
                reasons,
                seen,
                signal="confidence",
                value=confidence_label,
                threshold="OK",
                relation="!=",
            )
            state_confidence = "LOW"
        if signals["fps"] < self.thresholds.fps_min_ok:
            self._push_reason(
                reasons,
                seen,
                signal="fps",
                value=signals["fps"],
                threshold=self.thresholds.fps_min_ok,
                relation="<",
            )
            state_confidence = "LOW"

        asleep_reasons = self._evaluate_asleep(signals, seen)
        drowsy_reasons = [] if asleep_reasons else self._evaluate_drowsy(signals, seen)
        lucid_reasons = [] if (asleep_reasons or drowsy_reasons) else self._evaluate_lucid(signals, seen)

        raw_state = "Lucid"
        if asleep_reasons:
            raw_state = "Asleep"
            reasons.extend(asleep_reasons)
        elif drowsy_reasons:
            raw_state = "Drowsy"
            reasons.extend(drowsy_reasons)
        else:
            reasons.extend(lucid_reasons)

        risk_score = self._compute_risk(signals)
        if raw_state == "Asleep":
            risk_score = max(risk_score, 90)

        final_state = self._apply_hysteresis(bucket.session_id, bucket.driver_id, raw_state, risk_score)

        thresholds_payload = ThresholdsUsed(
            perclos_high_30s=self.thresholds.perclos_high_30s,
            perclos_concerning_30s=self.thresholds.perclos_concerning_30s,
            perclos_elevated_30s=self.thresholds.perclos_elevated_30s,
            yawn_duty_concerning=self.thresholds.yawn_duty_concerning,
            yawn_duty_high=self.thresholds.yawn_duty_high,
            droop_duty_concerning=self.thresholds.droop_duty_concerning,
            droop_duty_high=self.thresholds.droop_duty_high,
            pitchdown_max_flag=self.thresholds.pitchdown_flag,
        )

        logger.info(
            "bucket_state",
            extra={
                "session_id": bucket.session_id,
                "driver_id": bucket.driver_id,
                "ts_end": bucket.ts_end.isoformat(),
                "state_raw": raw_state,
                "state_final": final_state,
                "risk_score": risk_score,
                "state_confidence": state_confidence,
                "reasons": [reason.model_dump() for reason in reasons],
                "thresholds_used": thresholds_payload.model_dump(),
                "fps": signals["fps"],
            },
        )

        return StateResponse(
            ts_end=bucket.ts_end,
            session_id=bucket.session_id,
            driver_id=bucket.driver_id,
            state=final_state,
            risk_score=risk_score,
            state_confidence=state_confidence,
            reasons=reasons,
            thresholds_used=thresholds_payload,
        )

    # ------------------------------------------------------------------

    def _extract_signals(self, bucket: StateRequest, reasons: list[StateReason], seen: set) -> dict:
        signals = {}
        clip_fields = {
            "perclos_30s": (0.0, 1.0),
            "yawn_duty_30s": (0.0, 1.0),
            "droop_duty_30s": (0.0, 1.0),
        }
        defaults = {
            "perclos_30s": 0.0,
            "ear_thresh_T": 0.0,
            "pitchdown_avg_30s": 0.0,
            "pitchdown_max_30s": 0.0,
            "droop_time_30s": 0.0,
            "droop_duty_30s": 0.0,
            "pitch_thresh_Tp": 0.0,
            "yawn_count_30s": 0,
            "yawn_time_30s": 0.0,
            "yawn_duty_30s": 0.0,
            "yawn_peak_30s": 0.0,
            "confidence": "OK",
            "fps": 0.0,
        }
        for field, fallback in defaults.items():
            value = getattr(bucket, field)
            if value is None:
                value = fallback
                self._push_reason(
                    reasons,
                    seen,
                    signal=f"missing:{field}",
                    value=None,
                    threshold=0,
                    relation="missing",
                )
            if field in clip_fields:
                min_val, max_val = clip_fields[field]
                value = max(min_val, min(max_val, value))
            signals[field] = value
        return signals

    def _evaluate_asleep(self, signals, seen):
        reasons: list[StateReason] = []
        perclos = signals["perclos_30s"]
        yawn_duty = signals["yawn_duty_30s"]
        droop_duty = signals["droop_duty_30s"]
        pitch_max = signals["pitchdown_max_30s"]

        if perclos >= self.thresholds.perclos_asleep_strict:
            self._push_reason(reasons, seen, "perclos_30s", perclos, self.thresholds.perclos_asleep_strict, ">=")

        if perclos >= self.thresholds.perclos_asleep_combo and droop_duty >= self.thresholds.droop_duty_asleep:
            self._push_reason(reasons, seen, "perclos_30s", perclos, self.thresholds.perclos_asleep_combo, ">=")
            self._push_reason(reasons, seen, "droop_duty_30s", droop_duty, self.thresholds.droop_duty_asleep, ">=")

        if perclos >= self.thresholds.perclos_asleep_combo and pitch_max >= self.thresholds.pitchdown_flag:
            self._push_reason(reasons, seen, "perclos_30s", perclos, self.thresholds.perclos_asleep_combo, ">=")
            self._push_reason(reasons, seen, "pitchdown_max_30s", pitch_max, self.thresholds.pitchdown_flag, ">=")

        if yawn_duty >= self.thresholds.yawn_duty_asleep and perclos >= self.thresholds.perclos_concerning_30s:
            self._push_reason(reasons, seen, "yawn_duty_30s", yawn_duty, self.thresholds.yawn_duty_asleep, ">=")
            self._push_reason(reasons, seen, "perclos_30s", perclos, self.thresholds.perclos_concerning_30s, ">=")

        return reasons

    def _evaluate_drowsy(self, signals, seen):
        reasons: list[StateReason] = []
        perclos = signals["perclos_30s"]
        yawn_duty = signals["yawn_duty_30s"]
        yawn_count = signals["yawn_count_30s"]
        droop_duty = signals["droop_duty_30s"]
        pitch_max = signals["pitchdown_max_30s"]

        if perclos >= self.thresholds.perclos_high_30s:
            self._push_reason(reasons, seen, "perclos_30s", perclos, self.thresholds.perclos_high_30s, ">=")

        if perclos >= self.thresholds.perclos_concerning_30s and (
            yawn_duty >= self.thresholds.yawn_duty_concerning or yawn_count >= 2
        ):
            self._push_reason(reasons, seen, "perclos_30s", perclos, self.thresholds.perclos_concerning_30s, ">=")
            if yawn_duty >= self.thresholds.yawn_duty_concerning:
                self._push_reason(reasons, seen, "yawn_duty_30s", yawn_duty, self.thresholds.yawn_duty_concerning, ">=")
            if yawn_count >= 2:
                self._push_reason(reasons, seen, "yawn_count_30s", yawn_count, 2, ">=")

        if droop_duty >= self.thresholds.droop_duty_concerning:
            self._push_reason(reasons, seen, "droop_duty_30s", droop_duty, self.thresholds.droop_duty_concerning, ">=")

        if pitch_max >= self.thresholds.pitchdown_drowsy_flag:
            self._push_reason(reasons, seen, "pitchdown_max_30s", pitch_max, self.thresholds.pitchdown_drowsy_flag, ">=")

        return reasons

    def _evaluate_lucid(self, signals, seen):
        reasons: list[StateReason] = []
        perclos = signals["perclos_30s"]
        if perclos >= self.thresholds.perclos_elevated_30s:
            self._push_reason(reasons, seen, "perclos_30s", perclos, self.thresholds.perclos_elevated_30s, "≈")
        return reasons

    def _compute_risk(self, signals: dict) -> int:
        def clamp01(value: float) -> float:
            return max(0.0, min(1.0, value))

        perclos = signals["perclos_30s"]
        yawn_duty = signals["yawn_duty_30s"]
        droop_duty = signals["droop_duty_30s"]

        p = clamp01((perclos - self.thresholds.perclos_elevated_30s) / (self.thresholds.perclos_high_30s - self.thresholds.perclos_elevated_30s))
        y = clamp01((yawn_duty - self.thresholds.yawn_duty_elevated) / (self.thresholds.yawn_duty_high - self.thresholds.yawn_duty_elevated))
        d = clamp01((droop_duty - 0.10) / (self.thresholds.droop_duty_high - 0.10))
        score01 = 0.5 * p + 0.2 * y + 0.3 * d
        return round(100 * score01)

    def _apply_hysteresis(self, session_id: str, driver_id: str, raw_state: str, risk_score: int) -> str:
        now = datetime.now(timezone.utc)
        key = (session_id, driver_id)
        entry = self._cache.get(key)
        if entry and (now - entry.timestamp).total_seconds() > self.thresholds.hysteresis_seconds:
            entry = None
            self._cache.pop(key, None)

        if not entry:
            self._cache[key] = _StateCacheEntry(state=raw_state, timestamp=now, consecutive_lower=0)
            return raw_state

        prev_state = entry.state
        severity = {"Lucid": 0, "Drowsy": 1, "Asleep": 2}
        prev_sev = severity.get(prev_state, 0)
        raw_sev = severity.get(raw_state, 0)

        if raw_sev > prev_sev:
            final_state = raw_state
            consecutive = 0
        elif raw_sev < prev_sev:
            new_consecutive = entry.consecutive_lower + 1
            allow = risk_score < 40 or new_consecutive >= 2
            if allow:
                final_state = raw_state
                consecutive = 0
            else:
                final_state = prev_state
                consecutive = new_consecutive
        else:
            final_state = raw_state
            consecutive = 0

        self._cache[key] = _StateCacheEntry(state=final_state, timestamp=now, consecutive_lower=consecutive)
        return final_state

    def _push_reason(self, reasons, seen, signal, value, threshold, relation):
        key = (signal, relation, threshold)
        if key in seen:
            return
        seen.add(key)
        reasons.append(
            StateReason(
                signal=signal,
                value=value,
                threshold=threshold,
                relation=relation,
            )
        )
