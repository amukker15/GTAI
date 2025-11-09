from datetime import datetime, timezone

from app.state_classifier import DriverStateClassifier
from app.models import StateRequest


def build_request(**overrides):
    base = {
        "ts_end": datetime(2025, 1, 1, tzinfo=timezone.utc),
        "session_id": "session",
        "driver_id": "driver",
        "perclos_30s": 0.0,
        "ear_thresh_T": 0.2,
        "pitchdown_avg_30s": 5.0,
        "pitchdown_max_30s": 5.0,
        "droop_time_30s": 0.0,
        "droop_duty_30s": 0.0,
        "pitch_thresh_Tp": 15.0,
        "yawn_count_30s": 0,
        "yawn_time_30s": 0.0,
        "yawn_duty_30s": 0.0,
        "yawn_peak_30s": 0.0,
        "confidence": "OK",
        "fps": 15.0,
    }
    base.update(overrides)
    return StateRequest(**base)


def test_lucid_sample():
    classifier = DriverStateClassifier()
    request = build_request(perclos_30s=0.05, yawn_duty_30s=0.05, droop_duty_30s=0.05, pitchdown_max_30s=8)
    response = classifier.classify(request)
    assert response.state == "Lucid"
    assert response.risk_score < 25


def test_drowsy_sample():
    classifier = DriverStateClassifier()
    request = build_request(perclos_30s=0.22, yawn_duty_30s=0.18, droop_duty_30s=0.12)
    response = classifier.classify(request)
    assert response.state == "Drowsy"
    # Risk uses the 70/15/15 weighting with normalized ranges,
    # which yields a deterministic score of 32 for this bucket.
    assert response.risk_score == 32
    signals = {reason.signal for reason in response.reasons}
    assert "perclos_30s" in signals
    assert "yawn_duty_30s" in signals


def test_asleep_high_perclos():
    classifier = DriverStateClassifier()
    request = build_request(perclos_30s=0.55, yawn_duty_30s=0.08, droop_duty_30s=0.1)
    response = classifier.classify(request)
    assert response.state == "Asleep"
    assert response.risk_score >= 90


def test_asleep_combo_rules():
    classifier = DriverStateClassifier()
    request = build_request(
        perclos_30s=0.36,
        yawn_duty_30s=0.32,
        droop_duty_30s=0.28,
        pitchdown_max_30s=27,
    )
    response = classifier.classify(request)
    assert response.state == "Asleep"
    signals = {reason.signal for reason in response.reasons}
    assert {"perclos_30s", "yawn_duty_30s"}.issubset(signals)


def test_low_confidence_flag():
    classifier = DriverStateClassifier()
    request = build_request(
        perclos_30s=0.22,
        yawn_duty_30s=0.18,
        droop_duty_30s=0.12,
        confidence="LOW",
        fps=8.0,
    )
    response = classifier.classify(request)
    assert response.state == "Drowsy"
    assert response.state_confidence == "LOW"
    signals = {reason.signal for reason in response.reasons}
    assert "confidence" in signals
    assert "fps" in signals
