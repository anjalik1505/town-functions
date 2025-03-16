#!/usr/bin/env python3
"""
Village API Profile Automation Script

This script automates API calls to the Village Firebase emulator for testing profile functionality.
It creates users, authenticates them, and performs various profile operations:
- Create a user
- Create a profile
- Get the profile
- Update the profile
- Get the updated profile
- Test negative cases
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
FIREBASE_UPDATE_USER_URL = "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key"


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

    def create_profile(
        self, email: str, profile_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create a user profile"""
        logger.info(f"Creating profile for user: {email}")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}",
        }

        response = requests.post(
            f"{API_BASE_URL}/me/profile", headers=headers, json=profile_data
        )
        if response.status_code != 200:
            logger.error(f"Failed to create profile: {response.text}")
            response.raise_for_status()

        logger.info(f"Profile created for user: {email}")
        return response.json()

    def get_profile(self, email: str) -> Dict[str, Any]:
        """Get the user's profile"""
        logger.info(f"Getting profile for user: {email}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        response = requests.get(f"{API_BASE_URL}/me/profile", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get profile: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully retrieved profile for user: {email}")
        return response.json()

    def update_profile(
        self, email: str, profile_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a user profile"""
        logger.info(f"Updating profile for user: {email}")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}",
        }

        response = requests.put(
            f"{API_BASE_URL}/me/profile", headers=headers, json=profile_data
        )
        if response.status_code != 200:
            logger.error(f"Failed to update profile: {response.text}")
            response.raise_for_status()

        logger.info(f"Profile updated for user: {email}")
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


def run_profile_tests():
    """Run tests for the Village API profile functionality"""
    api = VillageAPI()

    # Create two users
    users = [
        {
            "email": "profile_test1@example.com",
            "password": "password123",
            "name": "Profile Test One",
        },
        {
            "email": "profile_test2@example.com",
            "password": "password123",
            "name": "Profile Test Two",
        },
    ]

    # Create and authenticate users
    for user in users:
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

    # Step 1: Create a profile for the first user
    initial_profile_data = {
        "username": users[0]["email"].split("@")[0],
        "name": users[0]["name"],
        "avatar": f"https://example.com/avatar_{users[0]['name'].replace(' ', '_').lower()}.jpg",
        "location": "New York",
        "birthday": "1990-01-01",
        "notification_settings": ["messages", "updates"],
    }
    created_profile = api.create_profile(users[0]["email"], initial_profile_data)
    logger.info(f"Created profile: {json.dumps(created_profile, indent=2)}")

    # Step 2: Get the profile to verify creation
    retrieved_profile = api.get_profile(users[0]["email"])
    logger.info(f"Retrieved profile: {json.dumps(retrieved_profile, indent=2)}")

    # Verify profile data matches what was created
    assert (
        retrieved_profile["username"] == initial_profile_data["username"]
    ), "Username mismatch"
    assert retrieved_profile["name"] == initial_profile_data["name"], "Name mismatch"
    assert (
        retrieved_profile["avatar"] == initial_profile_data["avatar"]
    ), "Avatar mismatch"
    assert (
        retrieved_profile["location"] == initial_profile_data["location"]
    ), "Location mismatch"
    assert (
        retrieved_profile["birthday"] == initial_profile_data["birthday"]
    ), "Birthday mismatch"
    logger.info("Profile verification successful - all fields match")

    # Step 3: Update the profile
    updated_profile_data = {
        "username": f"{users[0]['email'].split('@')[0]}_updated",
        "name": f"{users[0]['name']} Updated",
        "avatar": f"https://example.com/new_avatar_{users[0]['name'].replace(' ', '_').lower()}.jpg",
        "location": "San Francisco",
        "notification_settings": ["messages", "updates", "groups"],
    }
    updated_profile = api.update_profile(users[0]["email"], updated_profile_data)
    logger.info(f"Updated profile: {json.dumps(updated_profile, indent=2)}")

    # Step 4: Get the profile again to verify updates
    retrieved_updated_profile = api.get_profile(users[0]["email"])
    logger.info(
        f"Retrieved updated profile: {json.dumps(retrieved_updated_profile, indent=2)}"
    )

    # Verify updated profile data
    assert (
        retrieved_updated_profile["username"] == updated_profile_data["username"]
    ), "Updated username mismatch"
    assert (
        retrieved_updated_profile["name"] == updated_profile_data["name"]
    ), "Updated name mismatch"
    assert (
        retrieved_updated_profile["avatar"] == updated_profile_data["avatar"]
    ), "Updated avatar mismatch"
    assert (
        retrieved_updated_profile["location"] == updated_profile_data["location"]
    ), "Updated location mismatch"
    # Birthday should remain unchanged as it wasn't updated
    assert (
        retrieved_updated_profile["birthday"] == initial_profile_data["birthday"]
    ), "Birthday should be unchanged"
    logger.info("Updated profile verification successful - all fields match")

    # Step 5: Test partial update (only update name)
    partial_update_data = {"name": f"{users[0]['name']} Partial Update"}
    partially_updated_profile = api.update_profile(
        users[0]["email"], partial_update_data
    )
    logger.info(
        f"Partially updated profile: {json.dumps(partially_updated_profile, indent=2)}"
    )

    # Get the profile again to verify partial update
    retrieved_partial_profile = api.get_profile(users[0]["email"])

    # Verify that only the name was updated
    assert (
        retrieved_partial_profile["name"] == partial_update_data["name"]
    ), "Partially updated name mismatch"
    assert (
        retrieved_partial_profile["username"] == updated_profile_data["username"]
    ), "Username should be unchanged"
    assert (
        retrieved_partial_profile["avatar"] == updated_profile_data["avatar"]
    ), "Avatar should be unchanged"
    logger.info("Partial update verification successful")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Try to create a profile for a user that already has one
    logger.info("Test 1: Attempting to create a duplicate profile")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=initial_profile_data,
        expected_status_code=400,
        expected_error_message="Profile already exists",
    )
    logger.info("✓ Duplicate profile test passed")

    # Test 2: Try to create a profile with missing required fields
    logger.info("Test 2: Attempting to create a profile with missing required fields")
    # Create profile for second user but missing username (required field)
    invalid_profile_data = {
        "name": users[1]["name"],
        "avatar": f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg",
    }
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[1]['email']]}",
        },
        json_data=invalid_profile_data,
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Missing required field test passed")

    # Test 3: Try to get profile for a user that doesn't have one
    logger.info("Test 3: Attempting to get a non-existent profile")
    # First create a new user without a profile
    no_profile_user = {
        "email": "no_profile@example.com",
        "password": "password123",
        "name": "No Profile",
    }
    try:
        api.create_user(
            no_profile_user["email"],
            no_profile_user["password"],
            no_profile_user["name"],
        )
    except requests.exceptions.HTTPError as e:
        if "EMAIL_EXISTS" in str(e):
            api.authenticate_user(no_profile_user["email"], no_profile_user["password"])
        else:
            raise

    # Try to get the profile
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Authorization": f"Bearer {api.tokens[no_profile_user['email']]}",
        },
        expected_status_code=404,
        expected_error_message="Profile not found",
    )
    logger.info("✓ Non-existent profile retrieval test passed")

    # Test 4: Try to update a profile that doesn't exist
    logger.info("Test 4: Attempting to update a non-existent profile")
    api.make_request_expecting_error(
        "put",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[no_profile_user['email']]}",
        },
        json_data={"username": "should_not_work", "name": "Should Not Work"},
        expected_status_code=404,
        expected_error_message="Profile not found",
    )
    logger.info("✓ Update non-existent profile test passed")

    # Test 5: Try to create a profile with invalid JSON
    logger.info("Test 5: Attempting to create a profile with invalid JSON")
    try:
        invalid_json_headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[no_profile_user['email']]}",
        }
        # Send invalid JSON by making a direct request
        response = requests.post(
            f"{API_BASE_URL}/me/profile",
            headers=invalid_json_headers,
            data="This is not valid JSON",
        )
        assert (
            response.status_code == 400
        ), f"Expected status code 400, got {response.status_code}"
        logger.info(f"✓ Invalid JSON test passed: Status code {response.status_code}")
    except Exception as e:
        logger.error(f"Error during invalid JSON test: {str(e)}")
        raise

    # Test 6: Try to update profile with invalid field values
    logger.info("Test 6: Attempting to update profile with invalid field values")
    invalid_update_data = {
        "username": "",  # Empty username
        "notification_settings": "not_a_list",  # Should be a list
    }
    api.make_request_expecting_error(
        "put",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=invalid_update_data,
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Invalid field values test passed")

    # Test 7: Try to access profile without authentication
    logger.info("Test 7: Attempting to access profile without authentication")
    api.make_request_expecting_error(
        "get", f"{API_BASE_URL}/me/profile", headers={}, expected_status_code=401
    )
    logger.info("✓ Unauthenticated access test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_profile_tests()
        logger.info("Profile automation completed successfully")
    except Exception as e:
        logger.error(f"Profile automation failed: {str(e)}")
        raise
