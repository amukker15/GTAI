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
            perclos_high_15s=self.thresholds.perclos_high_30s,
            perclos_concerning_15s=self.thresholds.perclos_concerning_30s,
            perclos_elevated_15s=self.thresholds.perclos_elevated_30s,
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
            "perclos_15s": (0.0, 1.0),
            "yawn_duty_15s": (0.0, 1.0),
            "droop_duty_15s": (0.0, 1.0),
        }
        defaults = {
            "perclos_15s": 0.0,
            "ear_thresh_T": 0.0,
            "pitchdown_avg_15s": 0.0,
            "pitchdown_max_15s": 0.0,
            "droop_time_15s": 0.0,
            "droop_duty_15s": 0.0,
            "pitch_thresh_Tp": 0.0,
            "yawn_count_15s": 0,
            "yawn_time_15s": 0.0,
            "yawn_duty_15s": 0.0,
            "yawn_peak_15s": 0.0,
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
        """PERCLOS-first asleep evaluation with confirmatory signals."""
        reasons: list[StateReason] = []
        perclos = signals["perclos_15s"]
        yawn_duty = signals["yawn_duty_15s"]
        yawn_count = signals["yawn_count_15s"]
        droop_duty = signals["droop_duty_15s"]
        pitch_max = signals["pitchdown_max_15s"]

        # A1: Primary asleep rule - PERCLOS ≥ 0.50
        if perclos >= self.thresholds.perclos_asleep_primary:
            self._push_reason(reasons, seen, "perclos_15s", perclos, self.thresholds.perclos_asleep_primary, ">=")
            return reasons

        # A2: Confirmatory asleep rule - PERCLOS ≥ 0.40 AND at least one confirmer
        if perclos >= self.thresholds.perclos_asleep_confirm:
            self._push_reason(reasons, seen, "perclos_15s", perclos, self.thresholds.perclos_asleep_confirm, ">=")
            
            confirmers = []
            if droop_duty >= self.thresholds.droop_duty_asleep:
                confirmers.append("droop")
                self._push_reason(reasons, seen, "droop_duty_15s", droop_duty, self.thresholds.droop_duty_asleep, ">=")
            
            if pitch_max >= self.thresholds.pitchdown_asleep:
                confirmers.append("pitch")
                self._push_reason(reasons, seen, "pitchdown_max_15s", pitch_max, self.thresholds.pitchdown_asleep, ">=")
            
            if yawn_duty >= self.thresholds.yawn_duty_asleep:
                confirmers.append("yawn_duty")
                self._push_reason(reasons, seen, "yawn_duty_15s", yawn_duty, self.thresholds.yawn_duty_asleep, ">=")
            
            if yawn_count >= self.thresholds.yawn_count_threshold:
                confirmers.append("yawn_count")
                self._push_reason(reasons, seen, "yawn_count_15s", yawn_count, self.thresholds.yawn_count_threshold, ">=")
            
            if confirmers:
                return reasons

        # A3: Broad confirmatory asleep rule - PERCLOS ≥ 0.35 AND two confirmers
        if perclos >= self.thresholds.perclos_asleep_broad:
            self._push_reason(reasons, seen, "perclos_15s", perclos, self.thresholds.perclos_asleep_broad, ">=")
            
            confirmers = []
            if droop_duty >= self.thresholds.droop_duty_asleep:
                confirmers.append("droop")
                self._push_reason(reasons, seen, "droop_duty_15s", droop_duty, self.thresholds.droop_duty_asleep, ">=")
            
            if pitch_max >= self.thresholds.pitchdown_asleep:
                confirmers.append("pitch")
                self._push_reason(reasons, seen, "pitchdown_max_15s", pitch_max, self.thresholds.pitchdown_asleep, ">=")
            
            if yawn_duty >= self.thresholds.yawn_duty_asleep:
                confirmers.append("yawn_duty")
                self._push_reason(reasons, seen, "yawn_duty_15s", yawn_duty, self.thresholds.yawn_duty_asleep, ">=")
            
            if yawn_count >= self.thresholds.yawn_count_threshold:
                confirmers.append("yawn_count")
                self._push_reason(reasons, seen, "yawn_count_15s", yawn_count, self.thresholds.yawn_count_threshold, ">=")
            
            if len(confirmers) >= 2:
                return reasons

        # No asleep conditions met - clear reasons and return empty
        reasons.clear()
        return reasons

    def _evaluate_drowsy(self, signals, seen):
        """PERCLOS-first drowsy evaluation with supporting signals."""
        reasons: list[StateReason] = []
        perclos = signals["perclos_15s"]
        yawn_duty = signals["yawn_duty_15s"]
        yawn_count = signals["yawn_count_15s"]
        droop_duty = signals["droop_duty_15s"]
        pitch_max = signals["pitchdown_max_15s"]

        # D1: Primary drowsy rule - 0.25 ≤ PERCLOS < 0.50
        if self.thresholds.perclos_drowsy_primary <= perclos < self.thresholds.perclos_asleep_primary:
            self._push_reason(reasons, seen, "perclos_15s", perclos, self.thresholds.perclos_drowsy_primary, ">=")
            return reasons

        # D2: Assisted drowsy rule - 0.15 ≤ PERCLOS < 0.25 AND any supporter
        if self.thresholds.perclos_drowsy_assist <= perclos < self.thresholds.perclos_drowsy_primary:
            self._push_reason(reasons, seen, "perclos_15s", perclos, self.thresholds.perclos_drowsy_assist, ">=")
            
            supporters = []
            if yawn_duty >= self.thresholds.yawn_duty_drowsy:
                supporters.append("yawn_duty")
                self._push_reason(reasons, seen, "yawn_duty_15s", yawn_duty, self.thresholds.yawn_duty_drowsy, ">=")
            
            if yawn_count >= self.thresholds.yawn_count_threshold:
                supporters.append("yawn_count")
                self._push_reason(reasons, seen, "yawn_count_15s", yawn_count, self.thresholds.yawn_count_threshold, ">=")
            
            if droop_duty >= self.thresholds.droop_duty_asleep:
                supporters.append("droop")
                self._push_reason(reasons, seen, "droop_duty_15s", droop_duty, self.thresholds.droop_duty_asleep, ">=")
            
            if pitch_max >= self.thresholds.pitchdown_drowsy:
                supporters.append("pitch")
                self._push_reason(reasons, seen, "pitchdown_max_15s", pitch_max, self.thresholds.pitchdown_drowsy, ">=")
            
            if supporters:
                return reasons

        # No drowsy conditions met - clear reasons and return empty
        reasons.clear()
        return reasons

    def _evaluate_lucid(self, signals, seen):
        """Lucid evaluation with optional near-threshold warning."""
        reasons: list[StateReason] = []
        perclos = signals["perclos_15s"]
        
        # Optional: Add near-threshold warning for values approaching drowsy range
        if perclos >= self.thresholds.perclos_lucid_near:
            self._push_reason(reasons, seen, "perclos_15s", perclos, self.thresholds.perclos_lucid_near, "near_threshold")
        
        return reasons

    def _compute_risk(self, signals: dict) -> int:
        """Compute risk score heavily weighted toward PERCLOS (70/15/15 split)."""
        def clamp01(value: float) -> float:
            return max(0.0, min(1.0, value))

        perclos = signals["perclos_15s"]
        yawn_duty = signals["yawn_duty_15s"]
        droop_duty = signals["droop_duty_15s"]

        # Normalize to 0-1 using the new risk scoring ranges
        p = clamp01((perclos - self.thresholds.perclos_risk_min) / (self.thresholds.perclos_risk_max - self.thresholds.perclos_risk_min))
        y = clamp01((yawn_duty - self.thresholds.yawn_risk_min) / (self.thresholds.yawn_risk_max - self.thresholds.yawn_risk_min))
        d = clamp01((droop_duty - self.thresholds.droop_risk_min) / (self.thresholds.droop_risk_max - self.thresholds.droop_risk_min))
        
        # Weight: 70% PERCLOS, 15% yawn, 15% droop
        score01 = 0.7 * p + 0.15 * y + 0.15 * d
        return round(100 * score01)

    def _apply_hysteresis(self, session_id: str, driver_id: str, raw_state: str, risk_score: int) -> str:
        """Apply PERCLOS-anchored hysteresis to reduce state flip-flop."""
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
            # Upgrading severity - allow immediately
            final_state = raw_state
            consecutive = 0
        elif raw_sev < prev_sev:
            # Downgrading severity - require two consecutive buckets OR low risk
            new_consecutive = entry.consecutive_lower + 1
            allow = risk_score < 40 or new_consecutive >= 2
            if allow:
                final_state = raw_state
                consecutive = 0
            else:
                final_state = prev_state
                consecutive = new_consecutive
        else:
            # Same severity
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
