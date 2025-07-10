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
import time

import requests
from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Test configuration
TEST_CONFIG = {
    "wait_time": 5,  # Time to wait between operations
}


def run_profile_tests():
    """Run tests for the Village API profile functionality"""
    api = VillageAPI()

    # Create two users
    users = [
        {
            "email": "profile_test1@example.com",
            "password": "password123",
            "name": "Profile Test One",
            "phone_number": "0987654321",
        },
        {
            "email": "profile_test2@example.com",
            "password": "password123",
            "name": "Profile Test Two",
            "phone_number": "0987654321"
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
        "location": "New York",  # making sure it is ignored
        "birthday": "1990-01-01",
        "phone_number": users[0]["phone_number"],
        "notification_settings": ["all"],
        "gender": "male",
        "goal": "stay_connected",
        "connect_to": "friends",
        "personality": "share_little",
        "tone": "light_and_casual",
        "nudging_settings": {
            "occurrence": "weekly",
            "times_of_day": ["09:00"],
            "days_of_week": ["monday"],
        },
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
    # Location is now empty since it's managed by a separate endpoint
    assert retrieved_profile["location"] == "", "Location should be empty"
    # Check that timezone field exists and is empty
    assert "timezone" in retrieved_profile, "Timezone field missing"
    assert retrieved_profile["timezone"] == "", "Timezone should be empty"
    assert (
        retrieved_profile["birthday"] == initial_profile_data["birthday"]
    ), "Birthday mismatch"
    assert (
        retrieved_profile["gender"] == initial_profile_data["gender"]
    ), "Gender mismatch"
    logger.info("Profile verification successful - all fields match")

    # Step 3: Update the profile
    updated_profile_data = {
        "username": f"{users[0]['email'].split('@')[0]}_updated",
        "name": f"{users[0]['name']} Updated",
        "avatar": f"https://example.com/new_avatar_{users[0]['name'].replace(' ', '_').lower()}.jpg",
        "notification_settings": ["urgent"],
        "gender": "female",
        "birthday": "1995-12-25",  # Valid date in yyyy-mm-dd format
        "phone_number": users[0]["phone_number"],
        "goal": "improve_relationships",
        "connect_to": "family",
        "personality": "share_big",
        "tone": "deep_and_reflective",
        "nudging_settings": {"occurrence": "daily", "times_of_day": ["08:00", "18:00"]},
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
    # Location should remain empty (managed by separate endpoint)
    assert retrieved_updated_profile["location"] == "", "Location should remain empty"
    # Timezone should remain empty (managed by separate endpoint)
    assert retrieved_updated_profile["timezone"] == "", "Timezone should remain empty"
    assert (
        retrieved_updated_profile["gender"] == updated_profile_data["gender"]
    ), "Updated gender mismatch"
    # Birthday should be updated to the new value
    assert (
        retrieved_updated_profile["birthday"] == updated_profile_data["birthday"]
    ), "Birthday should be updated"
    logger.info("Updated profile verification successful - all fields match")

    # Step 5: Test partial update (only update name and gender)
    partial_update_data = {
        "name": f"{users[0]['name']} Partial Update",
        "gender": "non-binary",
        "goal": "Free form goal text",
        "connect_to": "Custom connection preference",
    }
    partially_updated_profile = api.update_profile(
        users[0]["email"], partial_update_data
    )
    logger.info(
        f"Partially updated profile: {json.dumps(partially_updated_profile, indent=2)}"
    )

    # Get the profile again to verify partial update
    retrieved_partial_profile = api.get_profile(users[0]["email"])

    # Verify that only the name and gender were updated
    assert (
        retrieved_partial_profile["name"] == partial_update_data["name"]
    ), "Partially updated name mismatch"
    assert (
        retrieved_partial_profile["gender"] == partial_update_data["gender"]
    ), "Partially updated gender mismatch"
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

    # Test 3: Birthday validation tests
    logger.info("Test 3: Birthday validation tests")

    # Test 3.1: Invalid birthday format
    logger.info("Test 3.1: Attempting to create a profile with invalid birthday format")
    invalid_birthday_profile_data = {
        "username": users[1]["email"].split("@")[0],
        "name": users[1]["name"],
        "avatar": f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "01-01-1990",  # Invalid format (should be yyyy-mm-dd)
    }
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[1]['email']]}",
        },
        json_data=invalid_birthday_profile_data,
        expected_status_code=400,
        expected_error_message="Birthday must be in yyyy-mm-dd format",
    )
    logger.info("✓ Invalid birthday format test passed")

    # Test 3.2: Invalid date (month > 12)
    logger.info(
        "Test 3.2: Attempting to create a profile with invalid date (month > 12)"
    )
    invalid_date_profile_data = {
        "username": users[1]["email"].split("@")[0],
        "name": users[1]["name"],
        "avatar": f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "1990-13-01",  # Invalid date (month 13 doesn't exist)
    }
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[1]['email']]}",
        },
        json_data=invalid_date_profile_data,
        expected_status_code=400,
        expected_error_message="Birthday must be a valid date",
    )
    logger.info("✓ Invalid date (month > 12) test passed")

    # Test 3.3: Invalid date (day > 31)
    logger.info("Test 3.3: Attempting to create a profile with invalid date (day > 31)")
    invalid_day_profile_data = {
        "username": users[1]["email"].split("@")[0],
        "name": users[1]["name"],
        "avatar": f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "1990-01-32",  # Invalid date (day 32 doesn't exist)
    }
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[1]['email']]}",
        },
        json_data=invalid_day_profile_data,
        expected_status_code=400,
        expected_error_message="Birthday must be a valid date",
    )
    logger.info("✓ Invalid date (day > 31) test passed")

    # Test 3.4: Invalid date (February 30)
    logger.info(
        "Test 3.4: Attempting to create a profile with invalid date (February 30)"
    )
    invalid_feb_profile_data = {
        "username": users[1]["email"].split("@")[0],
        "name": users[1]["name"],
        "avatar": f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "1990-02-30",  # Invalid date (February doesn't have 30 days)
    }
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[1]['email']]}",
        },
        json_data=invalid_feb_profile_data,
        expected_status_code=400,
        expected_error_message="Birthday must be a valid date",
    )
    logger.info("✓ Invalid date (February 30) test passed")

    # Test 4: Try to get profile for a user that doesn't have one
    logger.info("Test 4: Attempting to get a non-existent profile")
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

    # Test 5: Try to update a profile that doesn't exist
    logger.info("Test 5: Attempting to update a non-existent profile")
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

    # Test 6: Try to create a profile with invalid JSON
    logger.info("Test 6: Attempting to create a profile with invalid JSON")
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

    # Test 7: Try to update profile with invalid field values
    logger.info("Test 7: Attempting to update profile with invalid field values")
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

    # Test 8: Try to update profile with invalid notification settings
    logger.info(
        "Test 8: Attempting to update profile with invalid notification settings"
    )
    invalid_notification_data = {
        "notification_settings": [
            "messages",
            "updates",
        ],  # Invalid notification settings
    }
    api.make_request_expecting_error(
        "put",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=invalid_notification_data,
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Invalid notification settings test passed")

    # Test 9: Try to update profile with invalid birthday format
    logger.info("Test 9: Attempting to update profile with invalid birthday format")
    invalid_birthday_data = {
        "birthday": "01-01-1990",  # Invalid format (should be yyyy-mm-dd)
    }
    api.make_request_expecting_error(
        "put",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=invalid_birthday_data,
        expected_status_code=400,
        expected_error_message="Birthday must be in yyyy-mm-dd format",
    )
    logger.info("✓ Invalid birthday format on update test passed")

    # Test 10: Try to update profile with invalid personality and tone values
    logger.info(
        "Test 10: Attempting to update profile with invalid personality and tone values"
    )
    invalid_fields_data = {
        "personality": "invalid_personality_value",
        "tone": "invalid_tone_value",
    }
    api.make_request_expecting_error(
        "put",
        f"{API_BASE_URL}/me/profile",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=invalid_fields_data,
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Invalid personality and tone values test passed")

    # Test 11: Try to access profile without authentication
    logger.info("Test 11: Attempting to access profile without authentication")
    api.make_request_expecting_error(
        "get", f"{API_BASE_URL}/me/profile", headers={}, expected_status_code=401
    )
    logger.info("✓ Unauthenticated access test passed")

    # ============ FRIENDSHIP TESTS ============
    logger.info("========== STARTING FRIENDSHIP TESTS ==========")

    # Create profile for the second user
    second_user_profile_data = {
        "username": users[1]["email"].split("@")[0],
        "name": users[1]["name"],
        "avatar": f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "1992-05-15",
        "gender": "female",
        "goal": "meet_new_people",
        "connect_to": "new_people",
        "personality": "keep_to_self",
        "tone": "surprise_me",
        "nudging_settings": {
            "occurrence": "few_days",
            "times_of_day": ["10:00"],
            "days_of_week": ["monday", "thursday"],
        },
    }
    api.create_profile(users[1]["email"], second_user_profile_data)
    logger.info(f"Created profile for second user: {users[1]['email']}")

    # Test 12: Try to view another user's profile before becoming friends
    logger.info(
        "Test 12: Attempting to view another user's profile before becoming friends"
    )
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/users/{api.user_ids[users[1]['email']]}/profile",
        headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
        expected_status_code=403,
        expected_error_message="You must be friends with this user",
    )
    logger.info("✓ Non-friend profile access test passed")

    # Connect users as friends using the invitation approach
    logger.info("Connecting users as friends using invitations")

    # User 1 creates an invitation
    invitation = api.get_invitation(users[0]["email"])
    logger.info(f"User 1 created invitation: {json.dumps(invitation, indent=2)}")
    invitation_id = invitation["invitation_id"]

    # Verify invitation contains correct profile data
    assert (
        invitation["username"] == retrieved_partial_profile["username"]
    ), "Invitation username mismatch"
    assert (
        invitation["name"] == retrieved_partial_profile["name"]
    ), "Invitation name mismatch"
    assert (
        invitation["avatar"] == retrieved_partial_profile["avatar"]
    ), "Invitation avatar mismatch"
    logger.info("✓ Invitation profile data verification successful")

    # User 2 requests to join
    join_request = api.request_to_join(users[1]["email"], invitation_id)
    logger.info(f"User 2 requests to join: {json.dumps(join_request, indent=2)}")

    # ============ PROFILE UPDATE PROPAGATION TESTS ============
    logger.info("========== STARTING PROFILE UPDATE PROPAGATION TESTS ==========")

    # Test 13: Update User 1's profile and verify changes in invitation and join requests
    logger.info(
        "Test 13: Updating User 1's profile and verifying propagation to invitation and join requests"
    )

    user1_update_data = {
        "username": "user1_new_username",
        "name": "User 1 New Name",
        "avatar": "https://example.com/new_avatar_user1.jpg",
    }

    # Update User 1's profile
    updated_user1_profile = api.update_profile(users[0]["email"], user1_update_data)
    logger.info(
        f"Updated User 1 profile: {json.dumps(updated_user1_profile, indent=2)}"
    )

    # Wait for update triggers to process
    logger.info(
        f"Waiting {TEST_CONFIG['wait_time']} seconds for profile update triggers to process..."
    )
    time.sleep(TEST_CONFIG["wait_time"])

    # Get the invitation again to verify updates
    updated_invitation = api.get_invitation(users[0]["email"])
    logger.info(f"Updated invitation: {json.dumps(updated_invitation, indent=2)}")

    # Verify invitation data was updated
    assert (
        updated_invitation["username"] == user1_update_data["username"]
    ), "Updated invitation username mismatch"
    assert (
        updated_invitation["name"] == user1_update_data["name"]
    ), "Updated invitation name mismatch"
    assert (
        updated_invitation["avatar"] == user1_update_data["avatar"]
    ), "Updated invitation avatar mismatch"
    logger.info("✓ Invitation profile update verification successful")

    # Get join requests for User 1's invitation to verify receiver info was updated
    my_join_requests = api.get_my_join_requests(users[0]["email"])
    logger.info(f"User 1's join requests: {json.dumps(my_join_requests, indent=2)}")

    # Verify there is at least one join request
    assert (
        len(my_join_requests["join_requests"]) > 0
    ), "No join requests found for User 1"

    # Verify receiver info in join request was updated
    join_request = my_join_requests["join_requests"][0]
    assert (
        join_request["receiver_username"] == user1_update_data["username"]
    ), "Join request receiver username not updated"
    assert (
        join_request["receiver_name"] == user1_update_data["name"]
    ), "Join request receiver name not updated"
    assert (
        join_request["receiver_avatar"] == user1_update_data["avatar"]
    ), "Join request receiver avatar not updated"
    logger.info("✓ Join request receiver profile update verification successful")

    # Test 14: Update User 2's profile and verify changes in join requests
    logger.info(
        "Test 14: Updating User 2's profile and verifying propagation to join requests"
    )

    user2_update_data = {
        "username": "user2_new_username",
        "name": "User 2 New Name",
        "avatar": "https://example.com/new_avatar_user2.jpg",
    }

    # Update User 2's profile
    updated_user2_profile = api.update_profile(users[1]["email"], user2_update_data)
    logger.info(
        f"Updated User 2 profile: {json.dumps(updated_user2_profile, indent=2)}"
    )

    # Wait for update triggers to process
    logger.info(
        f"Waiting {TEST_CONFIG['wait_time']} seconds for profile update triggers to process..."
    )
    time.sleep(TEST_CONFIG["wait_time"])

    # Get join requests made by User 2 to verify requester info was updated
    user2_join_requests = api.get_join_requests(users[1]["email"])
    logger.info(
        f"User 2's outgoing join requests: {json.dumps(user2_join_requests, indent=2)}"
    )

    # Verify there is at least one join request
    assert (
        len(user2_join_requests["join_requests"]) > 0
    ), "No join requests found for User 2"

    # Verify requester info in join request was updated
    join_request = user2_join_requests["join_requests"][0]
    assert (
        join_request["requester_username"] == user2_update_data["username"]
    ), "Join request requester username not updated"
    assert (
        join_request["requester_name"] == user2_update_data["name"]
    ), "Join request requester name not updated"
    assert (
        join_request["requester_avatar"] == user2_update_data["avatar"]
    ), "Join request requester avatar not updated"
    logger.info("✓ Join request requester profile update verification successful")

    # Now accept the join request to create a friendship
    accept_result = api.accept_join_request(
        users[0]["email"], join_request["request_id"]
    )
    logger.info(f"User 1 accepted invitation: {json.dumps(accept_result, indent=2)}")

    # Verify friendship was created
    friends_user1 = api.get_friends(users[0]["email"])
    logger.info(f"First user's friends: {json.dumps(friends_user1, indent=2)}")

    friends_user2 = api.get_friends(users[1]["email"])
    logger.info(f"Second user's friends: {json.dumps(friends_user2, indent=2)}")

    logger.info("Users are now friends")

    # Test 15: Verify profile data in friendships
    logger.info("Test 15: Verifying profile data in friendships")

    # Verify User 1's friend data (User 2) has the updated profile info
    assert len(friends_user1["friends"]) > 0, "No friends found for User 1"
    user2_in_friends = friends_user1["friends"][0]
    assert (
        user2_in_friends["username"] == user2_update_data["username"]
    ), "Friend username mismatch for User 1"
    assert (
        user2_in_friends["name"] == user2_update_data["name"]
    ), "Friend name mismatch for User 1"
    assert (
        user2_in_friends["avatar"] == user2_update_data["avatar"]
    ), "Friend avatar mismatch for User 1"

    # Verify User 2's friend data (User 1) has the updated profile info
    assert len(friends_user2["friends"]) > 0, "No friends found for User 2"
    user1_in_friends = friends_user2["friends"][0]
    assert (
        user1_in_friends["username"] == user1_update_data["username"]
    ), "Friend username mismatch for User 2"
    assert (
        user1_in_friends["name"] == user1_update_data["name"]
    ), "Friend name mismatch for User 2"
    assert (
        user1_in_friends["avatar"] == user1_update_data["avatar"]
    ), "Friend avatar mismatch for User 2"
    logger.info("✓ Friendship profile data verification successful")

    # Test 16: Update profiles again and verify changes propagate to friendships
    logger.info(
        "Test 16: Updating profiles again and verifying propagation to friendships"
    )

    # Update User 1's profile again
    user1_update_data_2 = {
        "username": "user1_final_username",
        "name": "User 1 Final Name",
        "avatar": "https://example.com/final_avatar_user1.jpg",
    }
    updated_user1_profile_2 = api.update_profile(users[0]["email"], user1_update_data_2)
    logger.info(
        f"Updated User 1 profile again: {json.dumps(updated_user1_profile_2, indent=2)}"
    )

    # Update User 2's profile again
    user2_update_data_2 = {
        "username": "user2_final_username",
        "name": "User 2 Final Name",
        "avatar": "https://example.com/final_avatar_user2.jpg",
    }
    updated_user2_profile_2 = api.update_profile(users[1]["email"], user2_update_data_2)
    logger.info(
        f"Updated User 2 profile again: {json.dumps(updated_user2_profile_2, indent=2)}"
    )

    # Wait for update triggers to process
    logger.info(
        f"Waiting {TEST_CONFIG['wait_time']} seconds for profile update triggers to process..."
    )
    time.sleep(TEST_CONFIG["wait_time"])

    # Get friends again to verify updates
    friends_user1_updated = api.get_friends(users[0]["email"])
    logger.info(
        f"First user's updated friends: {json.dumps(friends_user1_updated, indent=2)}"
    )

    friends_user2_updated = api.get_friends(users[1]["email"])
    logger.info(
        f"Second user's updated friends: {json.dumps(friends_user2_updated, indent=2)}"
    )

    # Verify User 1's friend data (User 2) has the updated profile info
    assert (
        len(friends_user1_updated["friends"]) > 0
    ), "No friends found for User 1 after update"
    user2_in_friends_updated = friends_user1_updated["friends"][0]
    assert (
        user2_in_friends_updated["username"] == user2_update_data_2["username"]
    ), "Updated friend username mismatch for User 1"
    assert (
        user2_in_friends_updated["name"] == user2_update_data_2["name"]
    ), "Updated friend name mismatch for User 1"
    assert (
        user2_in_friends_updated["avatar"] == user2_update_data_2["avatar"]
    ), "Updated friend avatar mismatch for User 1"

    # Verify User 2's friend data (User 1) has the updated profile info
    assert (
        len(friends_user2_updated["friends"]) > 0
    ), "No friends found for User 2 after update"
    user1_in_friends_updated = friends_user2_updated["friends"][0]
    assert (
        user1_in_friends_updated["username"] == user1_update_data_2["username"]
    ), "Updated friend username mismatch for User 2"
    assert (
        user1_in_friends_updated["name"] == user1_update_data_2["name"]
    ), "Updated friend name mismatch for User 2"
    assert (
        user1_in_friends_updated["avatar"] == user1_update_data_2["avatar"]
    ), "Updated friend avatar mismatch for User 2"
    logger.info("✓ Friendship profile update verification successful")

    # Test 17: Get user profile after becoming friends
    logger.info("Test 17: Getting user profile after becoming friends")
    user2_profile = api.get_user_profile(
        users[0]["email"], api.user_ids[users[1]["email"]]
    )
    logger.info(f"Retrieved user 2 profile: {json.dumps(user2_profile, indent=2)}")
    assert (
        user2_profile["username"] == user2_update_data_2["username"]
    ), "Username mismatch"
    assert user2_profile["name"] == user2_update_data_2["name"], "Name mismatch"
    assert (
        user2_profile["gender"] == second_user_profile_data["gender"]
    ), "Gender mismatch"
    logger.info("✓ Friend profile access test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_profile_tests()
        logger.info("Profile automation completed successfully")
    except Exception as e:
        logger.error(f"Profile automation failed: {str(e)}")
        raise
