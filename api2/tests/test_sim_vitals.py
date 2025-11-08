from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.models import StateResponse, StateReason, ThresholdsUsed, VitalsSimRequest
from app.sim_vitals import VitalsSimulator
from app.state_store import GLOBAL_STATE_STORE


def make_state(state: str, confidence: str = "OK"):
    response = StateResponse(
        ts_end=datetime.now(timezone.utc),
        session_id="sess",
        driver_id="drv",
        state=state,
        risk_score=80,
        state_confidence=confidence,
        reasons=[StateReason(signal="perclos_30s", value=0.2, threshold=0.15, relation=">=")],
        thresholds_used=ThresholdsUsed(
            perclos_high_30s=0.25,
            perclos_concerning_30s=0.15,
            perclos_elevated_30s=0.08,
            yawn_duty_concerning=0.15,
            yawn_duty_high=0.25,
            droop_duty_concerning=0.2,
            droop_duty_high=0.4,
            pitchdown_max_flag=25.0,
        ),
    )
    GLOBAL_STATE_STORE.record(response)


@pytest.fixture(autouse=True)
def reset_store():
    GLOBAL_STATE_STORE.clear()
    yield


def test_hr_deterministic_with_seed():
    sim = VitalsSimulator()
    make_state("Drowsy")
    req = VitalsSimRequest(session_id="sess", driver_id="drv", seed=42)
    first = sim.simulate_hr(req)
    second = sim.simulate_hr(req)
    assert first.hr_bpm == second.hr_bpm
    assert 60 <= first.hr_bpm <= 75


def test_hrv_widen_for_low_conf():
    sim = VitalsSimulator()
    make_state("Asleep", confidence="LOW")
    req = VitalsSimRequest(session_id="sess", driver_id="drv", widen_for_low_conf=True, seed=123)
    resp = sim.simulate_hrv(req)
    assert resp.range_used.min <= 45  # widened beyond default 50
    assert resp.range_used.max > 110


def test_missing_state_error():
    sim = VitalsSimulator()
    req = VitalsSimRequest(session_id="missing", driver_id="drv")
    with pytest.raises(HTTPException):
        sim.simulate_hr(req)


def test_inertia_applied():
    sim = VitalsSimulator()
    make_state("Lucid")
    req = VitalsSimRequest(session_id="sess", driver_id="drv", seed=7)
    first = sim.simulate_hr(req)
    second = sim.simulate_hr(VitalsSimRequest(session_id="sess", driver_id="drv", seed=8))
    assert abs(second.hr_bpm - first.hr_bpm) < 25  # should not jump entire range
