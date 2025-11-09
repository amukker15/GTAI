#!/usr/bin/env python3
"""
Try modern Snowflake account identifier formats
"""

import os
import snowflake.connector
from dotenv import load_dotenv

load_dotenv()

def try_modern_account_formats():
    """Try modern account identifier formats"""
    
    user = os.getenv("SNOWFLAKE_USER")
    password = os.getenv("SNOWFLAKE_PASSWORD")
    base_account = os.getenv("SNOWFLAKE_ACCOUNT")  # NV61963
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    
    print(f"Trying modern account formats for base: {base_account}")
    print("=" * 60)
    
    # Modern formats typically used by newer Snowflake accounts
    modern_formats = [
        # Organization-Account format (most common for new accounts)
        f"ORGNAME-{base_account}",
        f"orgname-{base_account}",
        f"ACCOUNT-{base_account}",
        f"account-{base_account}",
        
        # Legacy with different regions
        f"{base_account}",
        f"{base_account.lower()}",
        f"{base_account}.us-central1.gcp",
        f"{base_account}.us-east-1.aws", 
        f"{base_account}.us-west-2.aws",
        f"{base_account}.eu-west-1.aws",
        
        # Without dots
        f"{base_account}-us-east-1",
        f"{base_account}-us-west-2",
        
        # Common organizational patterns
        f"LUCID-{base_account}",
        f"lucid-{base_account}",
        f"GTAI-{base_account}",
        f"gtai-{base_account}",
    ]
    
    for i, account_format in enumerate(modern_formats, 1):
        print(f"\n{i:2d}. Testing: {account_format}")
        
        try:
            # Try connection with minimal timeout to fail fast
            conn = snowflake.connector.connect(
                user=user,
                password=password,
                account=account_format,
                warehouse=warehouse,
                login_timeout=10,
                network_timeout=15,
            )
            
            print(f"✅ CONNECTION SUCCESS with: {account_format}")
            
            # Test basic queries
            cur = conn.cursor()
            cur.execute("SELECT CURRENT_ACCOUNT(), CURRENT_REGION(), CURRENT_ORGANIZATION_NAME()")
            result = cur.fetchone()
            print(f"   Account: {result[0]}")
            print(f"   Region: {result[1]}")
            print(f"   Organization: {result[2]}")
            
            # Test database access
            try:
                cur.execute("USE DATABASE LCD_ENDPOINTS")
                cur.execute("USE SCHEMA PUBLIC")
                
                # Check STATUS_TABLE
                cur.execute("SELECT COUNT(*) FROM STATUS_TABLE")
                status_count = cur.fetchone()[0]
                print(f"   STATUS_TABLE records: {status_count}")
                
                # Check DROWSINESS_MEASUREMENTS
                cur.execute("SELECT COUNT(*) FROM DROWSINESS_MEASUREMENTS") 
                drowsiness_count = cur.fetchone()[0]
                print(f"   DROWSINESS_MEASUREMENTS records: {drowsiness_count}")
                
                if status_count > 0:
                    cur.execute("SELECT * FROM STATUS_TABLE ORDER BY TIME_CREATED DESC LIMIT 3")
                    recent_statuses = cur.fetchall()
                    print(f"   Recent statuses: {[row[0] for row in recent_statuses]}")
                    
            except Exception as db_error:
                print(f"   ⚠️  Database access issue: {db_error}")
            
            cur.close()
            conn.close()
            
            return account_format
            
        except Exception as e:
            error_msg = str(e)
            if "404 Not Found" in error_msg:
                print(f"   ❌ Account not found")
            elif "authentication failed" in error_msg.lower():
                print(f"   ❌ Authentication failed (account exists but wrong credentials)")
            elif "timeout" in error_msg.lower():
                print(f"   ❌ Connection timeout")
            else:
                print(f"   ❌ Error: {error_msg[:50]}...")
    
    print(f"\n💡 None of the common formats worked. Please check:")
    print(f"   1. Your Snowflake web login URL")
    print(f"   2. Your username and password")
    print(f"   3. Run this in Snowflake web interface:")
    print(f"      SELECT CURRENT_ACCOUNT(), CURRENT_REGION(), CURRENT_ORGANIZATION_NAME();")
    
    return None

if __name__ == "__main__":
    working_format = try_modern_account_formats()
    
    if working_format:
        print(f"\n🎉 SUCCESS! Use this account identifier:")
        print(f"   SNOWFLAKE_ACCOUNT={working_format}")
        print(f"\nUpdate your .env file with this value.")
    else:
        print(f"\nNext steps:")
        print(f"1. Log into your Snowflake web interface")
        print(f"2. Copy the exact browser URL and send it to me")
        print(f"3. Run the SQL query above and send me the results")