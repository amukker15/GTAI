#!/usr/bin/env python3
"""
Script to find the correct Snowflake account identifier format.
"""

import os
import snowflake.connector
from dotenv import load_dotenv

load_dotenv()

def test_account_formats():
    """Try different account formats to find the working one"""
    
    user = os.getenv("SNOWFLAKE_USER")
    password = os.getenv("SNOWFLAKE_PASSWORD")
    account = os.getenv("SNOWFLAKE_ACCOUNT")
    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
    
    print(f"Testing Snowflake account formats for: {account}")
    print("=" * 60)
    
    # Different account formats to try
    formats_to_try = [
        account,  # Original: NV61963
        f"{account}.us-east-1",  # With US East region
        f"{account}.us-west-2",  # With US West region
        f"{account}.eu-west-1",  # With EU region
        f"{account}.ap-southeast-1",  # With Asia Pacific region
        f"{account}.snowflakecomputing.com",  # Legacy format
        f"{account}.us-east-1.snowflakecomputing.com",  # Full US East
        f"{account}.us-west-2.snowflakecomputing.com",  # Full US West
    ]
    
    for i, account_format in enumerate(formats_to_try, 1):
        print(f"\n{i}. Testing: {account_format}")
        
        try:
            conn = snowflake.connector.connect(
                user=user,
                password=password,
                account=account_format,
                warehouse=warehouse,
                login_timeout=15,
                network_timeout=30,
            )
            
            # Test the connection
            cur = conn.cursor()
            cur.execute("SELECT CURRENT_ACCOUNT(), CURRENT_REGION()")
            result = cur.fetchone()
            
            print(f"✅ SUCCESS! Account: {result[0]}, Region: {result[1]}")
            print(f"✅ Working format: {account_format}")
            
            # Test database access
            try:
                cur.execute("USE DATABASE LCD_ENDPOINTS")
                cur.execute("USE SCHEMA PUBLIC")
                cur.execute("SELECT COUNT(*) FROM STATUS_TABLE")
                count = cur.fetchone()[0]
                print(f"✅ STATUS_TABLE accessible, contains {count} records")
            except Exception as db_error:
                print(f"⚠️  Database/table access issue: {db_error}")
            
            cur.close()
            conn.close()
            
            return account_format
            
        except Exception as e:
            print(f"❌ Failed: {str(e)[:100]}...")
            continue
    
    print("\n❌ No working account format found!")
    return None

if __name__ == "__main__":
    working_format = test_account_formats()
    
    if working_format:
        print(f"\n🎉 Use this account format: {working_format}")
        print(f"\nUpdate your .env file:")
        print(f"SNOWFLAKE_ACCOUNT={working_format}")
    else:
        print("\n💡 Try these steps:")
        print("1. Check your Snowflake account URL in a browser")
        print("2. Look for the account identifier in the URL")
        print("3. Verify your username and password are correct")
        print("4. Check if your account requires a specific region")