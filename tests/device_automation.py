#!/usr/bin/env python3
"""
Village API Device Automation Script

This script automates API calls to the Village Firebase emulator for testing device functionality.
It creates users, authenticates them, and performs various device operations:
- Create a user
- Update a device (create if not exists)
- Get the device
- Update the device again
- Get the updated device
- Test negative cases (get device that doesn't exist)
"""

import json
import logging

from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def run_device_tests():
    """Run tests for the Village API device functionality"""
    api = VillageAPI()

    # Create a test user
    user = {
        "email": "device_test@example.com",
        "password": "password123",
        "name": "Device Test User",
    }

    # Create and authenticate user
    api.create_user(user["email"], user["password"], user["name"])

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Step 1: Update device (creates if not exists)
    initial_device_data = {
        "device_id": "test-device-id-123",
    }
    updated_device = api.update_device(user["email"], initial_device_data)
    logger.info(f"Updated device: {json.dumps(updated_device, indent=2)}")

    # Verify device data
    assert (
        updated_device["device_id"] == initial_device_data["device_id"]
    ), "Device ID mismatch"
    assert "updated_at" in updated_device, "updated_at field missing"
    logger.info("Device update verification successful")

    # Step 2: Get the device to verify
    retrieved_device = api.get_device(user["email"])
    logger.info(f"Retrieved device: {json.dumps(retrieved_device, indent=2)}")

    # Verify device data matches what was created
    assert (
        retrieved_device["device_id"] == initial_device_data["device_id"]
    ), "Device ID mismatch"
    assert "updated_at" in retrieved_device, "updated_at field missing"
    logger.info("Device retrieval verification successful")

    # Step 3: Update the device again with a new device ID
    new_device_data = {
        "device_id": "test-device-id-456",
    }
    updated_device_again = api.update_device(user["email"], new_device_data)
    logger.info(f"Updated device again: {json.dumps(updated_device_again, indent=2)}")

    # Verify updated device data
    assert (
        updated_device_again["device_id"] == new_device_data["device_id"]
    ), "Updated device ID mismatch"
    assert "updated_at" in updated_device_again, "updated_at field missing"
    logger.info("Second device update verification successful")

    # Step 4: Get the device again to verify updates
    retrieved_updated_device = api.get_device(user["email"])
    logger.info(
        f"Retrieved updated device: {json.dumps(retrieved_updated_device, indent=2)}"
    )

    # Verify updated device data
    assert (
        retrieved_updated_device["device_id"] == new_device_data["device_id"]
    ), "Updated device ID mismatch"
    assert "updated_at" in retrieved_updated_device, "updated_at field missing"
    logger.info("Updated device retrieval verification successful")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Create a new user but don't update their device
    new_user = {
        "email": "device_test_new@example.com",
        "password": "password123",
        "name": "New Device Test User",
    }

    api.create_user(new_user["email"], new_user["password"], new_user["name"])

    # Try to get a device that doesn't exist
    try:
        # This should fail with a 404
        headers = {"Authorization": f"Bearer {api.tokens[new_user['email']]}"}
        result = api.make_request_expecting_error(
            "get",
            f"{API_BASE_URL}/device",
            headers,
            expected_status_code=404,
            expected_error_message="Device not found",
        )
        logger.info(f"Expected error received: {json.dumps(result, indent=2)}")
        logger.info("✓ Negative test passed: Device not found")
    except Exception as e:
        logger.error(f"Negative test failed: {str(e)}")
        raise

    # Try to update device with invalid data (empty device_id)
    try:
        invalid_device_data = {
            "device_id": "",
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[user['email']]}",
        }
        result = api.make_request_expecting_error(
            "put",
            f"{API_BASE_URL}/device",
            headers,
            json_data=invalid_device_data,
            expected_status_code=400,
            expected_error_message="Invalid request body",
        )
        logger.info(f"Expected error received: {json.dumps(result, indent=2)}")
        logger.info("✓ Negative test passed: Invalid device data")
    except Exception as e:
        logger.error(f"Negative test failed: {str(e)}")
        raise

    logger.info("========== ALL DEVICE TESTS COMPLETED SUCCESSFULLY ==========")


if __name__ == "__main__":
    try:
        run_device_tests()
        logger.info("Device automation completed successfully")
    except Exception as e:
        logger.error(f"Device automation failed: {str(e)}")
        raise
