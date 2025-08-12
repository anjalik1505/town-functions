#!/usr/bin/env python3
"""
Town API Nudge Automation Script

This script automates API calls to the Town Firebase emulator for testing the user nudge functionality.
It creates two users, makes them friends, and tests the nudge functionality:
- Create two users
- Create profiles for both users
- Make the users friends through invitation
- Test nudging a friend
- Test negative cases (nudging yourself, nudging a non-friend, rate limiting)
"""

import json
import logging

from utils.town_api import API_BASE_URL, TownAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def run_nudge_tests():
    """Run tests for the Town API nudge functionality"""
    api = TownAPI()

    # Create test users
    user1 = {
        "email": "nudge_sender@example.com",
        "password": "password123",
        "name": "Nudge Sender",
    }

    user2 = {
        "email": "nudge_receiver@example.com",
        "password": "password123",
        "name": "Nudge Receiver",
    }

    # Create and authenticate users
    api.create_user(user1["email"], user1["password"], user1["name"])
    api.create_user(user2["email"], user2["password"], user2["name"])

    # ============ SETUP: CREATE PROFILES AND ESTABLISH FRIENDSHIP ============
    logger.info("========== SETTING UP PROFILES AND FRIENDSHIP ==========")

    # Create profiles for both users
    profile1_data = {
        "username": user1["email"].split("@")[0],
        "name": user1["name"],
        "avatar": f"https://example.com/avatar_{user1['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "1990-01-01",
        "notification_settings": ["all"],
        "gender": "male",
    }
    created_profile1 = api.create_profile(user1["email"], profile1_data)
    logger.info(f"Created profile for user1: {json.dumps(created_profile1, indent=2)}")

    profile2_data = {
        "username": user2["email"].split("@")[0],
        "name": user2["name"],
        "avatar": f"https://example.com/avatar_{user2['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "1992-02-02",
        "notification_settings": ["all"],
        "gender": "female",
    }
    created_profile2 = api.create_profile(user2["email"], profile2_data)
    logger.info(f"Created profile for user2: {json.dumps(created_profile2, indent=2)}")

    # Register a device for user2 (the receiver)
    device_data = {
        "device_id": "test_device_id_for_nudge_receiver",
    }
    api.update_device(user2["email"], device_data)
    logger.info(f"Registered device for user2")

    # Create friendship between users
    invitation = api.get_invitation(user1["email"])
    logger.info(f"User 1 created invitation: {json.dumps(invitation, indent=2)}")
    invitation_id = invitation["invitation_id"]

    join_request = api.request_to_join(user2["email"], invitation_id)
    logger.info(f"User 2 requests to join: {json.dumps(join_request, indent=2)}")

    accept_result = api.accept_join_request(user1["email"], join_request["request_id"])
    logger.info(f"User 1 accepted invitation: {json.dumps(accept_result, indent=2)}")

    # Get user IDs
    user1_id = api.user_ids[user1["email"]]
    user2_id = api.user_ids[user2["email"]]
    logger.info(f"User1 ID: {user1_id}, User2 ID: {user2_id}")

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Test 1: User1 nudges User2
    logger.info("Test 1: User1 nudges User2")
    nudge_response = api.nudge_user(user1["email"], user2_id)
    logger.info(f"Nudge response: {json.dumps(nudge_response, indent=2)}")

    # Verify nudge response format
    assert "message" in nudge_response, "Response does not contain message field"
    assert nudge_response["message"] == "Nudge sent successfully", "Unexpected message in response"
    logger.info("✓ Nudge response format verification passed")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 2: User tries to nudge themselves
    logger.info("Test 2: User tries to nudge themselves")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/users/{user1_id}/nudge",
        headers={"Authorization": f"Bearer {api.tokens[user1['email']]}"},
        expected_status_code=400,
        expected_error_message="You cannot nudge yourself",
    )
    logger.info("✓ Self-nudge test passed")

    # Test 3: User tries to nudge a non-friend
    logger.info("Test 3: User tries to nudge a non-friend")

    # Create a third user who is not friends with the others
    user3 = {
        "email": "non_friend@example.com",
        "password": "password123",
        "name": "Non Friend",
    }
    api.create_user(user3["email"], user3["password"], user3["name"])
    profile3_data = {
        "username": user3["email"].split("@")[0],
        "name": user3["name"],
        "avatar": f"https://example.com/avatar_{user3['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "1995-05-05",
        "notification_settings": ["all"],
        "gender": "male",
    }
    api.create_profile(user3["email"], profile3_data)
    user3_id = api.user_ids[user3["email"]]

    # User1 tries to nudge User3 (not friends)
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/users/{user3_id}/nudge",
        headers={"Authorization": f"Bearer {api.tokens[user1['email']]}"},
        expected_status_code=403,
        expected_error_message="You must be friends with this user to nudge them",
    )
    logger.info("✓ Non-friend nudge test passed")

    # Test 4: Rate limiting - User1 tries to nudge User2 again within the cooldown period
    logger.info("Test 4: Rate limiting - User1 tries to nudge User2 again within the cooldown period")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/users/{user2_id}/nudge",
        headers={"Authorization": f"Bearer {api.tokens[user1['email']]}"},
        expected_status_code=409,
        expected_error_message="You can only nudge this user once per hour",
    )
    logger.info("✓ Rate limiting test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_nudge_tests()
        logger.info("Nudge automation completed successfully")
    except Exception as e:
        logger.error(f"Nudge automation failed: {str(e)}")
        raise
