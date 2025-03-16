#!/usr/bin/env python3
"""
Village API Invitation Automation Script

This script automates API calls to the Village Firebase emulator for testing invitation functionality.
It creates users, authenticates them, and performs various invitation operations.
"""

import requests
import json
import time
from typing import Dict, List, Optional, Any
import logging

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
        self.invitation_ids = {}  # Store invitation IDs
        self.friendship_ids = {}  # Store friendship IDs

    def create_user(
        self, email: str, password: str, display_name: str
    ) -> Dict[str, Any]:
        """Create a new user in Firebase Auth and set email as verified"""
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
        self, email: str, profile_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Create a user profile"""
        logger.info(f"Creating profile for user: {email}")

        if profile_data is None:
            profile_data = {}

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

    def get_friends(self, email: str) -> Dict[str, Any]:
        """Get user's friends"""
        logger.info(f"Getting friends for user: {email}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        response = requests.get(f"{API_BASE_URL}/me/friends", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get friends: {response.text}")
            response.raise_for_status()

        return response.json()

    # Invitation-specific methods
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

    def get_invitations(self, email: str) -> Dict[str, Any]:
        """Get user's invitations"""
        logger.info(f"Getting invitations for user: {email}")

        headers = {"Authorization": f"Bearer {self.tokens[email]}"}

        response = requests.get(f"{API_BASE_URL}/invitations", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get invitations: {response.text}")
            response.raise_for_status()

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
            elif method.lower() == "delete":
                response = requests.delete(url, headers=headers)
            else:
                raise ValueError(f"Unsupported method: {method}")

            response_data = response.json() if response.text else {}
            result = {"status_code": response.status_code, "response": response_data}

            # Verify status code if expected
            if expected_status_code:
                assert (
                    response.status_code == expected_status_code
                ), f"Expected status code {expected_status_code}, got {response.status_code}"
                logger.info(f" Status code verification passed: {response.status_code}")

            # Verify error message if expected
            if expected_error_message and response_data.get("error"):
                error_message = response_data.get("error", {}).get("message", "")
                assert (
                    expected_error_message in error_message
                ), f"Expected error message containing '{expected_error_message}', got '{error_message}'"
                logger.info(f" Error message verification passed: '{error_message}'")

            return result

        except AssertionError as e:
            logger.error(f"Assertion failed: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            raise


def run_invitation_demo():
    """Run a demonstration of the Village API invitation functionality"""
    api = VillageAPI()

    # Create four users
    users = [
        {
            "email": "invitation_test1@example.com",
            "password": "password123",
            "name": "Invitation Test One",
        },
        {
            "email": "invitation_test2@example.com",
            "password": "password123",
            "name": "Invitation Test Two",
        },
        {
            "email": "invitation_test3@example.com",
            "password": "password123",
            "name": "Invitation Test Three",
        },
        {
            "email": "invitation_test4@example.com",
            "password": "password123",
            "name": "Invitation Test Four",
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

    # Step 1: Create a profile for the first user
    profile_data = {
        "username": users[0]["email"].split("@")[0],
        "name": users[0]["name"],
        "avatar": f"https://example.com/avatar_{users[0]['name'].replace(' ', '_').lower()}.jpg",
        "location": "New York",
        "birthday": "1990-01-01",
    }
    api.create_profile(users[0]["email"], profile_data)

    # Step 2: First user creates an invitation
    invitation = api.create_invitation(users[0]["email"])
    logger.info(f"First user created invitation: {json.dumps(invitation, indent=2)}")

    # Step 3: First user gets their invitations
    invitations = api.get_invitations(users[0]["email"])
    logger.info(f"First user's invitations: {json.dumps(invitations, indent=2)}")

    # Step 4: First user resends the invitation
    resent_invitation = api.resend_invitation(
        users[0]["email"], api.invitation_ids[users[0]["email"]]
    )
    logger.info(
        f"First user resent invitation: {json.dumps(resent_invitation, indent=2)}"
    )

    # Step 5: Create a profile for the second user
    profile_data = {
        "username": users[1]["email"].split("@")[0],
        "name": users[1]["name"],
        "avatar": f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg",
        "location": "San Francisco",
        "birthday": "1992-02-02",
    }
    api.create_profile(users[1]["email"], profile_data)

    # Step 6: Second user accepts the invitation
    accepted_invitation = api.accept_invitation(
        users[1]["email"], api.invitation_ids[users[0]["email"]]
    )
    logger.info(
        f"Second user accepted invitation: {json.dumps(accepted_invitation, indent=2)}"
    )

    # Step 7: Both users get their friends
    friends_user1 = api.get_friends(users[0]["email"])
    logger.info(f"First user's friends: {json.dumps(friends_user1, indent=2)}")

    friends_user2 = api.get_friends(users[1]["email"])
    logger.info(f"Second user's friends: {json.dumps(friends_user2, indent=2)}")

    # Step 8: Second user creates an invitation
    invitation2 = api.create_invitation(users[1]["email"])
    logger.info(f"Second user created invitation: {json.dumps(invitation2, indent=2)}")

    # Step 9: Second user gets their invitations
    invitations2 = api.get_invitations(users[1]["email"])
    logger.info(f"Second user's invitations: {json.dumps(invitations2, indent=2)}")

    # Step 10: Create a profile for the third user
    profile_data = {
        "username": users[2]["email"].split("@")[0],
        "name": users[2]["name"],
        "avatar": f"https://example.com/avatar_{users[2]['name'].replace(' ', '_').lower()}.jpg",
        "location": "Chicago",
        "birthday": "1988-03-03",
    }
    api.create_profile(users[2]["email"], profile_data)

    # Step 11: Third user rejects the invitation
    rejected_invitation = api.reject_invitation(
        users[2]["email"], api.invitation_ids[users[1]["email"]]
    )
    logger.info(
        f"Third user rejected invitation: {json.dumps(rejected_invitation, indent=2)}"
    )

    # Step 12: Second user gets their friends
    friends_user2_after = api.get_friends(users[1]["email"])
    logger.info(
        f"Second user's friends after rejection: {json.dumps(friends_user2_after, indent=2)}"
    )

    # Step 13: Second user gets their invitations
    invitations2_after = api.get_invitations(users[1]["email"])
    logger.info(
        f"Second user's invitations after rejection: {json.dumps(invitations2_after, indent=2)}"
    )

    # ============ NEGATIVE PATH TESTS ============
    logger.info("\n\n========== STARTING NEGATIVE PATH TESTS ==========\n")

    # Create a profile for the fourth user to use in negative tests
    profile_data = {
        "username": users[3]["email"].split("@")[0],
        "name": users[3]["name"],
        "avatar": f"https://example.com/avatar_{users[3]['name'].replace(' ', '_').lower()}.jpg",
        "location": "Berlin",
        "birthday": "1995-04-04",
    }
    api.create_profile(users[3]["email"], profile_data)

    # Test 1: Attempt to accept non-existent invitation
    logger.info("Test 1: Attempting to accept non-existent invitation")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/non-existent-invitation-id/accept",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=404,
        expected_error_message="Invitation not found",
    )
    logger.info("✓ Accept non-existent invitation test passed")

    # Test 2: Attempt to reject non-existent invitation
    logger.info("Test 2: Attempting to reject non-existent invitation")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/non-existent-invitation-id/reject",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=404,
        expected_error_message="Invitation not found",
    )
    logger.info("✓ Reject non-existent invitation test passed")

    # Test 3: Attempt to resend non-existent invitation
    logger.info("Test 3: Attempting to resend non-existent invitation")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/non-existent-invitation-id/resend",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=404,
        expected_error_message="Invitation not found",
    )
    logger.info("✓ Resend non-existent invitation test passed")

    # Test 4: User attempts to accept their own invitation
    logger.info("Test 4: User attempting to accept their own invitation")
    # Fourth user creates an invitation
    invitation4 = api.create_invitation(users[3]["email"])
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/{api.invitation_ids[users[3]['email']]}/accept",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=400,
        expected_error_message="Cannot accept your own invitation",
    )
    logger.info("✓ Accept own invitation test passed")

    # Test 5: User attempts to reject their own invitation
    logger.info("Test 5: User attempting to reject their own invitation")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/{api.invitation_ids[users[3]['email']]}/reject",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=400,
        expected_error_message="Cannot reject your own invitation",
    )
    logger.info("✓ Reject own invitation test passed")

    # Test 6: User attempts to resend someone else's invitation
    logger.info("Test 6: User attempting to resend someone else's invitation")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/{api.invitation_ids[users[3]['email']]}/resend",
        headers={"Authorization": f"Bearer {api.tokens[users[2]['email']]}"},
        expected_status_code=403,
        expected_error_message="Not authorized",
    )
    logger.info("✓ Resend someone else's invitation test passed")

    # Test 7: Attempt to create invitation without a profile
    logger.info("Test 7: Attempting to create invitation without a profile")
    # Create a new user without a profile
    no_profile_user = {
        "email": "no_profile_invitation@example.com",
        "password": "password123",
        "name": "No Profile Invitation",
    }
    try:
        api.create_user(
            no_profile_user["email"],
            no_profile_user["password"],
            no_profile_user["name"],
        )
    except requests.exceptions.HTTPError as e:
        if "EMAIL_EXISTS" in str(e):
            logger.warning(
                f"User {no_profile_user['email']} already exists, authenticating"
            )
            api.authenticate_user(no_profile_user["email"], no_profile_user["password"])
        else:
            raise

    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[no_profile_user['email']]}",
        },
        json_data={},
        expected_status_code=404,
        expected_error_message="Profile not found",
    )
    logger.info("✓ Create invitation without profile test passed")

    # Test 8: Attempt to access invitations without authentication
    logger.info("Test 8: Attempting to access invitations without authentication")
    api.make_request_expecting_error(
        "get", f"{API_BASE_URL}/invitations", headers={}, expected_status_code=401
    )
    logger.info("✓ Unauthenticated access test passed")

    logger.info("========== NEGATIVE PATH TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_invitation_demo()
        logger.info("Invitation automation completed successfully!")
    except Exception as e:
        logger.error(f"Invitation automation failed: {str(e)}")
        raise
