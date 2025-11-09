from app.analyzer import WindowAnalyzer
from app.models import Sample


def make_sample(time: float, mar: float | None, conf: float = 0.9, has_face: bool = True) -> Sample:
    return Sample(
        time=time,
        ear=0.3,
        mar=mar,
        pitch_down=0.0,
        confidence=conf,
        has_face=has_face,
    )


def build_samples(start: float, end: float, high_start: float, high_end: float, drop_segment: tuple[float, float] | None = None):
    t = start
    samples: list[Sample] = []
    while t <= end:
        mar = 0.35
        conf = 0.95
        if high_start <= t <= high_end:
            mar = 0.85
        if drop_segment and drop_segment[0] <= t <= drop_segment[1]:
            conf = 0.2
        samples.append(make_sample(round(t, 3), mar, conf))
        t += 0.05
    return samples


def test_detects_yawn_when_mar_above_threshold():
    analyzer = WindowAnalyzer()
    samples = build_samples(0.0, 2.0, 0.2, 1.6)
    events = analyzer._detect_yawns(samples, start=0.0, end=2.0, threshold=0.5)
    assert events, "expected at least one yawn event"
    start_time, end_time, peak = events[0]
    assert 0.15 <= start_time <= 0.25
    assert end_time >= 1.0
    assert peak > 0.8


def test_yawn_survives_brief_confidence_drop():
    analyzer = WindowAnalyzer()
    samples = build_samples(0.0, 2.0, 0.2, 1.6, drop_segment=(0.7, 0.85))
    events = analyzer._detect_yawns(samples, start=0.0, end=2.0, threshold=0.5)
    assert len(events) == 1
    start_time, end_time, _ = events[0]
    # Confidence dip lands in the middle; event should still span the full open-mouth interval
    assert start_time <= 0.25
    assert end_time >= 1.4


def test_short_yawn_still_detected_with_new_holds():
    analyzer = WindowAnalyzer()
    # Only ~0.6s above threshold
    samples = build_samples(0.0, 1.2, 0.3, 0.9)
    events = analyzer._detect_yawns(samples, start=0.0, end=1.2, threshold=0.5)
    assert events, "short yaw should trigger with reduced hold"
    start_time, end_time, _ = events[0]
    assert start_time < 0.4
    assert end_time <= 1.1
