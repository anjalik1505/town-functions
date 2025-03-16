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
from typing import Any, Dict, Optional

import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Constants
FIREBASE_AUTH_URL = "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key"
API_BASE_URL = "http://localhost:5001/village-staging-9178d/us-central1/api"
FIREBASE_CREATE_USER_URL = "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key"


class VillageAPI:
    """Class to interact with the Village API"""

    def __init__(self):
        self.tokens = {}  # Store tokens for each user
        self.user_ids = {}  # Store user IDs for each user

    def create_user(
        self, email: str, password: str, display_name: str
    ) -> Dict[str, Any]:
        """Create a new user in Firebase Auth"""
        logger.info(f"Creating user with email: {email}")

        # Step 1: Create the user
        payload = {
            "email": email,
            "password": password,
            "displayName": display_name,
            "returnSecureToken": True,
        }

        response = requests.post(FIREBASE_CREATE_USER_URL, json=payload)
        if response.status_code != 200:
            logger.error(f"Failed to create user: {response.text}")
            response.raise_for_status()

        data = response.json()
        logger.debug(f"User creation response: {json.dumps(data, indent=2)}")

        # Store user ID if available
        if "localId" in data:
            user_id = data["localId"]
            self.user_ids[email] = user_id

        # Now authenticate to get a token for subsequent API calls
        self.authenticate_user(email, password)

        logger.info(f"User created with ID: {self.user_ids.get(email, 'unknown')}")
        return data

    def authenticate_user(self, email: str, password: str) -> Dict[str, Any]:
        """Authenticate a user and get a JWT token"""
        logger.info(f"Authenticating user: {email}")

        payload = {"email": email, "password": password, "returnSecureToken": True}

        response = requests.post(FIREBASE_AUTH_URL, json=payload)
        if response.status_code != 200:
            logger.error(f"Authentication failed: {response.text}")
            response.raise_for_status()

        data = response.json()
        self.tokens[email] = data["idToken"]
        self.user_ids[email] = data["localId"]

        logger.info(f"User authenticated with ID: {self.user_ids[email]}")
        return data

    def update_device(self, email: str, device_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a device for a user"""
        logger.info(f"Updating device for user: {email}")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}",
        }

        response = requests.put(
            f"{API_BASE_URL}/device", headers=headers, json=device_data
        )
        if response.status_code != 200:
            logger.error(f"Failed to update device: {response.text}")
            response.raise_for_status()

        logger.info(f"Device updated for user: {email}")
        return response.json()

    def get_device(self, email: str) -> Dict[str, Any]:
        """Get the user's device"""
        logger.info(f"Getting device for user: {email}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        response = requests.get(f"{API_BASE_URL}/device", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get device: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully retrieved device for user: {email}")
        return response.json()

    def make_request_expecting_error(
        self,
        method: str,
        url: str,
        headers: Dict[str, str],
        json_data: Optional[Dict[str, Any]] = None,
        expected_status_code: int = None,
        expected_error_message: str = None,
    ) -> Dict[str, Any]:
        """Make a request expecting a specific error response"""
        logger.info(
            f"Making {method} request to {url} expecting error status {expected_status_code}"
        )

        try:
            if method.lower() == "get":
                response = requests.get(url, headers=headers)
            elif method.lower() == "post":
                response = requests.post(url, headers=headers, json=json_data)
            elif method.lower() == "put":
                response = requests.put(url, headers=headers, json=json_data)
            else:
                raise ValueError(f"Unsupported method: {method}")

            response_data = response.json() if response.text else {}
            result = {"status_code": response.status_code, "response": response_data}

            # Verify status code if expected
            if expected_status_code:
                assert (
                    response.status_code == expected_status_code
                ), f"Expected status code {expected_status_code}, got {response.status_code}"
                logger.info(
                    f"✓ Status code verification passed: {response.status_code}"
                )

            # Verify error message if expected
            if expected_error_message and response_data.get("error"):
                error_message = response_data.get("error", {}).get("message", "")
                assert (
                    expected_error_message in error_message
                ), f"Expected error message containing '{expected_error_message}', got '{error_message}'"
                logger.info(f"✓ Error message verification passed: '{error_message}'")

            return result

        except AssertionError as e:
            logger.error(f"Assertion failed: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            raise


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
    try:
        # Try to create the user
        api.create_user(user["email"], user["password"], user["name"])
    except requests.exceptions.HTTPError as e:
        # If user already exists, just authenticate
        if "EMAIL_EXISTS" in str(e):
            logger.warning(
                f"User {user['email']} already exists, authenticating instead"
            )
            api.authenticate_user(user["email"], user["password"])
        else:
            raise

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

    try:
        # Try to create the user
        api.create_user(new_user["email"], new_user["password"], new_user["name"])
    except requests.exceptions.HTTPError as e:
        # If user already exists, just authenticate
        if "EMAIL_EXISTS" in str(e):
            logger.warning(
                f"User {new_user['email']} already exists, authenticating instead"
            )
            api.authenticate_user(new_user["email"], new_user["password"])
        else:
            raise

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
    except Exception as e:
        logger.error(f"Test failed with error: {str(e)}")
        exit(1)
    logger.info("All tests completed successfully!")
