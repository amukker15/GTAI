"""Unit tests for PERCLOS integration rules."""

from __future__ import annotations

from app.analyzer import WindowAnalyzer
from app.models import Sample


def make_sample(
    time: float,
    ear: float | None,
    pitch: float | None,
    confidence: float,
    *,
    has_face: bool = True,
) -> Sample:
    return Sample(
        time=time,
        ear=ear,
        mar=None,
        pitch_down=pitch,
        confidence=confidence,
        has_face=has_face,
    )


def integrate_fraction(analyzer: WindowAnalyzer, samples: list[Sample], ear_thresh: float) -> float:
    start = samples[0].time
    end = samples[-1].time
    window = max(end - start, 1e-6)
    active = analyzer._integrate_boolean(  # type: ignore[attr-defined]
        samples,
        start,
        end,
        lambda s: analyzer._is_eye_closed(s, ear_thresh),
    )
    return active / window


def test_perclos_ignores_pitch_only_closures():
    analyzer = WindowAnalyzer()
    samples = [
        make_sample(0.0, 0.30, 28.0, 0.9),
        make_sample(0.5, 0.31, 26.0, 0.9),
        make_sample(1.0, 0.32, 30.0, 0.9),
    ]
    ratio = integrate_fraction(analyzer, samples, ear_thresh=0.2)
    assert ratio == 0.0


def test_perclos_counts_low_conf_as_closed():
    analyzer = WindowAnalyzer()
    sleepy_samples = [
        make_sample(0.0, 0.15, 5.0, 0.4),
        make_sample(0.5, 0.15, 5.0, 0.4),
        make_sample(1.0, 0.15, 5.0, 0.4),
    ]
    ratio_low_conf = integrate_fraction(analyzer, sleepy_samples, ear_thresh=0.2)
    assert ratio_low_conf == 1.0

    confident_samples = [
        make_sample(s.time, s.ear, s.pitch_down, 0.9) for s in sleepy_samples
    ]
    ratio_high_conf = integrate_fraction(analyzer, confident_samples, ear_thresh=0.2)
    assert ratio_high_conf == 1.0


def test_perclos_counts_missing_face_as_closed():
    analyzer = WindowAnalyzer()
    occluded = [
        make_sample(0.0, None, None, 0.0, has_face=False),
        make_sample(0.5, None, None, 0.0, has_face=False),
        make_sample(1.0, None, None, 0.0, has_face=False),
    ]
    ratio = integrate_fraction(analyzer, occluded, ear_thresh=0.2)
    assert ratio == 1.0
