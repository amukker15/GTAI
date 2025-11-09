#!/usr/bin/env python3
"""Test Snowflake connection using host parameter"""

import os
import snowflake.connector
from dotenv import load_dotenv

load_dotenv()

def test_host_connection():
    """Test connection using the host parameter"""
    
    user = os.getenv("SNOWFLAKE_USER")
    password = os.getenv("SNOWFLAKE_PASSWORD") 
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    host = os.getenv("SNOWFLAKE_HOST")
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE")
    schema = os.getenv("SNOWFLAKE_SCHEMA")
    
    print(f"Testing connection with host: {host}")
    print(f"Account: {account}")
    print("=" * 60)
    
    try:
        # Connect using host parameter
        conn = snowflake.connector.connect(
            user=user,
            password=password,
            account=account,
            host=host,
            warehouse=warehouse,
            database=database,
            schema=schema,
            login_timeout=30,
        )
        
        print("✅ Successfully connected to Snowflake!")
        
        cur = conn.cursor()
        
        # Test basic info
        cur.execute("SELECT CURRENT_ACCOUNT(), CURRENT_REGION(), CURRENT_DATABASE(), CURRENT_SCHEMA()")
        result = cur.fetchone()
        print(f"Account: {result[0]}")
        print(f"Region: {result[1]}")
        print(f"Database: {result[2]}")
        print(f"Schema: {result[3]}")
        
        # Test STATUS_TABLE
        print(f"\nTesting STATUS_TABLE...")
        cur.execute("SELECT COUNT(*) FROM STATUS_TABLE")
        count = cur.fetchone()[0]
        print(f"STATUS_TABLE contains {count} records")
        
        if count > 0:
            cur.execute("SELECT * FROM STATUS_TABLE ORDER BY TIME_CREATED DESC LIMIT 5")
            rows = cur.fetchall()
            print("Recent entries:")
            for row in rows:
                print(f"  Status: {row[0]}, Time: {row[1]}")
        
        # Test insert
        print(f"\nTesting insert...")
        cur.execute("INSERT INTO STATUS_TABLE (STATUS, TIME_CREATED) VALUES (%s, CURRENT_TIMESTAMP())", ("TEST_OK",))
        rows_affected = cur.rowcount
        conn.commit()
        print(f"Inserted test record, rows affected: {rows_affected}")
        
        # Verify insert
        cur.execute("SELECT COUNT(*) FROM STATUS_TABLE WHERE STATUS = %s", ("TEST_OK",))
        test_count = cur.fetchone()[0]
        print(f"Test records found: {test_count}")
        
        cur.close()
        conn.close()
        
        print("\n🎉 All tests passed! Snowflake connection is working.")
        return True
        
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False

if __name__ == "__main__":
    success = test_host_connection()
    if success:
        print("\n✅ Your Snowflake integration should now work!")
        print("Restart your backend server and try the frontend again.")
    else:
        print("\n❌ Connection still failing. Please verify your credentials.")