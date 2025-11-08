const base = (import.meta.env.VITE_SNOWFLAKE_API_BASE || "").trim();
const key = (import.meta.env.VITE_SNOWFLAKE_API_KEY || "").trim();

/**
 * Base URL for the Snowflake-backed REST API. Accepts either absolute URLs
 * (https://api.example.com/data) or relative paths (/api/data). Trailing
 * slashes are trimmed so paths can be joined safely.
 */
export const SNOWFLAKE_API_BASE = base.replace(/\/+$/, "");

/** API key or bearer token injected into every request. */
export const SNOWFLAKE_API_KEY = key;
