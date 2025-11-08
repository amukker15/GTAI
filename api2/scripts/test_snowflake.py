"""Simple script to validate a live Snowflake connection and query the two tables.

Run this locally after setting the environment variables. It prints current user
and counts from `DRIVERS` and `DROWSINESS_MEASUREMENTS` under the configured
database/schema. This script intentionally does not contain any credentials.

Example (PowerShell):
  $env:SNOWFLAKE_USER = "FAWAZSABIR"
  $env:SNOWFLAKE_PASSWORD = "H4ackathon25!!!"
  $env:SNOWFLAKE_ACCOUNT = "NV61963"
  $env:SNOWFLAKE_WAREHOUSE = "COMPUTE_WH"
  $env:SNOWFLAKE_DATABASE = "LCD_ENDPOINTS"
  $env:SNOWFLAKE_SCHEMA = "PUBLIC"
  python scripts/test_snowflake.py
"""

from __future__ import annotations

import os
import sys
from typing import Any

try:
    import dotenv
    dotenv.load_dotenv()
except Exception:
    # python-dotenv is optional; environment variables can be set directly.
    pass

import snowflake.connector
from datetime import datetime, date


def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        print(f"ERROR: environment variable {name} is required", file=sys.stderr)
        sys.exit(2)
    return v


def main() -> None:
    user = require_env("SNOWFLAKE_USER")
    password = require_env("SNOWFLAKE_PASSWORD")
    # Account locator may be incomplete in some setups; allow specifying
    # a full host via SNOWFLAKE_HOST (e.g. nv61963.us-east-1.snowflakecomputing.com)
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    host = os.getenv("SNOWFLAKE_HOST")
    if not account and not host:
        print("ERROR: either SNOWFLAKE_ACCOUNT or SNOWFLAKE_HOST must be set", file=sys.stderr)
        sys.exit(2)
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE", "LCD_ENDPOINTS")
    schema = os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC")

    conn_kwargs: dict[str, Any] = dict(
        user=user,
        password=password,
        database=database,
        schema=schema,
    )
    # Prefer host override when provided (useful when account locator needs
    # region/org qualifiers). The connector accepts a 'host' argument. Some
    # connector versions still require an 'account' param — derive it from the
    # host when missing.
    if host:
        conn_kwargs["host"] = host
        # Snowflake connector often still requires an 'account' param even when
        # a host is supplied. Prefer an explicit SNOWFLAKE_ACCOUNT if provided,
        # otherwise derive it from the host's left-most label.
        if account:
            conn_kwargs["account"] = account
        else:
            derived = host.split(".")[0]
            conn_kwargs["account"] = derived
    else:
        conn_kwargs["account"] = account
    if warehouse:
        conn_kwargs["warehouse"] = warehouse

    print("Connecting to Snowflake with:")
    print(f"  user={user}")
    print(f"  account={account}")
    print(f"  database={database}, schema={schema}")
    if warehouse:
        print(f"  warehouse={warehouse}")

    try:
        conn = snowflake.connector.connect(**conn_kwargs)
    except Exception as exc:
        # Print full exception for easier diagnosis (includes Snowflake error codes)
        import traceback

        print("Failed to connect to Snowflake:", file=sys.stderr)
        traceback.print_exc()
        # Mask password when printing connection parameters
        safe = dict(conn_kwargs)
        if "password" in safe:
            safe["password"] = "***REDACTED***"
        print("Connection parameters used:", safe, file=sys.stderr)
        sys.exit(3)

    try:
        cur = conn.cursor()
        try:
            # Ensure an active warehouse is selected for the session if one was
            # provided. Some accounts require an explicit USE WAREHOUSE call.
            if warehouse:
                try:
                    cur.execute(f"USE WAREHOUSE {warehouse}")
                    print(f"Using warehouse: {warehouse}")
                except Exception as we:
                    print(f"Could not set warehouse {warehouse}: {we}")
                    # Try to discover a usable warehouse by listing available
                    # warehouses and attempting to use each one until success.
                    try:
                        cur.execute("SHOW WAREHOUSES")
                        wh_rows = cur.fetchall()
                        wh_desc = [d[0].upper() for d in cur.description]
                        name_idx = None
                        for i, n in enumerate(wh_desc):
                            if n in ("NAME", "WAREHOUSE_NAME"):
                                name_idx = i
                                break
                        if name_idx is None:
                            # Fallback: assume first column is the name
                            name_idx = 0
                        # Build and print candidate list for visibility
                        candidates = [r[name_idx] for r in wh_rows]
                        print("Available warehouses:")
                        for c in candidates:
                            print(f"  - {c}")
                        tried = 0
                        for candidate in candidates:
                            try:
                                cur.execute(f"USE WAREHOUSE {candidate}")
                                print(f"Using discovered warehouse: {candidate}")
                                warehouse = candidate
                                break
                            except Exception:
                                tried += 1
                                continue
                        if tried and warehouse is None:
                            print("Could not find a usable warehouse from SHOW WAREHOUSES; continuing without an active warehouse.")
                    except Exception as se:
                        print(f"Could not list warehouses: {se}")

            cur.execute("SELECT CURRENT_USER(), CURRENT_ACCOUNT()")
            row = cur.fetchone()
            print("Connected as:", row)

            # Count rows in the two tables (fully qualified names to be explicit)
            drivers_q = f"SELECT COUNT(*) FROM {database}.{schema}.DRIVERS"
            meas_q = f"SELECT COUNT(*) FROM {database}.{schema}.DROWSINESS_MEASUREMENTS"

            for name, q in [("DRIVERS", drivers_q), ("DROWSINESS_MEASUREMENTS", meas_q)]:
                try:
                    cur.execute(q)
                    c = cur.fetchone()[0]
                    print(f"{name} rows: {c}")
                except Exception as e:
                    print(f"Could not query {name}: {e}")

            # Print DRIVERS column names and types
            try:
                col_q = (
                    "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT "
                    "FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_CATALOG = %s AND TABLE_SCHEMA = %s AND TABLE_NAME = 'DRIVERS' "
                    "ORDER BY ORDINAL_POSITION"
                )
                cur.execute(col_q, (database, schema))
                cols = cur.fetchall()
                if not cols:
                    print("No columns found for DRIVERS (check database/schema/table name)")
                else:
                    print("DRIVERS columns:")
                    for cn, dt, nullable, coldef in cols:
                        print(f"  {cn} : {dt} (nullable={nullable}, default={coldef})")

                    # Build an INSERT using discovered columns and simple default values
                    insert_cols = []
                    insert_vals = []
                    for cn, dt, nullable, coldef in cols:
                        # Skip columns that have a default expression (likely identity/auto)
                        if coldef and str(coldef).strip() != "":
                            continue
                        # Choose a value based on data type
                        t = str(dt).upper()
                        if "CHAR" in t or "TEXT" in t or "VARCHAR" in t or "STRING" in t:
                            # use a short test string; prefer driver_id if present
                            if cn.lower() in ("driver_id", "id", "driverid"):
                                val = "test_driver"
                            else:
                                val = f"test_{cn.lower()}"
                        elif "TIMESTAMP" in t or "DATETIME" in t or "TIME" in t:
                            val = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                        elif "DATE" in t:
                            val = date.today().isoformat()
                        elif "INT" in t or "NUMBER" in t or "DECIMAL" in t or "NUMERIC" in t or "FLOAT" in t:
                            val = 0
                        elif "BOOL" in t:
                            val = False
                        else:
                            # Fallback to NULL for complex types like VARIANT/OBJECT
                            val = None

                        insert_cols.append(cn)
                        insert_vals.append(val)

                    if insert_cols:
                        placeholders = ",".join(["%s"] * len(insert_cols))
                        cols_join = ",".join(insert_cols)
                        insert_sql = f"INSERT INTO {database}.{schema}.DRIVERS ({cols_join}) VALUES ({placeholders})"
                        try:
                            cur.execute(insert_sql, insert_vals)
                            print(f"Inserted into DRIVERS, rowcount={cur.rowcount}")
                            # show new count
                            cur.execute(drivers_q)
                            newc = cur.fetchone()[0]
                            print(f"DRIVERS rows after insert: {newc}")
                        except Exception as ie:
                            print(f"Failed to insert into DRIVERS: {ie}")
                    else:
                        print("No writable columns detected for DRIVERS (all have defaults). Skipping insert.")
            except Exception as e:
                print(f"Could not introspect DRIVERS columns: {e}")
        finally:
            cur.close()
    finally:
        conn.close()


if __name__ == "__main__":
    main()

    # --- api_tester-style upload: POST a local footage file to /api/window ---
    try:
        import requests
    except Exception:
        print("\nrequests library not installed; skipping API tester upload. Install with: pip install requests")
    else:
        from pathlib import Path
        import json

        # locate footage directory relative to this script
        script_dir = Path(__file__).parent
        footage_dir = script_dir.parent / "footage"
        video_file = None
        if footage_dir.exists():
            for ext in ("*.mp4", "*.mov", "*.avi", "*.mkv", "*.mpg", "*.webm"):
                matches = list(footage_dir.glob(ext))
                if matches:
                    video_file = matches[0]
                    break

        if not video_file:
            print("\nNo video file found in footage/; skipping API tester upload.")
        else:
            base_url = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip('/')
            upload_url = f"{base_url}/api/window"
            print(f"\nUploading {video_file.name} to {upload_url} with timestamp=35")
            try:
                with open(video_file, 'rb') as fh:
                    files = {'video': (video_file.name, fh, 'application/octet-stream')}
                    data = {'timestamp': '35', 'session_id': 'api_tester_local', 'driver_id': 'test_driver'}
                    resp = requests.post(upload_url, files=files, data=data, timeout=120)
                try:
                    resp.raise_for_status()
                except Exception as re:
                    print(f"Upload failed: {re} (status {resp.status_code})")
                    try:
                        print(resp.text)
                    except Exception:
                        pass
                else:
                    try:
                        payload = resp.json()
                        print("API /api/window response JSON:")
                        print(json.dumps(payload, indent=2))
                    except Exception:
                        print("Upload succeeded but response was not JSON:")
                        print(resp.text)
            except Exception as e:
                print(f"Error uploading file to API tester: {e}")
