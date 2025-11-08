from __future__ import annotations

"""Small Snowflake helper for this project.

This module provides a tiny wrapper around the Snowflake Python connector. It
reads credentials from environment variables so secrets are not committed to
source control.

Required environment variables:
- SNOWFLAKE_USER
- SNOWFLAKE_PASSWORD
- SNOWFLAKE_ACCOUNT

Optional (recommended to set):
- SNOWFLAKE_WAREHOUSE
- SNOWFLAKE_DATABASE (defaults to LCD_ENDPOINTS)
- SNOWFLAKE_SCHEMA (defaults to PUBLIC)

Usage examples:
>>> from app import snowflake_db
>>> rows = snowflake_db.fetchall("SELECT * FROM DRIVERS")
>>> snowflake_db.execute("INSERT INTO DROWSINESS_MEASUREMENTS (driver_id, ts, perclos) VALUES (%s,%s,%s)", ("drv1", "2025-11-08T08:49:16Z", 0.34))

This keeps the rest of the codebase DB-agnostic while providing a single place
to add connection pooling, retries, or instrumentation later.
"""

from typing import Any, Dict, Iterable, List, Mapping, Sequence
import os
from dotenv import load_dotenv

import snowflake.connector

# Load environment variables from .env file
load_dotenv()

# Defaults (safe to override via environment)
DEFAULT_DB = os.getenv("SNOWFLAKE_DATABASE", "LCD_ENDPOINTS")
DEFAULT_SCHEMA = os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC")


def _env_required(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Environment variable {name} must be set for Snowflake access")
    return v


def get_conn():
    """Return a fresh snowflake.connector connection.

    Caller is responsible for closing the connection (or using a context
    manager). We intentionally create short-lived connections here because it
    keeps code simple; if you need pooling or async support, replace this
    function with a pooled implementation.
    """
    user = _env_required("SNOWFLAKE_USER")
    password = _env_required("SNOWFLAKE_PASSWORD")
    account = _env_required("SNOWFLAKE_ACCOUNT")
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE", DEFAULT_DB)
    schema = os.getenv("SNOWFLAKE_SCHEMA", DEFAULT_SCHEMA)

    conn_kwargs = dict(
        user=user,
        password=password,
        account=account,
        database=database,
        schema=schema,
    )
    if warehouse:
        conn_kwargs["warehouse"] = warehouse

    return snowflake.connector.connect(**conn_kwargs)


def fetchall(query: str, params: Sequence[Any] | None = None) -> List[Dict[str, Any]]:
    """Run a SELECT-style query and return a list of dict rows.

    Example: fetchall("SELECT * FROM DRIVERS WHERE active = %s", (True,))
    """
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(query, params or ())
        cols = [c[0] for c in cur.description] if cur.description else []
        rows = cur.fetchall()
        return [dict(zip(cols, r)) for r in rows]
    finally:
        try:
            cur.close()
        finally:
            conn.close()


def execute(query: str, params: Sequence[Any] | None = None) -> int:
    """Execute a non-SELECT query and return the number of affected rows.

    Example: execute("UPDATE DRIVERS SET last_seen = %s WHERE id = %s", (ts, id))
    """
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(query, params or ())
        # Snowflake reports rowcount for DML
        rowcount = cur.rowcount
        conn.commit()
        return rowcount
    finally:
        try:
            cur.close()
        finally:
            conn.close()


def fetch_drivers() -> List[Dict[str, Any]]:
    """Convenience helper to fetch all rows from the DRIVERS table."""
    # Rely on the connection database/schema being set via env vars.
    return fetchall("SELECT * FROM DRIVERS")


def insert_drowsiness_measurement(data: Mapping[str, Any]) -> int:
    """Insert a dict into DROWSINESS_MEASUREMENTS and return affected row count.

    data: mapping of column -> value. This function builds a parameterized
    INSERT using positional placeholders.
    """
    if not data:
        raise ValueError("data must be a non-empty mapping")
    cols = list(data.keys())
    vals = [data[c] for c in cols]
    placeholders = ",".join(["%s"] * len(cols))
    query = f"INSERT INTO DROWSINESS_MEASUREMENTS ({','.join(cols)}) VALUES ({placeholders})"
    return execute(query, vals)
