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
import time

from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Available sentiments for updates
SENTIMENTS = ["happy", "sad", "neutral", "angry", "surprised"]

# Available scores and emojis for updates
SCORES = [1, 2, 3, 4, 5]
EMOJIS = ["😢", "😕", "😐", "🙂", "😊"]

# Test configuration
TEST_CONFIG = {
    "initial_updates_count": 3,  # Number of initial updates per user
    "shared_updates_count": 1,  # Number of updates shared with friends
    "pagination_updates_count": 0,  # No additional updates needed
    "pagination_limit": 2,  # Limit for pagination test
    "wait_time": 10,  # Time to wait for Firestore triggers and AI processing
}


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
            "location": f"City {i + 1}",
            "birthday": f"199{i}-01-01",
        }
        api.create_profile(user["email"], profile_data)
        logger.info(f"Created profile for user: {user['email']}")

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Step 1: Create updates for the first user
    logger.info("Step 1: Creating updates for the first user")
    user1_updates = []
    for i in range(TEST_CONFIG["initial_updates_count"]):
        sentiment = random.choice(SENTIMENTS)
        score = random.choice(SCORES)
        emoji = random.choice(EMOJIS)
        update_data = {
            "content": f"This is update #{i + 1} from user 1 with {sentiment} sentiment",
            "sentiment": sentiment,
            "score": score,
            "emoji": emoji,
            "friend_ids": [],  # No friends yet
            "group_ids": [],  # No groups yet
            "all_village": False if i == 0 else True,
        }
        created_update = api.create_update(users[0]["email"], update_data)
        user1_updates.append(created_update)
        logger.info(
            f"Created update #{i + 1} for user 1: {json.dumps(created_update, indent=2)}"
        )

        # Verify all_village field is present and has the correct value
        assert "score" in created_update, "Update missing score field"
        assert "emoji" in created_update, "Update missing emoji field"
        assert isinstance(
            created_update["score"], int
        ), f"Score should be a number, got {type(created_update['score'])}"
        assert (
                1 <= created_update["score"] <= 5
        ), f"Score should be between 1 and 5, got {created_update['score']}"
        assert created_update["emoji"] in EMOJIS, f"Invalid emoji value: {created_update['emoji']}"
        assert "all_village" in created_update, "Update missing all_village field"
        assert created_update["all_village"] is True, "all_village should be True"
        logger.info("✓ all_village field is present and set to True in the response")

    # Step 2: Get user's own updates
    logger.info("Step 2: Getting user's own updates")
    my_updates = api.get_my_updates(users[0]["email"])
    logger.info(f"Retrieved updates for user 1: {json.dumps(my_updates, indent=2)}")

    # Verify updates were created
    assert "updates" in my_updates, "Response does not contain updates field"
    assert len(my_updates["updates"]) > 0, "No updates found for user 1"
    logger.info(f"✓ User 1 has {len(my_updates['updates'])} updates")

    # Verify score and emoji fields are present
    for update in my_updates["updates"]:
        assert "score" in update, "Update missing score field"
        assert "emoji" in update, "Update missing emoji field"
        assert isinstance(
            update["score"], int
        ), f"Score should be a number, got {type(update['score'])}"
        assert (
                1 <= update["score"] <= 5
        ), f"Score should be between 1 and 5, got {update['score']}"
        assert update["emoji"] in EMOJIS, f"Invalid emoji value: {update['emoji']}"
    logger.info("✓ Updates contain valid score and emoji fields")

    # Step 3: Create updates for the second user
    logger.info("Step 3: Creating updates for the second user")
    user2_updates = []
    for i in range(TEST_CONFIG["initial_updates_count"]):
        sentiment = random.choice(SENTIMENTS)
        score = random.choice(SCORES)
        emoji = random.choice(EMOJIS)
        update_data = {
            "content": f"This is update #{i + 1} from user 2 with {sentiment} sentiment",
            "sentiment": sentiment,
            "score": score,
            "emoji": emoji,
            "friend_ids": [],  # No friends yet
            "group_ids": [],  # No groups yet
            "all_village": True,
        }
        created_update = api.create_update(users[1]["email"], update_data)
        user2_updates.append(created_update)
        logger.info(
            f"Created update #{i + 1} for user 2: {json.dumps(created_update, indent=2)}"
        )

        # Verify all_village field is present and has the correct value
        assert "all_village" in created_update, "Update missing all_village field"
        assert created_update["all_village"] is True, "all_village should be True"
        logger.info("✓ all_village field is present and set to True in the response")

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
    invitation = api.create_invitation(users[0]["email"], users[1]["name"])
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
    for i in range(TEST_CONFIG["shared_updates_count"]):
        sentiment = random.choice(SENTIMENTS)
        score = random.choice(SCORES)
        emoji = random.choice(EMOJIS)
        update_data = {
            "content": f"This is update #{i + 1} from user 2 shared with user 1, with {sentiment} sentiment",
            "sentiment": sentiment,
            "score": score,
            "emoji": emoji,
            "friend_ids": [api.user_ids[users[0]["email"]]],  # Share with user 1
            "group_ids": [],  # No groups yet
        }
        created_update = api.create_update(users[1]["email"], update_data)
        user2_shared_updates.append(created_update)
        logger.info(
            f"Created shared update #{i + 1} for user 2: {json.dumps(created_update, indent=2)}"
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

    # Verify that user's own updates appear in their feed
    user1_own_updates = [
        update
        for update in user1_feeds["updates"]
        if update["created_by"] == api.user_ids[users[0]["email"]]
    ]
    assert len(user1_own_updates) > 0, "User's own updates not found in their feed"
    logger.info(
        f"✓ User 1's feed contains {len(user1_own_updates)} of their own updates"
    )

    # Verify enriched profile data in user's own updates
    for update in user1_own_updates:
        assert "username" in update, "Update missing username field"
        assert "name" in update, "Update missing name field"
        assert "avatar" in update, "Update missing avatar field"
        assert "score" in update, "Update missing score field"
        assert "emoji" in update, "Update missing emoji field"
        assert "all_village" in update, "Update missing all_village field"
        assert (
                update["username"] == users[0]["email"].split("@")[0]
        ), "Incorrect username in update"
        assert update["name"] == users[0]["name"], "Incorrect name in update"
        assert (
                update["avatar"]
                == f"https://example.com/avatar_{users[0]['name'].replace(' ', '_').lower()}.jpg"
        ), "Incorrect avatar in update"
        assert isinstance(
            update["score"], int
        ), f"Score should be a number, got {type(update['score'])}"
        assert (
                1 <= update["score"] <= 5
        ), f"Score should be between 1 and 5, got {update['score']}"
        assert update["emoji"] in EMOJIS, f"Invalid emoji value: {update['emoji']}"
        assert isinstance(update["all_village"],
                          bool), f"all_village should be a boolean, got {type(update['all_village'])}"
    logger.info("✓ User's own updates contain correct enriched profile data")

    # Verify that friend's updates appear in the feed
    user2_updates = [
        update
        for update in user1_feeds["updates"]
        if update["created_by"] == api.user_ids[users[1]["email"]]
    ]
    assert len(user2_updates) > 0, "Friend's updates not found in the feed"
    logger.info(
        f"✓ User 1's feed contains {len(user2_updates)} updates from their friend"
    )

    # Verify enriched profile data in friend's updates
    for update in user2_updates:
        assert "username" in update, "Update missing username field"
        assert "name" in update, "Update missing name field"
        assert "avatar" in update, "Update missing avatar field"
        assert "score" in update, "Update missing score field"
        assert "emoji" in update, "Update missing emoji field"
        assert "all_village" in update, "Update missing all_village field"
        assert (
                update["username"] == users[1]["email"].split("@")[0]
        ), "Incorrect username in update"
        assert update["name"] == users[1]["name"], "Incorrect name in update"
        assert (
                update["avatar"]
                == f"https://example.com/avatar_{users[1]['name'].replace(' ', '_').lower()}.jpg"
        ), "Incorrect avatar in update"
        assert isinstance(
            update["score"], int
        ), f"Score should be a number, got {type(update['score'])}"
        assert (
                1 <= update["score"] <= 5
        ), f"Score should be between 1 and 5, got {update['score']}"
        assert update["emoji"] in EMOJIS, f"Invalid emoji value: {update['emoji']}"
        assert isinstance(update["all_village"],
                          bool), f"all_village should be a boolean, got {type(update['all_village'])}"

    # Find the all_village update in the feed
    all_village_updates = [update for update in user2_updates if update.get("all_village") is True]
    assert len(all_village_updates) > 0, "No updates with all_village=True found in the feed"
    logger.info(f"✓ Found {len(all_village_updates)} updates with all_village=True in the feed")

    logger.info("✓ Friend's updates contain correct enriched profile data")

    logger.info(f"✓ User 1's feed contains {len(user1_feeds['updates'])} total updates")

    # Step 9: Test pagination for updates
    logger.info("Step 9: Testing pagination for all update endpoints")

    # Get total updates for user 1
    all_updates = api.get_my_updates(users[0]["email"])
    total_updates = len(all_updates["updates"])
    logger.info(f"User 1 has {total_updates} total updates")

    # Verify we have exactly 3 updates (initial_updates_count)
    expected_updates = TEST_CONFIG["initial_updates_count"]
    assert (
            total_updates == expected_updates
    ), f"Expected {expected_updates} updates, got {total_updates}"

    # Test pagination for /me/updates
    logger.info("Testing pagination for /me/updates")
    first_page = api.get_my_updates(
        users[0]["email"], limit=TEST_CONFIG["pagination_limit"]
    )
    logger.info(
        f"Retrieved first page of /me/updates: {json.dumps(first_page, indent=2)}"
    )
    assert (
            "next_cursor" in first_page
    ), "Response does not contain next_cursor field for pagination"
    assert (
            len(first_page["updates"]) == TEST_CONFIG["pagination_limit"]
    ), f"First page should have {TEST_CONFIG['pagination_limit']} items, got {len(first_page['updates'])}"

    if first_page["next_cursor"]:
        # Store first page updates for comparison
        first_page_updates = first_page["updates"]
        first_page_timestamps = [update["created_at"] for update in first_page_updates]

        # Verify first page timestamps are in descending order
        assert first_page_timestamps == sorted(
            first_page_timestamps, reverse=True
        ), "First page updates are not in descending order by timestamp"

        # Get second page
        second_page = api.get_my_updates(
            users[0]["email"],
            limit=TEST_CONFIG["pagination_limit"],
            after_cursor=first_page["next_cursor"],
        )
        logger.info(
            f"Retrieved second page of /me/updates: {json.dumps(second_page, indent=2)}"
        )

        # Store second page updates for comparison
        second_page_updates = second_page["updates"]
        second_page_timestamps = [
            update["created_at"] for update in second_page_updates
        ]

        # Verify second page has exactly 1 item (3 total - 2 on first page)
        expected_second_page_items = expected_updates - TEST_CONFIG["pagination_limit"]
        assert (
                len(second_page_updates) == expected_second_page_items
        ), f"Second page should have {expected_second_page_items} item, got {len(second_page_updates)}"

        # Verify second page timestamps are in descending order
        assert second_page_timestamps == sorted(
            second_page_timestamps, reverse=True
        ), "Second page updates are not in descending order by timestamp"

        # Verify no duplicates between pages
        first_page_ids = {update["update_id"] for update in first_page_updates}
        second_page_ids = {update["update_id"] for update in second_page_updates}
        assert not (
                first_page_ids & second_page_ids
        ), "Found duplicate updates between pages"

        # Verify second page updates are older than first page updates
        if second_page_timestamps and first_page_timestamps:
            newest_second_page = second_page_timestamps[0]
            oldest_first_page = first_page_timestamps[-1]
            assert (
                    newest_second_page < oldest_first_page
            ), "Second page updates are not older than first page updates"

        # Verify all updates were retrieved
        all_retrieved_ids = first_page_ids | second_page_ids
        all_update_ids = {update["update_id"] for update in all_updates["updates"]}
        assert (
                all_retrieved_ids == all_update_ids
        ), "Did not retrieve all updates across pages"

        logger.info(f"✓ /me/updates pagination test passed")

    # Test pagination for /me/feed
    logger.info("Testing pagination for /me/feed")

    # Get total feed items
    all_feed = api.get_my_feed(users[0]["email"])
    total_feed_items = len(all_feed["updates"])
    logger.info(f"User 1 has {total_feed_items} total feed items")

    # Verify we have exactly 4 feed items (3 own updates + 1 shared update)
    expected_feed_items = (
            TEST_CONFIG["initial_updates_count"] + TEST_CONFIG["initial_updates_count"] + TEST_CONFIG[
        "shared_updates_count"]
    )
    assert (
            total_feed_items == expected_feed_items
    ), f"Expected {expected_feed_items} feed items, got {total_feed_items}"

    # Test with a limit of 2
    first_page_feed = api.get_my_feed(
        users[0]["email"], limit=TEST_CONFIG["pagination_limit"]
    )
    logger.info(
        f"Retrieved first page of /me/feed with limit {TEST_CONFIG['pagination_limit']}: {json.dumps(first_page_feed, indent=2)}"
    )
    assert (
            "next_cursor" in first_page_feed
    ), "Response does not contain next_cursor field for feed pagination"
    assert (
            len(first_page_feed["updates"]) == TEST_CONFIG["pagination_limit"]
    ), f"Expected {TEST_CONFIG['pagination_limit']} updates in first page, got {len(first_page_feed['updates'])}"
    assert (
            first_page_feed["next_cursor"] is not None
    ), "next_cursor should not be null when we have more updates than the limit"

    if first_page_feed["next_cursor"]:
        # Store first page updates for comparison
        first_page_updates = first_page_feed["updates"]
        first_page_timestamps = [update["created_at"] for update in first_page_updates]

        # Verify first page timestamps are in descending order
        assert first_page_timestamps == sorted(
            first_page_timestamps, reverse=True
        ), "First page feed updates are not in descending order by timestamp"

        # Get second page
        second_page_feed = api.get_my_feed(
            users[0]["email"],
            after_cursor=first_page_feed["next_cursor"],
        )
        logger.info(
            f"Retrieved second page of /me/feed: {json.dumps(second_page_feed, indent=2)}"
        )

        # Store second page updates for comparison
        second_page_updates = second_page_feed["updates"]
        second_page_timestamps = [
            update["created_at"] for update in second_page_updates
        ]

        # Verify second page has exactly 5 items (7 total - 2 on first page)
        expected_second_page_items = (
                expected_feed_items - TEST_CONFIG["pagination_limit"]
        )
        assert (
                len(second_page_updates) == expected_second_page_items
        ), f"Second page should have {expected_second_page_items} items, got {len(second_page_updates)}"

        # Verify second page timestamps are in descending order
        assert second_page_timestamps == sorted(
            second_page_timestamps, reverse=True
        ), "Second page feed updates are not in descending order by timestamp"

        # Verify no duplicates between pages
        first_page_ids = {update["update_id"] for update in first_page_updates}
        second_page_ids = {update["update_id"] for update in second_page_updates}
        assert not (
                first_page_ids & second_page_ids
        ), "Found duplicate updates between feed pages"

        # Verify second page updates are older than first page updates
        if second_page_timestamps and first_page_timestamps:
            newest_second_page = second_page_timestamps[0]
            oldest_first_page = first_page_timestamps[-1]
            assert (
                    newest_second_page < oldest_first_page
            ), "Second page feed updates are not older than first page updates"

        # Verify all feed items were retrieved
        all_retrieved_ids = first_page_ids | second_page_ids
        all_feed_ids = {update["update_id"] for update in all_feed["updates"]}
        assert (
                all_retrieved_ids == all_feed_ids
        ), "Did not retrieve all feed items across pages"

        logger.info(f"✓ /me/feed pagination test passed")

    # Test pagination for /users/{user_id}/updates
    logger.info("Testing pagination for /users/{user_id}/updates")
    first_page_user = api.get_user_updates(
        users[0]["email"],
        api.user_ids[users[1]["email"]],
        limit=TEST_CONFIG["pagination_limit"],
    )
    logger.info(
        f"Retrieved first page of user updates: {json.dumps(first_page_user, indent=2)}"
    )
    assert (
            "next_cursor" in first_page_user
    ), "Response does not contain next_cursor field for user updates pagination"

    if first_page_user["next_cursor"]:
        # Store first page updates for comparison
        first_page_updates = first_page_user["updates"]
        first_page_timestamps = [update["created_at"] for update in first_page_updates]

        # Verify first page timestamps are in descending order
        assert first_page_timestamps == sorted(
            first_page_timestamps, reverse=True
        ), "First page user updates are not in descending order by timestamp"

        # Get second page
        second_page_user = api.get_user_updates(
            users[0]["email"],
            api.user_ids[users[1]["email"]],
            limit=TEST_CONFIG["pagination_limit"],
            after_cursor=first_page_user["next_cursor"],
        )
        logger.info(
            f"Retrieved second page of user updates: {json.dumps(second_page_user, indent=2)}"
        )

        # Store second page updates for comparison
        second_page_updates = second_page_user["updates"]
        second_page_timestamps = [
            update["created_at"] for update in second_page_updates
        ]

        # Verify second page timestamps are in descending order
        assert second_page_timestamps == sorted(
            second_page_timestamps, reverse=True
        ), "Second page user updates are not in descending order by timestamp"

        # Verify no duplicates between pages
        first_page_ids = {update["update_id"] for update in first_page_updates}
        second_page_ids = {update["update_id"] for update in second_page_updates}
        assert not (
                first_page_ids & second_page_ids
        ), "Found duplicate updates between user update pages"

        # Verify second page updates are older than first page updates
        if second_page_timestamps and first_page_timestamps:
            newest_second_page = second_page_timestamps[0]
            oldest_first_page = first_page_timestamps[-1]
            assert (
                    newest_second_page < oldest_first_page
            ), "Second page user updates are not older than first page updates"

        logger.info("✓ /users/{user_id}/updates pagination test passed")

    logger.info("✓ All pagination tests completed successfully")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Try to create an update with empty sentiment
    logger.info("Test 1: Attempting to create an update with empty sentiment")
    invalid_update_data = {
        "content": "This update has an empty sentiment",
        "sentiment": "",
        "score": 3,
        "emoji": "😐",
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
        "score": 3,
        "emoji": "😐",
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
            "score": 3,
            "emoji": "😐",
            "friend_ids": [],
            "group_ids": [],
        },
        expected_status_code=401,
    )
    logger.info("✓ Unauthenticated update creation test passed")

    # ============ PROFILE CHECKS AFTER UPDATES ============
    logger.info("========== CHECKING PROFILES AFTER UPDATES ==========")

    # Wait a bit for the Firestore triggers to process the updates
    logger.info(
        f"Waiting {TEST_CONFIG['wait_time']} seconds for Firestore triggers to process updates..."
    )
    time.sleep(TEST_CONFIG["wait_time"])

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
    except Exception as e:
        logger.error(f"Error running tests: {e}")
        raise
