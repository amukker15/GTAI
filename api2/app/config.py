from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Sequence, Tuple


@dataclass(frozen=True)
class AnalyzerConfig:
    """Tunables shared by every metric computation."""

    window_seconds: float = 15.0
    confidence_threshold: float = 0.5  # Lowered for better glasses/lighting handling
    down_pitch_gate_deg: float = 25.0  # Slightly more lenient for head pose

    ear_threshold_default: float = 0.20  # Slightly lower default
    ear_threshold_bounds: tuple[float, float] = (0.15, 0.32)  # Wider bounds for adaptation
    ear_threshold_percentile: float = 30.0  # Lower percentile for better adaptation

    mar_threshold_default: float = 0.60
    mar_threshold_bounds: tuple[float, float] = (0.45, 0.75)
    mar_threshold_percentile: float = 70.0

    pitch_threshold_default: float = 15.0
    pitch_threshold_bounds: tuple[float, float] = (10.0, 25.0)
    pitch_threshold_percentile: float = 65.0

    # Yawns can be fairly quick in real-world footage, so keep the hold / refractory windows short.
    yawn_start_hold: float = 0.5  # seconds
    yawn_end_hold: float = 0.2  # seconds
    yawn_refractory: float = 1.0  # seconds

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
    # PERCLOS thresholds (PERCLOS-first approach) - Updated for realistic classification
    perclos_asleep_primary: float = 0.60  # A1: Primary asleep threshold (raised from 0.50)
    perclos_asleep_confirm: float = 0.50  # A2: Confirmatory asleep threshold (raised from 0.40)
    perclos_asleep_broad: float = 0.45    # A3: Broad confirmatory asleep threshold (raised from 0.35)
    perclos_drowsy_primary: float = 0.30  # D1: Primary drowsy threshold (lowered to capture 32.7%)
    perclos_drowsy_assist: float = 0.20   # D2: Assisted drowsy threshold (raised from 0.15)
    perclos_lucid_near: float = 0.15      # Near threshold for lucid warning (raised from 0.12)
    
    # Supporting signal thresholds for confirmation
    yawn_duty_asleep: float = 0.25        # Confirmatory for asleep
    yawn_duty_drowsy: float = 0.15        # Confirmatory for drowsy
    yawn_count_threshold: int = 1         # Yawn count threshold (adjusted for 15s windows)
    
    droop_duty_asleep: float = 0.20       # Confirmatory for asleep/drowsy
    
    pitchdown_asleep: float = 25.0        # Confirmatory for asleep
    pitchdown_drowsy: float = 20.0        # Confirmatory for drowsy
    
    # Risk scoring normalization ranges
    perclos_risk_min: float = 0.08        # Lower bound for risk scoring
    perclos_risk_max: float = 0.50        # Upper bound for risk scoring
    yawn_risk_min: float = 0.10           # Lower bound for yawn risk
    yawn_risk_max: float = 0.25           # Upper bound for yawn risk
    droop_risk_min: float = 0.10          # Lower bound for droop risk
    droop_risk_max: float = 0.40          # Upper bound for droop risk
    
    # System thresholds
    fps_min_ok: float = 10.0
    hysteresis_seconds: int = 300
    
    # Legacy compatibility (updated to match new thresholds)
    perclos_high_30s: float = 0.30       # Updated to match perclos_drowsy_primary
    perclos_concerning_30s: float = 0.20  # Updated to match perclos_drowsy_assist
    perclos_elevated_30s: float = 0.15    # Updated to match perclos_lucid_near
    perclos_asleep_strict: float = 0.60   # Updated to match perclos_asleep_primary
    perclos_asleep_combo: float = 0.45    # Updated to match perclos_asleep_broad
    yawn_duty_concerning: float = 0.15
    yawn_duty_high: float = 0.25
    yawn_duty_elevated: float = 0.10
    droop_duty_concerning: float = 0.20
    droop_duty_high: float = 0.40
    pitchdown_flag: float = 40.0
    pitchdown_drowsy_flag: float = 40.0


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
