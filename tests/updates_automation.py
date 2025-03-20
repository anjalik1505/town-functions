#!/usr/bin/env python3
"""
Village API Updates Automation Script

This script automates API calls to the Village Firebase emulator for testing updates functionality.
It creates users, authenticates them, and performs various update operations:
- Create updates with different sentiments
- Get user's own updates
- Share updates with friends
- Get updates from friends (feed)
- Test pagination of updates
- Test visibility of updates based on friendship status
"""

import json
import logging
import random

from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Available sentiments for updates
SENTIMENTS = ["happy", "sad", "neutral", "angry", "surprised"]


def run_updates_tests():
    """Run tests for the Village API updates functionality"""
    api = VillageAPI()

    # Create two users
    users = [
        {
            "email": "updates_test1@example.com",
            "password": "password123",
            "name": "Updates Test One",
        },
        {
            "email": "updates_test2@example.com",
            "password": "password123",
            "name": "Updates Test Two",
        },
    ]

    # Create and authenticate users
    for user in users:
        api.create_user(user["email"], user["password"], user["name"])

    # Create profiles for both users
    for i, user in enumerate(users):
        profile_data = {
            "username": user["email"].split("@")[0],
            "name": user["name"],
            "avatar": f"https://example.com/avatar_{user['name'].replace(' ', '_').lower()}.jpg",
            "location": f"City {i+1}",
            "birthday": f"199{i}-01-01",
        }
        api.create_profile(user["email"], profile_data)
        logger.info(f"Created profile for user: {user['email']}")

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Step 1: Create updates for the first user
    logger.info("Step 1: Creating updates for the first user")
    user1_updates = []
    for i in range(5):
        sentiment = random.choice(SENTIMENTS)
        update_data = {
            "content": f"This is update #{i+1} from user 1 with {sentiment} sentiment",
            "sentiment": sentiment,
            "friend_ids": [],  # No friends yet
            "group_ids": [],  # No groups yet
        }
        created_update = api.create_update(users[0]["email"], update_data)
        user1_updates.append(created_update)
        logger.info(
            f"Created update #{i+1} for user 1: {json.dumps(created_update, indent=2)}"
        )

    # Step 2: Get user's own updates
    logger.info("Step 2: Getting user's own updates")
    my_updates = api.get_my_updates(users[0]["email"])
    logger.info(f"Retrieved updates for user 1: {json.dumps(my_updates, indent=2)}")

    # Verify updates were created
    assert "updates" in my_updates, "Response does not contain updates field"
    assert len(my_updates["updates"]) > 0, "No updates found for user 1"
    logger.info(f"✓ User 1 has {len(my_updates['updates'])} updates")

    # Step 3: Create updates for the second user
    logger.info("Step 3: Creating updates for the second user")
    user2_updates = []
    for i in range(3):
        sentiment = random.choice(SENTIMENTS)
        update_data = {
            "content": f"This is update #{i+1} from user 2 with {sentiment} sentiment",
            "sentiment": sentiment,
            "friend_ids": [],  # No friends yet
            "group_ids": [],  # No groups yet
        }
        created_update = api.create_update(users[1]["email"], update_data)
        user2_updates.append(created_update)
        logger.info(
            f"Created update #{i+1} for user 2: {json.dumps(created_update, indent=2)}"
        )

    # Step 4: Try to view another user's updates before becoming friends
    logger.info(
        "Step 4: Attempting to view another user's updates before becoming friends"
    )
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/users/{api.user_ids[users[1]['email']]}/updates",
        headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
        expected_status_code=403,
        expected_error_message="You must be friends with this user",
    )
    logger.info("✓ Non-friend updates access test passed")

    # Step 5: Connect users as friends
    logger.info("Step 5: Connecting users as friends using invitations")
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
    assert len(friends_user1["friends"]) > 0, "No friends found for user 1"
    logger.info("Users are now friends")

    # Step 6: Create updates for the second user that are shared with the first user
    logger.info(
        "Step 6: Creating updates for the second user that are shared with the first user"
    )
    user2_shared_updates = []
    for i in range(3):
        sentiment = random.choice(SENTIMENTS)
        update_data = {
            "content": f"This is update #{i+1} from user 2 shared with user 1, with {sentiment} sentiment",
            "sentiment": sentiment,
            "friend_ids": [api.user_ids[users[0]["email"]]],  # Share with user 1
            "group_ids": [],  # No groups yet
        }
        created_update = api.create_update(users[1]["email"], update_data)
        user2_shared_updates.append(created_update)
        logger.info(
            f"Created shared update #{i+1} for user 2: {json.dumps(created_update, indent=2)}"
        )

    # Step 7: Get user updates after becoming friends
    logger.info("Step 7: Getting user updates after becoming friends")
    user2_updates = api.get_user_updates(
        users[0]["email"], api.user_ids[users[1]["email"]]
    )
    logger.info(f"Retrieved user 2 updates: {json.dumps(user2_updates, indent=2)}")
    assert "updates" in user2_updates, "Response does not contain updates field"
    assert len(user2_updates["updates"]) > 0, "No updates found for user 2"
    logger.info(
        f"✓ User 2 has {len(user2_updates['updates'])} updates visible to user 1"
    )

    # Step 8: Get my feeds to see updates from friends
    logger.info("Step 8: Getting my feeds to see updates from friends")
    user1_feeds = api.get_my_feed(users[0]["email"])
    logger.info(f"Retrieved feeds for user 1: {json.dumps(user1_feeds, indent=2)}")
    assert "updates" in user1_feeds, "Response does not contain updates field"
    # Should include updates from user 2 that were shared with user 1
    assert len(user1_feeds["updates"]) > 0, "No updates found in user 1's feed"
    logger.info(f"✓ User 1's feed contains {len(user1_feeds['updates'])} updates")

    # Step 9: Test pagination for updates
    logger.info("Step 9: Testing pagination for updates")
    # Create more updates to test pagination
    for i in range(5):
        sentiment = random.choice(SENTIMENTS)
        update_data = {
            "content": f"Pagination test update #{i+1} with {sentiment} sentiment",
            "sentiment": sentiment,
            "friend_ids": [api.user_ids[users[1]["email"]]],
            "group_ids": [],
        }
        api.create_update(users[0]["email"], update_data)

    # Get updates with small limit to test pagination
    first_page = api.get_my_updates(users[0]["email"], limit=3)
    logger.info(f"Retrieved first page of updates: {json.dumps(first_page, indent=2)}")

    # Check if the response contains the next_timestamp field for pagination
    assert (
        "next_timestamp" in first_page
    ), "Response does not contain next_timestamp field for pagination"

    # If there's a next_timestamp, try to get the second page
    if first_page["next_timestamp"]:
        # Ensure the timestamp is in ISO format (2025-01-01T12:00:00Z)
        # The API returns timestamps in ISO format but we need to ensure it's properly passed
        next_timestamp = first_page["next_timestamp"]
        logger.info(f"Using next_timestamp for pagination: {next_timestamp}")

        second_page = api.get_my_updates(
            users[0]["email"], limit=3, after_timestamp=next_timestamp
        )
        logger.info(
            f"Retrieved second page of updates: {json.dumps(second_page, indent=2)}"
        )
        assert len(second_page["updates"]) > 0, "No updates found in second page"
        logger.info(f"✓ Second page contains {len(second_page['updates'])} updates")

    logger.info("✓ Update pagination test passed")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Try to create an update with empty sentiment
    logger.info("Test 1: Attempting to create an update with empty sentiment")
    invalid_update_data = {
        "content": "This update has an empty sentiment",
        "sentiment": "",
        "friend_ids": [],
        "group_ids": [],
    }
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=invalid_update_data,
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Empty sentiment test passed")

    # Test 2: Try to create an update with empty content
    logger.info("Test 2: Attempting to create an update with empty content")
    empty_content_data = {
        "content": "",
        "sentiment": "happy",
        "friend_ids": [],
        "group_ids": [],
    }
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data=empty_content_data,
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Empty content test passed")

    # Test 3: Try to create an update without authentication
    logger.info("Test 3: Attempting to create an update without authentication")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates",
        headers={"Content-Type": "application/json"},
        json_data={
            "content": "This update should not be created",
            "sentiment": "happy",
            "friend_ids": [],
            "group_ids": [],
        },
        expected_status_code=401,
    )
    logger.info("✓ Unauthenticated update creation test passed")

    # ============ PROFILE CHECKS AFTER UPDATES ============
    logger.info("========== CHECKING PROFILES AFTER UPDATES ==========")

    # Wait a bit for the Firestore triggers to process the updates
    import time

    logger.info("Waiting for Firestore triggers to process updates...")
    time.sleep(3)  # Wait 3 seconds for processing

    # Retrieve profiles for both users
    logger.info("Retrieving profiles to check for summary and suggestions updates")

    # ===== Test 1: Check user's own profile =====
    logger.info("Testing user's own profile API")
    # Get user 1 profile using the /me/profile endpoint
    user1_own_profile = api.get_profile(users[0]["email"])
    logger.info(
        f"User 1 own profile after updates: {json.dumps(user1_own_profile, indent=2)}"
    )

    # Verify user 1 profile has summary, suggestions, and updated_at fields
    assert (
        "summary" in user1_own_profile
    ), "User 1 profile does not contain summary field"
    assert (
        "suggestions" in user1_own_profile
    ), "User 1 profile does not contain suggestions field"
    assert (
        "updated_at" in user1_own_profile
    ), "User 1 profile does not contain updated_at field"
    logger.info(f"✓ User 1 own profile has been updated with summary and suggestions")

    # Get user 2 profile using the /me/profile endpoint
    user2_own_profile = api.get_profile(users[1]["email"])
    logger.info(
        f"User 2 own profile after updates: {json.dumps(user2_own_profile, indent=2)}"
    )

    # Verify user 2 profile has summary, suggestions, and updated_at fields
    assert (
        "summary" in user2_own_profile
    ), "User 2 profile does not contain summary field"
    assert (
        "suggestions" in user2_own_profile
    ), "User 2 profile does not contain suggestions field"
    assert (
        "updated_at" in user2_own_profile
    ), "User 2 profile does not contain updated_at field"
    logger.info(f"✓ User 2 own profile has been updated with summary and suggestions")

    # ===== Test 2: Check friend's profile =====
    logger.info("Testing friend's profile API")
    # User 1 gets User 2's profile
    user2_profile_from_user1 = api.get_user_profile(
        users[0]["email"], api.user_ids[users[1]["email"]]
    )
    logger.info(
        f"User 2 profile as seen by User 1: {json.dumps(user2_profile_from_user1, indent=2)}"
    )

    # Verify the friend profile has summary, suggestions, and updated_at fields
    assert (
        "summary" in user2_profile_from_user1
    ), "Friend profile does not contain summary field"
    assert (
        "suggestions" in user2_profile_from_user1
    ), "Friend profile does not contain suggestions field"
    assert (
        "updated_at" in user2_profile_from_user1
    ), "Friend profile does not contain updated_at field"
    logger.info(f"✓ Friend profile includes summary, suggestions, and updated_at")

    # User 2 gets User 1's profile
    user1_profile_from_user2 = api.get_user_profile(
        users[1]["email"], api.user_ids[users[0]["email"]]
    )
    logger.info(
        f"User 1 profile as seen by User 2: {json.dumps(user1_profile_from_user2, indent=2)}"
    )

    # Verify the friend profile has summary, suggestions, and updated_at fields
    assert (
        "summary" in user1_profile_from_user2
    ), "Friend profile does not contain summary field"
    assert (
        "suggestions" in user1_profile_from_user2
    ), "Friend profile does not contain suggestions field"
    assert (
        "updated_at" in user1_profile_from_user2
    ), "Friend profile does not contain updated_at field"
    logger.info(f"✓ Friend profile includes summary, suggestions, and updated_at")

    logger.info("Checking for user summaries between the two users")
    # We're now verifying both own profiles and friend profiles were updated correctly

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_updates_tests()
        logger.info("Updates automation completed successfully")
    except Exception as e:
        logger.error(f"Updates automation failed: {str(e)}")
        raise
