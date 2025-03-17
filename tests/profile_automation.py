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
- Test negative cases (duplicate profile, missing fields, etc.)
"""

import json
import logging

import requests
from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


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
        api.create_user(user["email"], user["password"], user["name"])

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

    api.create_user(
        no_profile_user["email"],
        no_profile_user["password"],
        no_profile_user["name"],
    )

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

    # ============ FRIENDSHIP AND FEED/UPDATE TESTS ============
    logger.info("========== STARTING FRIENDSHIP AND FEED/UPDATE TESTS ==========")

    # Create profile for the second user
    second_user_profile_data = {
        "username": users[1]["email"].split("@")[0],
        "name": users[1]["name"],
        "avatar": f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg",
        "location": "Los Angeles",
        "birthday": "1992-05-15",
    }
    api.create_profile(users[1]["email"], second_user_profile_data)
    logger.info(f"Created profile for second user: {users[1]['email']}")

    # Test 8: Try to view another user's profile before becoming friends
    logger.info(
        "Test 8: Attempting to view another user's profile before becoming friends"
    )
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/users/{api.user_ids[users[1]['email']]}/profile",
        headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
        expected_status_code=403,
        expected_error_message="You must be friends with this user",
    )
    logger.info("✓ Non-friend profile access test passed")

    # Test 9: Attempt to view another user's updates before becoming friends
    logger.info(
        "Test 9: Attempting to view another user's updates before becoming friends"
    )
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/users/{api.user_ids[users[1]['email']]}/updates",
        headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
        expected_status_code=403,
        expected_error_message="You must be friends with this user",
    )
    logger.info("✓ Non-friend updates access test passed")

    # Connect users as friends using the invitation approach
    logger.info("Connecting users as friends using invitations")
    # User 1 creates an invitation
    invitation = api.create_invitation(users[0]["email"])
    logger.info(f"First user created invitation: {json.dumps(invitation, indent=2)}")

    # User 2 accepts the invitation
    accepted_invitation = api.accept_invitation(
        users[1]["email"], api.invitation_ids[users[0]["email"]]
    )
    logger.info(
        f"Second user accepted invitation: {json.dumps(accepted_invitation, indent=2)}"
    )

    # Verify friendship was created
    friends_user1 = api.get_friends(users[0]["email"])
    logger.info(f"First user's friends: {json.dumps(friends_user1, indent=2)}")

    friends_user2 = api.get_friends(users[1]["email"])
    logger.info(f"Second user's friends: {json.dumps(friends_user2, indent=2)}")

    logger.info("Users are now friends")

    # Test 10: Get user profile after becoming friends
    logger.info("Test 10: Getting user profile after becoming friends")
    user2_profile = api.get_user_profile(
        users[0]["email"], api.user_ids[users[1]["email"]]
    )
    logger.info(f"Retrieved user 2 profile: {json.dumps(user2_profile, indent=2)}")
    assert (
        user2_profile["username"] == second_user_profile_data["username"]
    ), "Username mismatch"
    assert user2_profile["name"] == second_user_profile_data["name"], "Name mismatch"
    logger.info("✓ Friend profile access test passed")

    # Test 11: Get user updates after becoming friends
    logger.info("Test 11: Getting user updates after becoming friends")
    user2_updates = api.get_user_updates(
        users[0]["email"], api.user_ids[users[1]["email"]]
    )
    logger.info(f"Retrieved user 2 updates: {json.dumps(user2_updates, indent=2)}")
    # We're not creating updates, so we just check if the response structure is correct
    assert "updates" in user2_updates, "Response does not contain updates field"
    logger.info("✓ Friend updates access test passed")

    # Test 12: Get my feeds
    logger.info("Test 12: Getting my feeds")
    user1_feeds = api.get_my_feed(users[0]["email"])
    logger.info(f"Retrieved feeds for user 1: {json.dumps(user1_feeds, indent=2)}")
    # We're not creating updates, so we just check if the response structure is correct
    assert "updates" in user1_feeds, "Response does not contain updates field"
    logger.info("✓ My feeds test passed")

    # Test 13: Get my updates
    logger.info("Test 13: Getting my updates")
    my_updates = api.get_my_updates(users[0]["email"])
    logger.info(f"Retrieved my updates for user 1: {json.dumps(my_updates, indent=2)}")
    # We're not creating updates, so we just check if the response structure is correct
    assert "updates" in my_updates, "Response does not contain updates field"
    logger.info("✓ My updates test passed")

    # Test 14: Test pagination for feeds
    logger.info("Test 14: Testing pagination for feeds")
    # Get feeds with small limit to test pagination
    first_page = api.get_my_feed(users[0]["email"], limit=3)
    logger.info(f"Retrieved first page of feeds: {json.dumps(first_page, indent=2)}")
    # Check if the response contains the next_timestamp field for pagination
    assert (
        "next_timestamp" in first_page
    ), "Response does not contain next_timestamp field for pagination"

    # If there's a next_timestamp, try to get the second page
    if first_page["next_timestamp"]:
        second_page = api.get_my_feed(
            users[0]["email"], limit=3, after_timestamp=first_page["next_timestamp"]
        )
        logger.info(
            f"Retrieved second page of feeds: {json.dumps(second_page, indent=2)}"
        )

    logger.info("✓ Feed pagination test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_profile_tests()
        logger.info("Profile automation completed successfully")
    except Exception as e:
        logger.error(f"Profile automation failed: {str(e)}")
        raise
