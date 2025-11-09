from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Sequence, Tuple


@dataclass(frozen=True)
class AnalyzerConfig:
    """Tunables shared by every metric computation."""

    window_seconds: float = 30.0
    confidence_threshold: float = 0.65

    ear_threshold_default: float = 0.21
    ear_threshold_bounds: tuple[float, float] = (0.16, 0.30)
    ear_threshold_percentile: float = 35.0

    mar_threshold_default: float = 0.60
    mar_threshold_bounds: tuple[float, float] = (0.45, 0.75)
    mar_threshold_percentile: float = 70.0

    pitch_threshold_default: float = 15.0
    pitch_threshold_bounds: tuple[float, float] = (10.0, 25.0)
    pitch_threshold_percentile: float = 65.0

    yawn_start_hold: float = 0.8  # seconds
    yawn_end_hold: float = 0.3  # seconds
    yawn_refractory: float = 2.0  # seconds

    iris_indices: Sequence[int] = (468, 469, 470, 471, 472, 473)
    ear_pairs: dict[str, Sequence[int]] = field(
        default_factory=lambda: {
            "left": (33, 133, 160, 144, 158, 153),
            "right": (263, 362, 387, 373, 385, 380),
        }
    )
    mar_pairs: Sequence[tuple[int, int]] = ((13, 14), (82, 87), (312, 402))
    mouth_corners: tuple[int, int] = (61, 291)


@dataclass(frozen=True)
class StateThresholds:
    perclos_high_30s: float = 0.25
    perclos_concerning_30s: float = 0.15
    perclos_elevated_30s: float = 0.08
    perclos_asleep_strict: float = 0.50
    perclos_asleep_combo: float = 0.34
    yawn_duty_concerning: float = 0.15
    yawn_duty_high: float = 0.25
    yawn_duty_asleep: float = 0.30
    yawn_duty_elevated: float = 0.10
    droop_duty_concerning: float = 0.20
    droop_duty_high: float = 0.40
    droop_duty_asleep: float = 0.30
    pitchdown_flag: float = 40.0
    pitchdown_drowsy_flag: float = 40.0
    fps_min_ok: float = 10.0
    hysteresis_seconds: int = 300


@dataclass(frozen=True)
class VitalsConfig:
    ranges: Dict[str, Dict[str, Tuple[float, float]]] = field(
        default_factory=lambda: {
            "Lucid": {"hr": (70.0, 90.0), "hrv": (15.0, 35.0)},
            "Drowsy": {"hr": (60.0, 75.0), "hrv": (30.0, 60.0)},
            "Asleep": {"hr": (45.0, 60.0), "hrv": (50.0, 110.0)},
        }
    )
    sigma_divider: float = 6.0
    inertia_keep: float = 0.85
    inertia_sample: float = 0.15
    noise_std_hr: float = 1.5
    noise_std_hrv: float = 4.0
    osc_amp_hr: float = 2.0
    osc_period_hr: float = 20.0
    osc_amp_hrv: float = 6.0
    osc_period_hrv: float = 30.0
    cache_ttl_seconds: int = 300
    low_conf_widen_pct: float = 0.10


POSE_MODEL: Sequence[tuple[int, tuple[float, float, float]]] = (
    (1, (0.0, 0.0, 0.0)),
    (152, (0.0, -63.6, -12.5)),
    (33, (-43.3, 32.7, -26.0)),
    (263, (43.3, 32.7, -26.0)),
    (61, (-28.9, -28.9, -24.1)),
    (291, (28.9, -28.9, -24.1)),
)


STATE_THRESHOLDS = StateThresholds()
VITALS_CONFIG = VitalsConfig()
