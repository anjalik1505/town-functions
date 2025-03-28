#!/usr/bin/env python3
"""
Village API Utility Class

This module provides a common interface for interacting with the Village API
for testing purposes. It includes methods for user management, authentication,
profile operations, friend connections, and various API endpoints.
"""

import json
import logging
import urllib.parse
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
        self.invitation_ids = {}  # Store invitation IDs for invitation tests
        self.friendship_ids = {}  # Store friendship IDs for friend tests

    # User Management Methods
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
        response_data = response.json() if response.text else {}

        # Check for EMAIL_EXISTS error
        if (
            response.status_code == 400
            and response_data.get("error", {}).get("message") == "EMAIL_EXISTS"
        ):
            logger.warning(f"User {email} already exists, authenticating instead")
            return self.authenticate_user(email, password)

        # For other errors, raise the exception
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

    # Profile Methods
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

    # Friend Methods
    def get_friends(
        self, email: str, limit: int = 10, after_timestamp: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get user's friends"""
        logger.info(f"Getting friends for user: {email}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        url = f"{API_BASE_URL}/me/friends?limit={limit}"
        if after_timestamp:
            # Ensure timestamp is properly URL encoded
            encoded_timestamp = urllib.parse.quote(after_timestamp)
            url += f"&after_timestamp={encoded_timestamp}"

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get friends: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully retrieved friends for user: {email}")
        return response.json()

    # Feed and Update Methods
    def get_my_feed(
        self, email: str, limit: int = 10, after_timestamp: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get the user's feed (updates from friends and groups)"""
        logger.info(f"Getting feeds for user: {email}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        url = f"{API_BASE_URL}/me/feed?limit={limit}"
        if after_timestamp:
            # Ensure timestamp is properly URL encoded
            encoded_timestamp = urllib.parse.quote(after_timestamp)
            url += f"&after_timestamp={encoded_timestamp}"

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get feeds: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully retrieved feeds for user: {email}")
        return response.json()

    def get_my_updates(
        self, email: str, limit: int = 10, after_timestamp: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get updates created by the current user"""
        logger.info(f"Getting updates for user: {email}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        url = f"{API_BASE_URL}/me/updates?limit={limit}"
        if after_timestamp:
            # Ensure timestamp is properly URL encoded
            encoded_timestamp = urllib.parse.quote(after_timestamp)
            url += f"&after_timestamp={encoded_timestamp}"

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get updates: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully retrieved updates for user: {email}")
        return response.json()

    def create_update(self, email: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new update"""
        logger.info(f"Creating update for user: {email}")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}",
        }

        response = requests.post(
            f"{API_BASE_URL}/updates", headers=headers, json=update_data
        )
        if response.status_code != 200:
            logger.error(f"Failed to create update: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully created update for user: {email}")
        return response.json()

    def get_user_profile(self, email: str, target_user_id: str) -> Dict[str, Any]:
        """Get another user's profile"""
        logger.info(f"User {email} getting profile for user ID: {target_user_id}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        response = requests.get(
            f"{API_BASE_URL}/users/{target_user_id}/profile", headers=headers
        )
        if response.status_code != 200:
            logger.error(f"Failed to get user profile: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully retrieved profile for user ID: {target_user_id}")
        return response.json()

    def get_user_updates(
        self,
        email: str,
        target_user_id: str,
        limit: int = 10,
        after_timestamp: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get updates created by another user"""
        logger.info(f"User {email} getting updates for user ID: {target_user_id}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        url = f"{API_BASE_URL}/users/{target_user_id}/updates?limit={limit}"
        if after_timestamp:
            # Ensure timestamp is properly URL encoded
            encoded_timestamp = urllib.parse.quote(after_timestamp)
            url += f"&after_timestamp={encoded_timestamp}"

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get user updates: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully retrieved updates for user ID: {target_user_id}")
        return response.json()

    # Device Methods
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

    # Invitation Methods
    def create_invitation(self, email: str) -> Dict[str, Any]:
        """Create a new invitation"""
        logger.info(f"User {email} creating invitation")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}",
        }

        # Send an empty JSON payload
        payload = {}
        response = requests.post(
            f"{API_BASE_URL}/invitations", headers=headers, json=payload
        )
        if response.status_code != 200:
            logger.error(f"Failed to create invitation: {response.text}")
            response.raise_for_status()

        data = response.json()
        # Store the invitation ID for later use
        if "invitation_id" in data:
            self.invitation_ids[email] = data["invitation_id"]
            logger.info(f"Invitation created with ID: {self.invitation_ids[email]}")

        return data

    def get_invitations(
        self, email: str, limit: int = 10, after_timestamp: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get user's invitations"""
        logger.info(f"Getting invitations for user: {email}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        url = f"{API_BASE_URL}/invitations?limit={limit}"
        if after_timestamp:
            # Ensure timestamp is properly URL encoded
            encoded_timestamp = urllib.parse.quote(after_timestamp)
            url += f"&after_timestamp={encoded_timestamp}"

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get invitations: {response.text}")
            response.raise_for_status()

        logger.info(f"Successfully retrieved invitations for user: {email}")
        return response.json()

    def resend_invitation(self, email: str, invitation_id: str) -> Dict[str, Any]:
        """Resend an invitation"""
        logger.info(f"User {email} resending invitation with ID: {invitation_id}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        response = requests.post(
            f"{API_BASE_URL}/invitations/{invitation_id}/resend", headers=headers
        )
        if response.status_code != 200:
            logger.error(f"Failed to resend invitation: {response.text}")
            response.raise_for_status()

        return response.json()

    def accept_invitation(self, email: str, invitation_id: str) -> Dict[str, Any]:
        """Accept an invitation"""
        logger.info(f"User {email} accepting invitation with ID: {invitation_id}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        response = requests.post(
            f"{API_BASE_URL}/invitations/{invitation_id}/accept", headers=headers
        )
        if response.status_code != 200:
            logger.error(f"Failed to accept invitation: {response.text}")
            response.raise_for_status()

        return response.json()

    def reject_invitation(self, email: str, invitation_id: str) -> Dict[str, Any]:
        """Reject an invitation"""
        logger.info(f"User {email} rejecting invitation with ID: {invitation_id}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        response = requests.post(
            f"{API_BASE_URL}/invitations/{invitation_id}/reject", headers=headers
        )
        if response.status_code != 200:
            logger.error(f"Failed to reject invitation: {response.text}")
            response.raise_for_status()

        return response.json()

    # Utility Methods
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

            # Log the full response data
            logger.info(f"Full response data: {response.text}")

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
