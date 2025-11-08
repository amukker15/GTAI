"""In-memory cache for the most recent `/v1/state` response per driver."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Tuple

from .models import StateResponse


@dataclass
class StateRecord:
    ts_end: datetime
    state: str
    confidence: str
    payload: StateResponse
    stored_at: datetime


class StateStore:
    def __init__(self):
        self._records: Dict[Tuple[str, str], StateRecord] = {}

    def record(self, response: StateResponse) -> None:
        key = (response.session_id, response.driver_id)
        self._records[key] = StateRecord(
            ts_end=response.ts_end,
            state=response.state,
            confidence=response.state_confidence,
            payload=response,
            stored_at=datetime.now(timezone.utc),
        )

    def latest(self, session_id: str, driver_id: str, max_age_seconds: int = 120) -> StateRecord | None:
        key = (session_id, driver_id)
        record = self._records.get(key)
        if not record:
            return None
        max_age = timedelta(seconds=max_age_seconds)
        now = datetime.now(timezone.utc)
        stored_ts = record.stored_at
        if now - stored_ts > max_age:
            return None
        return record

    def clear(self):
        self._records.clear()


GLOBAL_STATE_STORE = StateStore()
