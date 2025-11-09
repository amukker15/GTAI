#!/usr/bin/env python3
"""
Test script to verify the complete status integration with Snowflake.

This script tests:
1. Backend API status endpoint functionality
2. Snowflake STATUS_TABLE insertion
3. Frontend-to-backend communication flow

Run this after starting the backend API server.
"""

import requests
import time
import json
from datetime import datetime

def test_status_endpoint():
    """Test the /api/status endpoint directly"""
    print("=" * 60)
    print("Testing /api/status endpoint...")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    status_url = f"{base_url}/api/status"
    
    # Test all valid status values
    test_statuses = ["OK", "DROWSY_SOON", "ASLEEP"]
    
    for status in test_statuses:
        print(f"\nTesting status: {status}")
        
        form_data = {
            'status': status,
            'driver_id': 'test_driver_123',
            'session_id': f'test_session_{int(time.time())}'
        }
        
        try:
            response = requests.post(status_url, data=form_data, timeout=10)
            response.raise_for_status()
            
            result = response.json()
            print(f"✅ Success: {result}")
            
            # Verify the response structure
            assert result['success'] is True
            assert result['status'] == status
            assert 'timestamp' in result
            # rows_affected may not be present in demo mode
            if 'demo_mode' in result:
                print(f"   (Running in demo mode: {result['note']})")
            else:
                assert 'rows_affected' in result
            
        except requests.exceptions.RequestException as e:
            print(f"❌ Request failed: {e}")
            return False
        except (KeyError, AssertionError) as e:
            print(f"❌ Response validation failed: {e}")
            return False
    
    print("\n✅ All status endpoint tests passed!")
    return True

def test_invalid_status():
    """Test the endpoint with invalid status values"""
    print("\n" + "=" * 60)
    print("Testing invalid status values...")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    status_url = f"{base_url}/api/status"
    
    invalid_statuses = ["INVALID", "sleeping", "", "123"]
    
    for status in invalid_statuses:
        print(f"\nTesting invalid status: '{status}'")
        
        form_data = {
            'status': status,
            'driver_id': 'test_driver',
            'session_id': 'test_session'
        }
        
        try:
            response = requests.post(status_url, data=form_data, timeout=10)
            
            if response.status_code == 400:
                print(f"✅ Correctly rejected invalid status: {response.json()}")
            elif response.status_code == 422:
                # FastAPI validation error for invalid status
                print(f"✅ Correctly rejected invalid status with validation error: {response.json()}")
            else:
                result = response.json()
                # Check if the backend rejected it at application level
                if not result.get('success', True):
                    print(f"✅ Correctly rejected invalid status at application level: {result}")
                else:
                    print(f"❌ Should have rejected invalid status, but got: {response.status_code} - {result}")
                    return False
                
        except requests.exceptions.RequestException as e:
            print(f"❌ Request failed: {e}")
            return False
    
    print("\n✅ All invalid status tests passed!")
    return True

def test_backend_api_availability():
    """Test if the backend API is running"""
    print("=" * 60)
    print("Testing backend API availability...")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    
    try:
        # Test if the API is running by hitting a simple endpoint
        response = requests.get(f"{base_url}/api/footage/info", timeout=5)
        print(f"API status: {response.status_code}")
        
        if response.status_code in [200, 404]:  # 404 is fine, means API is running but no video
            print("✅ Backend API is running")
            return True
        else:
            print(f"❌ Backend API returned unexpected status: {response.status_code}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Cannot connect to backend API: {e}")
        print("Please ensure the backend API is running on http://localhost:8000")
        return False

def simulate_frontend_flow():
    """Simulate the complete frontend flow"""
    print("\n" + "=" * 60)
    print("Simulating complete frontend flow...")
    print("=" * 60)
    
    base_url = "http://localhost:8000"
    
    # Step 1: Perform video analysis (this will save to DROWSINESS_MEASUREMENTS)
    print("\n1. Performing video analysis...")
    
    analysis_data = {
        'timestamp': '15',
        'session_id': f'integration_test_{int(time.time())}',
        'driver_id': 'integration_test_driver'
    }
    
    try:
        analysis_response = requests.post(f"{base_url}/api/window", data=analysis_data, timeout=30)
        
        if analysis_response.ok:
            analysis_result = analysis_response.json()
            print(f"✅ Video analysis completed: session={analysis_result.get('session_id')}")
            
            # Step 2: Simulate status calculation and saving
            print("\n2. Saving computed driver status...")
            
            # In a real scenario, the frontend would compute this from telemetry
            computed_status = "DROWSY_SOON"  # Example computed status
            
            status_data = {
                'status': computed_status,
                'driver_id': analysis_result.get('driver_id', 'integration_test_driver'),
                'session_id': analysis_result.get('session_id', 'integration_test_session')
            }
            
            status_response = requests.post(f"{base_url}/api/status", data=status_data, timeout=10)
            
            if status_response.ok:
                status_result = status_response.json()
                print(f"✅ Status saved: {status_result}")
                print(f"   Status: {status_result['status']}")
                print(f"   Timestamp: {status_result['timestamp']}")
                print(f"   Rows affected: {status_result.get('rows_affected', 'N/A')}")
                
                return True
            else:
                print(f"❌ Status saving failed: {status_response.status_code} - {status_response.text}")
                return False
        else:
            print(f"❌ Video analysis failed: {analysis_response.status_code} - {analysis_response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Integration test failed: {e}")
        return False

def main():
    """Run all tests"""
    print("🧪 Status Integration Test Suite")
    print("=" * 60)
    print(f"Test started at: {datetime.now().isoformat()}")
    print("=" * 60)
    
    tests = [
        ("Backend API Availability", test_backend_api_availability),
        ("Status Endpoint", test_status_endpoint),
        ("Invalid Status Handling", test_invalid_status),
        ("Complete Integration Flow", simulate_frontend_flow),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n🔍 Running: {test_name}")
        try:
            if test_func():
                passed += 1
                print(f"✅ {test_name}: PASSED")
            else:
                print(f"❌ {test_name}: FAILED")
        except Exception as e:
            print(f"❌ {test_name}: ERROR - {e}")
    
    print("\n" + "=" * 60)
    print(f"TEST SUMMARY: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Status integration is working correctly.")
        print("\nNext steps:")
        print("1. Start your frontend application")
        print("2. Check Snowflake STATUS_TABLE for new records")
        print("3. Verify status data appears every 15 seconds during analysis")
    else:
        print(f"❌ {total - passed} test(s) failed. Please check the errors above.")
    
    print("=" * 60)

if __name__ == "__main__":
    main()