"""Live Snowflake + API tester

This script connects to Snowflake (using env vars or .env), then finds all video
files in `api2/videos/` and, for each file, posts three analysis requests to
`/api/window` at timestamps 30, 60 and 90 seconds. For each successful analysis
response the script inserts a row into
`DROWSINESS_MEASUREMENTS` with columns:
  - driver_id (file stem)
  - measured_at (current UTC timestamp)
  - perclos_30s, pitchdown_avg_30s, pitchdown_max_30s,
    droop_time_30s, droop_duty_30s,
    yawn_count_30s, yawn_time_30s, yawn_duty_30s, yawn_peak_30s

Usage (PowerShell):
  $env:SNOWFLAKE_USER = "FAWAZSABIR"
  $env:SNOWFLAKE_PASSWORD = "..."
  $env:SNOWFLAKE_ACCOUNT = "NV61963"
  $env:SNOWFLAKE_WAREHOUSE = "COMPUTE_WH"
  python .\scripts\test_snowflake.py

You can override the upload target with API_BASE_URL (default http://localhost:8000).
"""

from __future__ import annotations

import os
import sys
<<<<<<< Updated upstream
from datetime import datetime, timezone
=======
import json
import traceback
from pathlib import Path
from datetime import datetime
>>>>>>> Stashed changes
from typing import Any

try:
    import dotenv
    dotenv.load_dotenv()
except Exception:
    pass

try:
    import requests
except Exception:
    requests = None  # we'll detect and exit politely later

import snowflake.connector


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        print(f"ERROR: environment variable {name} is required", file=sys.stderr)
        sys.exit(2)
    return v


def insert_measurement_row(
    cur,
    conn,
    database: str | None,
    schema: str | None,
    payload: dict[str, Any],
    fallback_driver: str,
    fallback_session: str,
    ts_seconds: int,
) -> None:
    """Insert an aggregate window payload into DROWSINESS_MEASUREMENTS."""

    driver_value = payload.get("driver_id") or fallback_driver or "demo_driver"
    session_value = payload.get("session_id") or fallback_session or f"{driver_value}_session"
    ts_value = payload.get("ts_end")
    if not ts_value:
        ts_value = datetime.now(timezone.utc).isoformat()

    measurement = {
        "driver_id": driver_value,
        "session_id": session_value,
        "ts": ts_value,
        "perclos": payload.get("perclos_30s"),
        "perclos_percent": payload.get("PERCLOS"),
        "ear_threshold": payload.get("ear_thresh_T"),
        "pitchdown_avg": payload.get("pitchdown_avg_30s"),
        "pitchdown_max": payload.get("pitchdown_max_30s"),
        "droop_time": payload.get("droop_time_30s"),
        "droop_duty": payload.get("droop_duty_30s"),
        "pitch_threshold": payload.get("pitch_thresh_Tp"),
        "yawn_count": payload.get("yawn_count_30s"),
        "yawn_time": payload.get("yawn_time_30s"),
        "yawn_duty": payload.get("yawn_duty_30s"),
        "yawn_peak": payload.get("yawn_peak_30s"),
        "confidence": payload.get("confidence"),
        "fps": payload.get("fps"),
    }

    table_parts = [p for p in (database, schema, "DROWSINESS_MEASUREMENTS") if p]
    table_name = ".".join(table_parts) if table_parts else "DROWSINESS_MEASUREMENTS"
    columns = ",".join(measurement.keys())
    placeholders = ",".join(["%s"] * len(measurement))
    sql = f"INSERT INTO {table_name} ({columns}) VALUES ({placeholders})"
    cur.execute(sql, list(measurement.values()))
    conn.commit()
    print(
        f"[Snowflake] Inserted row for driver={driver_value}, session={session_value}, "
        f"timestamp={ts_value}, window={ts_seconds}s"
    )


def main() -> None:
    user = require_env("SNOWFLAKE_USER")
    password = require_env("SNOWFLAKE_PASSWORD")
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    host = os.getenv("SNOWFLAKE_HOST")
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE", "LCD_ENDPOINTS")
    schema = os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC")

    conn_kwargs: dict[str, Any] = dict(
        user=user,
        password=password,
        database=database,
        schema=schema,
    )

    if host:
        conn_kwargs["host"] = host
        if account:
            conn_kwargs["account"] = account
        else:
            conn_kwargs["account"] = host.split(".")[0]
    else:
        if not account:
            print("ERROR: either SNOWFLAKE_ACCOUNT or SNOWFLAKE_HOST must be set", file=sys.stderr)
            sys.exit(2)
        conn_kwargs["account"] = account

    if warehouse:
        conn_kwargs["warehouse"] = warehouse

    return conn_kwargs


def ensure_warehouse(cursor, warehouse: str | None) -> str | None:
    """Try to ensure there's an active warehouse for the session.
    Returns the warehouse in use or None."""
    if not warehouse:
        return None
    try:
        cursor.execute(f"USE WAREHOUSE {warehouse}")
        print(f"Using warehouse: {warehouse}")
        return warehouse
    except Exception as we:
        print(f"Could not set warehouse {warehouse}: {we}")
        # try to discover
    try:
        cursor.execute("SHOW WAREHOUSES")
        wh_rows = cursor.fetchall()
        wh_desc = [d[0].upper() for d in cursor.description]
        name_idx = None
        for i, n in enumerate(wh_desc):
            if n in ("NAME", "WAREHOUSE_NAME"):
                name_idx = i
                break
        if name_idx is None:
            name_idx = 0
        candidates = [r[name_idx] for r in wh_rows]
        print("Available warehouses:")
        for c in candidates:
            print(f"  - {c}")
        for candidate in candidates:
            try:
                cursor.execute(f"USE WAREHOUSE {candidate}")
                print(f"Using discovered warehouse: {candidate}")
                return candidate
            except Exception:
                continue
    except Exception as se:
        print(f"Could not list warehouses: {se}")
    print("Continuing without an active warehouse.")
    return None


def find_video_files(footage_dir: Path) -> list[Path]:
    exts = ("*.mp4", "*.mov", "*.avi", "*.mkv", "*.mpg", "*.webm")
    files: list[Path] = []
    if not footage_dir.exists():
        return files
    for ext in exts:
        files.extend(sorted(footage_dir.glob(ext)))
    return files


def _float_or_none(x: Any):
    try:
        return None if x is None else float(x)
    except Exception:
        return None


def _int_or_none(x: Any):
    try:
        return None if x is None else int(x)
    except Exception:
        return None


def main() -> None:
    if requests is None:
        print("requests is not installed. Install it with: pip install requests", file=sys.stderr)
        sys.exit(2)

    conn_kwargs = build_conn_kwargs()
    database = conn_kwargs.get("database")
    schema = conn_kwargs.get("schema")
    warehouse = conn_kwargs.get("warehouse")

    print("Connecting to Snowflake with:")
    print(f"  user={conn_kwargs.get('user')}")
    print(f"  account={conn_kwargs.get('account')}")
    print(f"  database={database}, schema={schema}")
    if warehouse:
        print(f"  warehouse={warehouse}")

    try:
        conn = snowflake.connector.connect(**conn_kwargs)
    except Exception:
        print("Failed to connect to Snowflake:")
        traceback.print_exc()
        safe = dict(conn_kwargs)
        if "password" in safe:
            safe["password"] = "***REDACTED***"
        print("Connection parameters used:", safe, file=sys.stderr)
        sys.exit(3)

    try:
        cur = conn.cursor()
        try:
            # ensure warehouse
            ensure_warehouse(cur, warehouse)

            cur.execute("SELECT CURRENT_USER(), CURRENT_ACCOUNT()")
            row = cur.fetchone()
            print("Connected as:", row)

            drivers_q = f"SELECT COUNT(*) FROM {database}.{schema}.DRIVERS"
            meas_q = f"SELECT COUNT(*) FROM {database}.{schema}.DROWSINESS_MEASUREMENTS"

            for name, q in [("DRIVERS", drivers_q), ("DROWSINESS_MEASUREMENTS", meas_q)]:
                try:
                    cur.execute(q)
                    c = cur.fetchone()[0]
                    print(f"{name} rows: {c}")
                except Exception as e:
                    print(f"Could not query {name}: {e}")

<<<<<<< Updated upstream
            # --- Batch upload: post every video to /api/window to populate Snowflake ---
            try:
                import requests
            except Exception:
                print("\nrequests library not installed; skipping API tester upload. Install with: pip install requests")
            else:
                from pathlib import Path
                import json

                # Locate the videos directory relative to this script
                script_dir = Path(__file__).parent
                videos_dir = script_dir.parent / "videos"
                if not videos_dir.exists():
                    print("\nNo videos directory found; skipping API uploads.")
                else:
                    truck_map = {
                        "sample1.mov": "LF-101",
                        "sample2.mp4": "LF-202",
                        "sample3.mov": "LF-303",
                        "sample4.mov": "LF-404",
                    }
                    ping_seconds = (30, 60, 90)
                    allowed_exts = {".mp4", ".mov", ".avi", ".mkv", ".mpg", ".webm"}
                    base_url = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip('/')
                    upload_url = f"{base_url}/api/window"
                    processed = 0

                    video_files = sorted(
                        [p for p in videos_dir.iterdir() if p.is_file() and p.suffix.lower() in allowed_exts],
                        key=lambda p: p.name,
                    )

                    if not video_files:
                        print("\nNo video files found in videos/; skipping API uploads.")
                    else:
                        print(f"\nUploading {len(video_files)} videos to {upload_url} at timestamps {ping_seconds}")
                        for video_path in video_files:
                            truck_id = truck_map.get(video_path.name)
                            if not truck_id:
                                print(f"Skipping {video_path.name}: no truck mapping provided.")
                                continue

                            session_id = f"{truck_id}_{video_path.stem}"
                            for ts in ping_seconds:
                                print(f"\nUploading {video_path.name} for truck {truck_id} at t={ts}s")
                                try:
                                    with open(video_path, "rb") as fh:
                                        files = {"video": (video_path.name, fh, "application/octet-stream")}
                                        data = {
                                            "timestamp": str(ts),
                                            "session_id": session_id,
                                            "driver_id": truck_id,
                                        }
                                        resp = requests.post(upload_url, files=files, data=data, timeout=180)
                                    resp.raise_for_status()
                                except Exception as exc:
                                    resp_obj = getattr(exc, "response", None)
                                    code = getattr(resp_obj, "status_code", "n/a")
                                    print(f"Upload failed for {video_path.name} @ {ts}s: {exc} (status {code})")
                                    if resp_obj is not None:
                                        try:
                                            print(resp_obj.text)
                                        except Exception:
                                            pass
                                    continue

                                processed += 1
                                try:
                                    payload = resp.json()
                                    try:
                                        insert_measurement_row(
                                            cur,
                                            conn,
                                            database,
                                            schema,
                                            payload,
                                            truck_id,
                                            session_id,
                                            ts,
                                        )
                                    except Exception as db_exc:
                                        print(
                                            f"[Snowflake] Insert failed for session {session_id} at {ts}s: {db_exc}"
                                        )
                                    # Show a concise summary so we know the analysis succeeded.
                                    perclos = payload.get("perclos_30s")
                                    yawn_count = payload.get("yawn_count_30s")
                                    print(
                                        f"Success -> session={session_id}, timestamp={ts}, "
                                        f"perclos_30s={perclos}, yawn_count_30s={yawn_count}"
                                    )
                                    print(json.dumps({"driver_id": truck_id, "session_id": session_id}, indent=2))
                                except Exception:
                                    print("Upload succeeded but response was not JSON:")
                                    try:
                                        print(resp.text)
                                    except Exception:
                                        pass

                        if processed == 0:
                            print("\nNo API uploads were completed successfully.")
=======
            # find videos and run analysis 3 times per file (look in api2/videos)
            script_dir = Path(__file__).parent
            footage_dir = script_dir.parent / "videos"
            video_files = find_video_files(footage_dir)

            if not video_files:
                print("No videos found in api2/videos; nothing to upload.")
                return

            base_url = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip('/')
            upload_url = f"{base_url}/api/window"
            timestamps = [30, 60, 90]

            for video_file in video_files:
                driver_id = video_file.stem
                for ts in timestamps:
                    print(f"\nUploading {video_file.name} to {upload_url} with timestamp={ts} (driver_id={driver_id})")
                    try:
                        with open(video_file, 'rb') as fh:
                            files = {'video': (video_file.name, fh, 'application/octet-stream')}
                            data = {'timestamp': str(ts), 'session_id': f'{driver_id}_{ts}', 'driver_id': driver_id}
                            resp = requests.post(upload_url, files=files, data=data, timeout=180)
                        resp.raise_for_status()
                    except Exception as e:
                        print(f"Upload failed for {video_file.name} ts={ts}: {e}")
                        try:
                            print(getattr(resp, 'text', ''))
                        except Exception:
                            pass
                        continue

                    try:
                        payload = resp.json()
                    except Exception:
                        print("Upload succeeded but response was not JSON:")
                        try:
                            print(resp.text)
                        except Exception:
                            pass
                        payload = None

                    if not payload:
                        continue

                    # Extract requested fields and insert into Snowflake
                    fields = [
                        'perclos_30s',
                        'pitchdown_avg_30s',
                        'pitchdown_max_30s',
                        'droop_time_30s',
                        'droop_duty_30s',
                        'yawn_count_30s',
                        'yawn_time_30s',
                        'yawn_duty_30s',
                        'yawn_peak_30s',
                    ]

                    values = []
                    for f in fields:
                        v = payload.get(f)
                        if f == 'yawn_count_30s':
                            values.append(_int_or_none(v))
                        else:
                            values.append(_float_or_none(v))

                    measured_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                    insert_cols = ['driver_id', 'timestamp'] + fields
                    insert_vals = [driver_id, measured_at] + values

                    placeholders = ",".join(["%s"] * len(insert_cols))
                    cols_join = ",".join(insert_cols)
                    insert_sql = f"INSERT INTO {database}.{schema}.DROWSINESS_MEASUREMENTS ({cols_join}) VALUES ({placeholders})"
                    try:
                        cur.execute(insert_sql, insert_vals)
                        print(f"Inserted measurement into DROWSINESS_MEASUREMENTS for {driver_id} ts={ts}, rowcount={cur.rowcount}")
                        cur.execute(meas_q)
                        newc = cur.fetchone()[0]
                        print(f"DROWSINESS_MEASUREMENTS rows after insert: {newc}")
                    except Exception as ie:
                        print(f"Failed to insert measurement: {ie}")

>>>>>>> Stashed changes
        finally:
            cur.close()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
