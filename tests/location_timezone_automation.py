#!/usr/bin/env python3
"""Town API Location and Timezone Automation Script

This script automates API calls to the Town Firebase emulator for testing location and timezone functionality.
It creates two users, authenticates them, and performs the following tests:
- Set location and timezone on user 1
- Create a friendship between user 1 and user 2
- Verify user 2 can view user 1's profile with timezone and location
- Test negative cases for invalid timezone and location formats
"""

import json
import logging

from utils.town_api import API_BASE_URL, TownAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def run_location_timezone_tests():
    """Run tests for the Town API location and timezone functionality"""
    api = TownAPI()

    # Create two test users
    users = [
        {
            "email": "location_timezone_test1@example.com",
            "password": "password123",
            "name": "Location Timezone Test User 1",
        },
        {
            "email": "location_timezone_test2@example.com",
            "password": "password123",
            "name": "Location Timezone Test User 2",
        },
    ]

    # Create and authenticate users
    for user in users:
        api.create_user(user["email"], user["password"], user["name"])

        # Create a profile for each user
        profile_data = {
            "username": user["email"].split("@")[0],
            "name": user["name"],
            "avatar": f"https://example.com/avatar_{user['name'].replace(' ', '_').lower()}.jpg",
            "birthday": "1990-01-01",
            "gender": "male",
        }
        api.create_profile(user["email"], profile_data)
        logger.info(f"Created profile for user: {user['email']}")

    # ============ LOCATION AND TIMEZONE TESTS ============
    logger.info("========== STARTING LOCATION AND TIMEZONE TESTS ==========")

    # Set timezone and location for user 1
    timezone_data = {
        "timezone": "America/New_York",
    }
    location_data = {
        "location": "Los Angeles, United States",
    }

    # Update timezone
    updated_timezone = api.update_timezone(users[0]["email"], timezone_data)
    logger.info(f"Updated timezone: {json.dumps(updated_timezone, indent=2)}")

    # Verify timezone response
    assert (
            updated_timezone["timezone"] == timezone_data["timezone"]
    ), "Timezone mismatch"
    assert "updated_at" in updated_timezone, "updated_at field missing"

    # Update location
    updated_location = api.update_location(users[0]["email"], location_data)
    logger.info(f"Updated location: {json.dumps(updated_location, indent=2)}")

    # Verify location response
    assert (
            updated_location["location"] == location_data["location"]
    ), "Location mismatch"
    assert "updated_at" in updated_location, "updated_at field missing"

    # Verify profile has the updated timezone and location
    user1_profile = api.get_profile(users[0]["email"])
    logger.info(f"Retrieved user 1 profile: {json.dumps(user1_profile, indent=2)}")

    assert (
            user1_profile["timezone"] == timezone_data["timezone"]
    ), "Timezone not updated in profile"
    assert (
            user1_profile["location"] == location_data["location"]
    ), "Location not updated in profile"
    logger.info("✓ Profile verification successful")

    # Create friendship between users
    invitation = api.get_invitation(users[0]["email"])
    logger.info(f"User 1 created invitation: {json.dumps(invitation, indent=2)}")
    invitation_id = invitation["invitation_id"]

    join_request = api.request_to_join(users[1]["email"], invitation_id)
    logger.info(f"User 2 requests to join: {json.dumps(join_request, indent=2)}")

    accept_result = api.accept_join_request(users[0]["email"], join_request["request_id"])
    logger.info(f"User 1 accepted invitation: {json.dumps(accept_result, indent=2)}")

    # Now that they're friends, user 2 views user 1's profile
    user1_profile_from_user2 = api.get_user_profile(
        users[1]["email"], api.user_ids[users[0]["email"]]
    )
    logger.info(
        f"User 2 viewing user 1's profile: {json.dumps(user1_profile_from_user2, indent=2)}"
    )

    # Verify timezone and location are visible to friend
    assert (
            user1_profile_from_user2["timezone"] == timezone_data["timezone"]
    ), "Timezone not visible to friend"
    assert (
            user1_profile_from_user2["location"] == location_data["location"]
    ), "Location not visible to friend"
    logger.info("✓ Friend can see timezone and location")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Invalid timezone format
    logger.info("Testing invalid timezone format")
    invalid_timezone_data = {
        "timezone": "New York",  # Invalid format (not a valid IANA timezone)
    }
    api.make_request_expecting_error(
        "put",
        f"{API_BASE_URL}/me/timezone",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=invalid_timezone_data,
        expected_status_code=400,
        expected_error_message="Invalid timezone. Must be a valid IANA timezone identifier",
    )
    logger.info("✓ Invalid timezone format test passed")

    # Test 2: Invalid location format
    logger.info("Testing invalid location format")
    invalid_location_data = {
        "location": "New York",  # Invalid format (should be City, Country)
    }
    api.make_request_expecting_error(
        "put",
        f"{API_BASE_URL}/me/location",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=invalid_location_data,
        expected_status_code=400,
        expected_error_message='Location must be in the format "City, Country"',
    )
    logger.info("✓ Invalid location format test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_location_timezone_tests()
        logger.info("Location and timezone automation completed successfully")
    except Exception as e:
        logger.error(f"Location and timezone automation failed: {str(e)}")
        raise
