#!/usr/bin/env python3
"""
Village API Comments Automation Script

This script automates API calls to the Village Firebase emulator for testing comments functionality.
It creates users, authenticates them, and performs various comment operations:
- Create comments on updates
- Get comments for updates
- Update comments
- Delete comments
- Test pagination of comments
- Test access control for comments
"""

import json
import logging
import time

from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Test configuration
TEST_CONFIG = {
    "initial_comments_count": 2,  # Number of initial comments per user
    "pagination_comments_count": 1,  # Additional comments for pagination test
    "pagination_limit": 1,  # Limit for pagination test
    "wait_time": 5,  # Time to wait between operations
}


def run_comments_tests():
    """Run tests for the Village API comments functionality"""
    api = VillageAPI()

    # Create two users
    users = [
        {
            "email": "comments_test1@example.com",
            "password": "password123",
            "name": "Comments Test One",
        },
        {
            "email": "comments_test2@example.com",
            "password": "password123",
            "name": "Comments Test Two",
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
            "birthday": f"199{i}-01-01",
        }
        api.create_profile(user["email"], profile_data)
        logger.info(f"Created profile for user: {user['email']}")

    # Step 1: Connect users as friends
    logger.info("Step 1: Connecting users as friends using invitations")
    # Create friendship between users
    invitation = api.get_invitation(users[0]["email"])
    logger.info(f"User 1 created invitation: {json.dumps(invitation, indent=2)}")
    invitation_id = invitation["invitation_id"]

    join_request = api.request_to_join(users[1]["email"], invitation_id)
    logger.info(f"User 2 requests to join: {json.dumps(join_request, indent=2)}")

    accept_result = api.accept_join_request(users[0]["email"], join_request["request_id"])
    logger.info(f"User 1 accepted invitation: {json.dumps(accept_result, indent=2)}")

    # Verify friendship was created
    friends_user1 = api.get_friends(users[0]["email"])
    logger.info(f"First user's friends: {json.dumps(friends_user1, indent=2)}")
    assert len(friends_user1["friends"]) > 0, "No friends found for user 1"
    logger.info("Users are now friends")

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Step 2: Create an update for the first user
    logger.info("Step 2: Creating an update for the first user")
    update_data = {
        "content": "This is an update for testing comments",
        "sentiment": "happy",
        "friend_ids": [api.user_ids[users[1]["email"]]],  # Share with user 2
        "group_ids": [],
        "score": 3,
        "emoji": "👍",
    }
    created_update = api.create_update(users[0]["email"], update_data)
    update_id = created_update["update_id"]
    logger.info(f"Created update: {json.dumps(created_update, indent=2)}")

    # Step 3: Create comments from both users
    logger.info("Step 3: Creating comments from both users")
    comments = []

    # User 1 comments
    for i in range(TEST_CONFIG["initial_comments_count"]):
        comment = api.create_comment(
            users[0]["email"], update_id, f"This is comment #{i + 1} from user 1"
        )
        comments.append(comment)
        logger.info(f"Created comment from user 1: {json.dumps(comment, indent=2)}")
        time.sleep(TEST_CONFIG["wait_time"])

    # User 2 comments
    for i in range(TEST_CONFIG["initial_comments_count"]):
        comment = api.create_comment(
            users[1]["email"], update_id, f"This is comment #{i + 1} from user 2"
        )
        comments.append(comment)
        logger.info(f"Created comment from user 2: {json.dumps(comment, indent=2)}")
        time.sleep(TEST_CONFIG["wait_time"])

    # Step 4: Get all comments
    logger.info("Step 4: Getting all comments")
    all_comments = api.get_comments(users[0]["email"], update_id)
    logger.info(f"Retrieved comments: {json.dumps(all_comments, indent=2)}")

    # Verify comments were created
    assert "comments" in all_comments, "Response does not contain comments field"
    assert (
        len(all_comments["comments"]) == TEST_CONFIG["initial_comments_count"] * 2
    ), "Incorrect number of comments"
    logger.info(f"✓ Found {len(all_comments['comments'])} comments")

    # Verify comment data
    for comment in all_comments["comments"]:
        assert "comment_id" in comment, "Comment missing comment_id"
        assert "content" in comment, "Comment missing content"
        assert "created_by" in comment, "Comment missing created_by"
        assert "created_at" in comment, "Comment missing created_at"
        assert "username" in comment, "Comment missing username"
        assert "name" in comment, "Comment missing name"
        assert "avatar" in comment, "Comment missing avatar"
    logger.info("✓ All comments have required fields")

    # Step 5: Test pagination
    logger.info("Step 5: Testing comment pagination")

    # Create additional comments for pagination testing
    for i in range(TEST_CONFIG["pagination_comments_count"]):
        comment = api.create_comment(
            users[0]["email"], update_id, f"Pagination test comment #{i + 1}"
        )
        comments.append(comment)
        logger.info(
            f"Created additional comment for pagination: {json.dumps(comment, indent=2)}"
        )
        time.sleep(TEST_CONFIG["wait_time"])

    # Test pagination
    first_page = api.get_comments(
        users[0]["email"], update_id, limit=TEST_CONFIG["pagination_limit"]
    )
    logger.info(f"First page of comments: {json.dumps(first_page, indent=2)}")

    assert "next_cursor" in first_page, "Response missing next_cursor"
    assert (
        len(first_page["comments"]) == TEST_CONFIG["pagination_limit"]
    ), "Incorrect number of comments in first page"

    if first_page["next_cursor"]:
        second_page = api.get_comments(
            users[0]["email"],
            update_id,
            limit=TEST_CONFIG["pagination_limit"],
            after_cursor=first_page["next_cursor"],
        )
        logger.info(f"Second page of comments: {json.dumps(second_page, indent=2)}")
        assert len(second_page["comments"]) > 0, "No comments in second page"
    logger.info("✓ Comment pagination test passed")

    # Step 5.1: Test get_update endpoint with pagination
    logger.info("Step 5.1: Testing get_update endpoint with pagination")
    first_update = api.get_update(
        users[0]["email"], update_id, limit=TEST_CONFIG["pagination_limit"]
    )
    logger.info(
        f"First page of update with comments: {json.dumps(first_update, indent=2)}"
    )

    # Verify the response structure
    assert "update" in first_update, "Response missing update field"
    assert "comments" in first_update, "Response missing comments field"
    assert "next_cursor" in first_update, "Response missing next_cursor field"
    assert first_update["update"]["update_id"] == update_id, "Wrong update returned"
    assert (
        len(first_update["comments"]) == TEST_CONFIG["pagination_limit"]
    ), "Incorrect number of comments in first page"

    # Test pagination with get_update
    if first_update["next_cursor"]:
        second_update = api.get_update(
            users[0]["email"],
            update_id,
            limit=TEST_CONFIG["pagination_limit"],
            after_cursor=first_update["next_cursor"],
        )
        logger.info(
            f"Second page of update with comments: {json.dumps(second_update, indent=2)}"
        )
        assert len(second_update["comments"]) > 0, "No comments in second page"
    logger.info("✓ Get update with pagination test passed")

    # Step 5.2: Test pagination using get_update followed by get_comments
    logger.info(
        "Step 5.2: Testing pagination using get_update followed by get_comments"
    )
    if first_update["next_cursor"]:
        follow_up_comments = api.get_comments(
            users[0]["email"],
            update_id,
            limit=TEST_CONFIG["pagination_limit"],
            after_cursor=first_update["next_cursor"],
        )
        logger.info(f"Follow-up comments: {json.dumps(follow_up_comments, indent=2)}")
        assert len(follow_up_comments["comments"]) > 0, "No comments in follow-up page"
        logger.info("✓ Follow-up pagination test passed")

    # Step 6: Update a comment
    logger.info("Step 6: Updating a comment")
    comment_to_update = comments[0]
    updated_content = "This comment has been updated"
    updated_comment = api.update_comment(
        users[0]["email"], update_id, comment_to_update["comment_id"], updated_content
    )
    logger.info(f"Updated comment: {json.dumps(updated_comment, indent=2)}")

    assert updated_comment["content"] == updated_content, "Comment content not updated"
    assert (
        updated_comment["comment_id"] == comment_to_update["comment_id"]
    ), "Wrong comment updated"
    logger.info("✓ Comment update test passed")

    # Step 7: Delete a comment
    logger.info("Step 7: Deleting a comment")
    comment_to_delete = comments[1]
    api.delete_comment(users[0]["email"], update_id, comment_to_delete["comment_id"])

    # Verify comment was deleted
    remaining_comments = api.get_comments(users[0]["email"], update_id)
    comment_ids = [c["comment_id"] for c in remaining_comments["comments"]]
    assert comment_to_delete["comment_id"] not in comment_ids, "Comment was not deleted"
    logger.info("✓ Comment deletion test passed")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Try to create an empty comment
    logger.info("Test 1: Attempting to create an empty comment")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/{update_id}/comments",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data={"content": ""},
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Empty comment test passed")

    # Test 2: Try to update another user's comment
    logger.info("Test 2: Attempting to update another user's comment")
    user2_comment = next(
        c for c in comments if c["created_by"] == api.user_ids[users[1]["email"]]
    )
    api.make_request_expecting_error(
        "put",
        f"{API_BASE_URL}/updates/{update_id}/comments/{user2_comment['comment_id']}",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data={"content": "This should fail"},
        expected_status_code=403,
        expected_error_message="You can only update your own comments",
    )
    logger.info("✓ Update other user's comment test passed")

    # Test 3: Try to delete another user's comment
    logger.info("Test 3: Attempting to delete another user's comment")
    api.make_request_expecting_error(
        "delete",
        f"{API_BASE_URL}/updates/{update_id}/comments/{user2_comment['comment_id']}",
        headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
        expected_status_code=403,
        expected_error_message="You can only delete your own comments",
    )
    logger.info("✓ Delete other user's comment test passed")

    # Test 4: Try to get comments without authentication
    logger.info("Test 4: Attempting to get comments without authentication")
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/updates/{update_id}/comments",
        headers={},
        expected_status_code=401,
    )
    logger.info("✓ Unauthenticated comment access test passed")

    # ============ REACTION TESTS ============
    logger.info("========== STARTING REACTION TESTS ==========")

    # Step 1: Create reactions from both users
    logger.info("Step 1: Creating reactions from both users")
    reactions = []

    # User 1 reactions
    reaction1 = api.create_reaction(users[0]["email"], update_id, "like")
    reactions.append(reaction1)
    logger.info(f"Created reaction from user 1: {json.dumps(reaction1, indent=2)}")
    time.sleep(TEST_CONFIG["wait_time"])

    # User 2 reactions
    reaction2 = api.create_reaction(users[1]["email"], update_id, "love")
    reactions.append(reaction2)
    logger.info(f"Created reaction from user 2: {json.dumps(reaction2, indent=2)}")
    time.sleep(TEST_CONFIG["wait_time"])

    # Verify reactions in update response
    update_response = api.get_my_updates(users[0]["email"])
    update = next(u for u in update_response["updates"] if u["update_id"] == update_id)
    assert len(update["reactions"]) == 2, "Incorrect number of reactions"
    assert update["reaction_count"] == 2, "Incorrect reaction count"
    logger.info("✓ Reactions verified in update response")

    # ============ REACTION NEGATIVE PATH TESTS ============
    logger.info("========== STARTING REACTION NEGATIVE PATH TESTS ==========")

    # Test 1: Try to create an empty reaction type
    logger.info("Test 1: Attempting to create an empty reaction type")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/{update_id}/reactions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data={"type": ""},
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Empty reaction type test passed")

    # Test 2: Try to delete another user's reaction
    logger.info("Test 2: Attempting to delete another user's reaction")
    # Use the reaction ID from when user2 created their reaction
    user2_reaction_id = reaction2["reaction_id"]
    api.make_request_expecting_error(
        "delete",
        f"{API_BASE_URL}/updates/{update_id}/reactions/{user2_reaction_id}",
        headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
        expected_status_code=403,
        expected_error_message="You can only delete your own reactions",
    )
    logger.info("✓ Delete other user's reaction test passed")

    # Test 3: Try to create a reaction without authentication
    logger.info("Test 3: Attempting to create a reaction without authentication")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/{update_id}/reactions",
        headers={},
        json_data={"type": "like"},
        expected_status_code=401,
    )
    logger.info("✓ Unauthenticated reaction creation test passed")

    # Test 4: Try to create a duplicate reaction
    logger.info("Test 4: Attempting to create a duplicate reaction")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/{update_id}/reactions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data={"type": "like"},
        expected_status_code=400,
        expected_error_message="You have already reacted to this update",
    )
    logger.info("✓ Duplicate reaction test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_comments_tests()
    except Exception as e:
        logger.error(f"Error running tests: {e}")
        raise
