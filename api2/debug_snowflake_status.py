#!/usr/bin/env python3
"""
Debug script to test Snowflake STATUS_TABLE integration directly.
"""

import os
import sys
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

try:
    import snowflake.connector
except ImportError:
    print("❌ snowflake-connector-python not installed")
    print("Run: pip install snowflake-connector-python")
    sys.exit(1)

def test_snowflake_status_table():
    """Test direct connection and STATUS_TABLE operations"""
    
    # Get connection parameters
    user = os.getenv("SNOWFLAKE_USER")
    password = os.getenv("SNOWFLAKE_PASSWORD")
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    database = os.getenv("SNOWFLAKE_DATABASE", "LCD_ENDPOINTS")
    schema = os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC")
    
    print("🔍 Testing Snowflake STATUS_TABLE Integration")
    print("=" * 60)
    print(f"User: {user}")
    print(f"Account: {account}")
    print(f"Database: {database}")
    print(f"Schema: {schema}")
    print(f"Warehouse: {warehouse}")
    print("=" * 60)
    
    if not all([user, password, account]):
        print("❌ Missing required environment variables:")
        if not user: print("  - SNOWFLAKE_USER")
        if not password: print("  - SNOWFLAKE_PASSWORD") 
        if not account: print("  - SNOWFLAKE_ACCOUNT")
        return False
    
    try:
        # Connect to Snowflake
        print("\n1. Connecting to Snowflake...")
        conn_kwargs = {
            "user": user,
            "password": password,
            "account": account,
            "database": database,
            "schema": schema,
        }
        if warehouse:
            conn_kwargs["warehouse"] = warehouse
            
        conn = snowflake.connector.connect(**conn_kwargs)
        cur = conn.cursor()
        print("✅ Connected successfully")
        
        # Set context
        if warehouse:
            cur.execute(f"USE WAREHOUSE {warehouse}")
            print(f"✅ Using warehouse: {warehouse}")
            
        cur.execute(f"USE DATABASE {database}")
        cur.execute(f"USE SCHEMA {schema}")
        print(f"✅ Using database.schema: {database}.{schema}")
        
        # Check if STATUS_TABLE exists
        print("\n2. Checking if STATUS_TABLE exists...")
        cur.execute("SHOW TABLES LIKE 'STATUS_TABLE'")
        tables = cur.fetchall()
        
        if not tables:
            print("❌ STATUS_TABLE does not exist!")
            print("Creating STATUS_TABLE...")
            create_sql = """
            CREATE TABLE IF NOT EXISTS STATUS_TABLE (
                STATUS VARCHAR(100),
                TIME_CREATED TIMESTAMP_NTZ(9) DEFAULT CURRENT_TIMESTAMP()
            )
            """
            cur.execute(create_sql)
            print("✅ STATUS_TABLE created")
        else:
            print("✅ STATUS_TABLE exists")
            
        # Show table structure
        print("\n3. Checking table structure...")
        cur.execute("DESCRIBE TABLE STATUS_TABLE")
        columns = cur.fetchall()
        print("Table structure:")
        for col in columns:
            print(f"  - {col[0]}: {col[1]} (nullable: {col[2]})")
            
        # Test insert
        print("\n4. Testing manual insert...")
        test_status = "OK"
        insert_sql = "INSERT INTO STATUS_TABLE (STATUS, TIME_CREATED) VALUES (%s, CURRENT_TIMESTAMP())"
        cur.execute(insert_sql, (test_status,))
        rows_affected = cur.rowcount
        conn.commit()
        print(f"✅ Inserted test record: {test_status} (rows affected: {rows_affected})")
        
        # Check current contents
        print("\n5. Checking table contents...")
        cur.execute("SELECT * FROM STATUS_TABLE ORDER BY TIME_CREATED DESC LIMIT 10")
        rows = cur.fetchall()
        
        if rows:
            print(f"✅ Found {len(rows)} records in STATUS_TABLE:")
            for i, row in enumerate(rows, 1):
                print(f"  {i}. Status: {row[0]}, Time: {row[1]}")
        else:
            print("❌ No records found in STATUS_TABLE")
            
        # Test the exact query our app uses
        print("\n6. Testing app integration query...")
        from app import snowflake_db
        
        try:
            app_rows = snowflake_db.execute(
                "INSERT INTO STATUS_TABLE (STATUS, TIME_CREATED) VALUES (%s, CURRENT_TIMESTAMP())",
                ("DROWSY_SOON",)
            )
            print(f"✅ App integration test successful (rows: {app_rows})")
        except Exception as app_error:
            print(f"❌ App integration test failed: {app_error}")
            
        # Final count
        print("\n7. Final verification...")
        cur.execute("SELECT COUNT(*) FROM STATUS_TABLE")
        total_count = cur.fetchone()[0]
        print(f"Total records in STATUS_TABLE: {total_count}")
        
        cur.close()
        conn.close()
        print("\n✅ All tests completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    success = test_snowflake_status_table()
    if not success:
        sys.exit(1)