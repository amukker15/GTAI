#!/usr/bin/env python3
"""
Test script to verify the automatic data clearing functionality.
"""

import requests
import time
import os
import snowflake.connector
from dotenv import load_dotenv

load_dotenv()

def get_snowflake_count():
    """Get current count of records in STATUS_TABLE"""
    try:
        conn = snowflake.connector.connect(
            user=os.getenv('SNOWFLAKE_USER'),
            password=os.getenv('SNOWFLAKE_PASSWORD'),
            account=os.getenv('SNOWFLAKE_ACCOUNT'),
            host=os.getenv('SNOWFLAKE_HOST'),
            warehouse=os.getenv('SNOWFLAKE_WAREHOUSE'),
            database=os.getenv('SNOWFLAKE_DATABASE'),
            schema=os.getenv('SNOWFLAKE_SCHEMA')
        )
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM STATUS_TABLE')
        count = cur.fetchone()[0]
        conn.close()
        return count
    except Exception as e:
        print(f"Error checking Snowflake: {e}")
        return -1

def test_auto_clear():
    """Test the automatic clearing functionality"""
    
    print("🧪 Testing Auto-Clear Functionality")
    print("=" * 50)
    
    # Step 1: Add some test data
    print("1. Adding test data...")
    test_statuses = ["OK", "DROWSY_SOON", "ASLEEP", "OK", "DROWSY_SOON"]
    
    for status in test_statuses:
        response = requests.post("http://localhost:8000/api/status", 
                               data={"status": status, "driver_id": "test_driver"})
        if response.ok:
            print(f"   ✅ Added {status}")
        else:
            print(f"   ❌ Failed to add {status}")
    
    # Check count after adding
    count_after_adding = get_snowflake_count()
    print(f"\n📊 Records after adding: {count_after_adding}")
    
    # Step 2: Test manual reset (simulate what happens when demo starts)
    print("\n2. Testing manual reset (simulates new demo start)...")
    response = requests.post("http://localhost:8000/api/session/reset", data={})
    
    if response.ok:
        result = response.json()
        print(f"   ✅ Reset successful:")
        print(f"      - Status records cleared: {result.get('status_rows_cleared', 0)}")
        print(f"      - Drowsiness records cleared: {result.get('drowsiness_rows_cleared', 0)}")
    else:
        print(f"   ❌ Reset failed: {response.status_code}")
    
    # Check count after reset
    count_after_reset = get_snowflake_count()
    print(f"\n📊 Records after reset: {count_after_reset}")
    
    # Step 3: Add new data to simulate new demo
    print("\n3. Adding new demo data...")
    new_statuses = ["OK", "OK", "DROWSY_SOON"]
    
    for status in new_statuses:
        response = requests.post("http://localhost:8000/api/status", 
                               data={"status": status, "driver_id": "new_demo_driver"})
        if response.ok:
            print(f"   ✅ Added {status}")
    
    count_after_new = get_snowflake_count()
    print(f"\n📊 Records after new demo data: {count_after_new}")
    
    # Verify the behavior
    print("\n🔍 Verification:")
    if count_after_reset == 0:
        print("   ✅ Auto-clear working: Table was completely cleared")
    else:
        print(f"   ❌ Auto-clear failed: {count_after_reset} records remain")
    
    if count_after_new == len(new_statuses):
        print("   ✅ New data correctly added after clear")
    else:
        print(f"   ❌ Expected {len(new_statuses)} records, got {count_after_new}")
    
    print("\n🎯 Summary:")
    print(f"   Initial data: {count_after_adding} records")
    print(f"   After clear:  {count_after_reset} records")  
    print(f"   After new:    {count_after_new} records")
    
    if count_after_reset == 0 and count_after_new == len(new_statuses):
        print("\n🎉 AUTO-CLEAR FUNCTIONALITY WORKING PERFECTLY!")
        print("   Each new demo will start with a clean STATUS_TABLE")
    else:
        print("\n❌ Auto-clear needs adjustment")

if __name__ == "__main__":
    test_auto_clear()