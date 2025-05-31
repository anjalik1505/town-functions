#!/usr/bin/env python3
"""
Village API Invitation Automation Script

This script automates API calls to the Village Firebase emulator for testing the new
persistent invitation and join request functionality.
It creates users, authenticates them, and performs various invitation and join request operations.
"""

import json
import logging
import os

from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

os.environ["FIRESTORE_EMULATOR_HOST"] = "localhost:8080"


def run_invitation_demo():
    """Run a demonstration of the Village API invitation and join request functionality"""
    api = VillageAPI()

    # Create three users
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
    ]

    # Create and authenticate users
    for user in users:
        api.create_user(user["email"], user["password"], user["name"])

    # ============ PERSISTENT INVITATION AND JOIN REQUEST TESTS ============

    # Step 1: Create profiles for all users
    for i, user in enumerate(users):
        profile_data = {
            "username": user["email"].split("@")[0],
            "name": user["name"],
            "avatar": f"https://example.com/avatar_{user['name'].replace(' ', '_').lower()}.jpg",
            "birthday": f"199{i}-01-01",
        }
        api.create_profile(user["email"], profile_data)
        logger.info(f"Created profile for {user['name']}")

    # Step 2: First user gets their invitation link
    logger.info("Step 2: First user gets their invitation link")
    invitation = api.get_invitation(users[0]["email"])
    logger.info(f"First user's invitation: {json.dumps(invitation, indent=2)}")
    invitation_id = invitation["invitation_id"]

    # Step 3: Second user requests to join using the invitation link
    logger.info("Step 3: Second user requests to join using the invitation link")
    join_request = api.request_to_join(users[1]["email"], invitation_id)
    logger.info(f"Second user's join request: {json.dumps(join_request, indent=2)}")

    # Step 4: First user gets their join requests
    logger.info("Step 4: First user gets their join requests")
    my_join_requests = api.get_my_join_requests(users[0]["email"])
    logger.info(f"First user's join requests: {json.dumps(my_join_requests, indent=2)}")

    # Step 5: Second user gets their join requests
    logger.info("Step 5: Second user gets their join requests")
    join_requests = api.get_join_requests(users[1]["email"])
    logger.info(f"Second user's join requests: {json.dumps(join_requests, indent=2)}")

    # Step 6: First user gets a specific join request
    logger.info("Step 6: First user gets a specific join request")
    request_id = my_join_requests["join_requests"][0]["request_id"]
    specific_request = api.get_join_request(users[0]["email"], request_id)
    logger.info(f"Specific join request: {json.dumps(specific_request, indent=2)}")

    # Step 7: First user accepts the join request
    logger.info("Step 7: First user accepts the join request")
    accept_result = api.accept_join_request(users[0]["email"], request_id)
    logger.info(f"Accept join request result: {json.dumps(accept_result, indent=2)}")

    # Step 8: Both users get their friends to confirm they are friends
    logger.info("Step 8: Both users get their friends to confirm they are friends")
    friends_user1 = api.get_friends(users[0]["email"])
    logger.info(f"First user's friends: {json.dumps(friends_user1, indent=2)}")

    friends_user2 = api.get_friends(users[1]["email"])
    logger.info(f"Second user's friends: {json.dumps(friends_user2, indent=2)}")

    # Verify that users are friends
    user1_has_user2 = any(friend["name"] == users[1]["name"] for friend in friends_user1["friends"])
    user2_has_user1 = any(friend["name"] == users[0]["name"] for friend in friends_user2["friends"])

    assert (user1_has_user2 and user2_has_user1), "User 1 and User 2 are not friends as expected"

    # Step 9: Third user requests to join
    logger.info("Step 9: Third user requests to join")
    join_request3 = api.request_to_join(users[2]["email"], invitation_id)
    logger.info(f"Third user's join request: {json.dumps(join_request3, indent=2)}")

    # Step 10: First user gets their join requests again
    logger.info("Step 10: First user gets their join requests again")
    my_join_requests2 = api.get_my_join_requests(users[0]["email"])
    logger.info(f"First user's join requests: {json.dumps(my_join_requests2, indent=2)}")

    # Step 11: First user rejects the third user's join request
    logger.info("Step 11: First user rejects the third user's join request")
    request_id3 = my_join_requests2["join_requests"][0]["request_id"]
    reject_result = api.reject_join_request(users[0]["email"], request_id3)
    logger.info(f"Reject join request result: {json.dumps(reject_result, indent=2)}")

    # Step 12: First user gets their join requests to check for the rejected request
    logger.info("Step 12: First user gets their join requests to check for the rejected request")
    my_join_requests3 = api.get_my_join_requests(users[0]["email"])
    logger.info(f"First user's join requests after rejection: {json.dumps(my_join_requests3, indent=2)}")

    # Step 13: Third user gets their join requests to check for the rejected request
    logger.info("Step 13: Third user gets their join requests to check for the rejected request")
    join_requests3 = api.get_join_requests(users[2]["email"])
    logger.info(f"Third user's join requests after rejection: {json.dumps(join_requests3, indent=2)}")

    # Step 14: First user resets their invitation link
    logger.info("Step 14: First user resets their invitation link")
    reset_result = api.reset_invitation(users[0]["email"])
    logger.info(f"Reset invitation result: {json.dumps(reset_result, indent=2)}")
    new_invitation_id = reset_result["invitation_id"]

    # Step 15: First user gets their join requests after reset
    logger.info("Step 15: First user gets their join requests after reset")
    my_join_requests4 = api.get_my_join_requests(users[0]["email"])
    logger.info(f"First user's join requests after reset: {json.dumps(my_join_requests4, indent=2)}")

    # Step 16: Third user gets their join requests after reset
    logger.info("Step 16: Third user gets their join requests after reset")
    join_requests4 = api.get_join_requests(users[2]["email"])
    logger.info(f"Third user's join requests after reset: {json.dumps(join_requests4, indent=2)}")

    # Step 17: User 1 and User 2 check they are still friends after invitation reset
    logger.info("Step 17: User 1 and User 2 check they are still friends after invitation reset")
    friends_user1_after = api.get_friends(users[0]["email"])
    logger.info(f"First user's friends after reset: {json.dumps(friends_user1_after, indent=2)}")

    friends_user2_after = api.get_friends(users[1]["email"])
    logger.info(f"Second user's friends after reset: {json.dumps(friends_user2_after, indent=2)}")

    # Verify that users are still friends
    user1_has_user2_after = any(friend["name"] == users[1]["name"] for friend in friends_user1_after["friends"])
    user2_has_user1_after = any(friend["name"] == users[0]["name"] for friend in friends_user2_after["friends"])

    assert (
                user1_has_user2_after and user2_has_user1_after), "User 1 and User 2 are not friends after invitation reset as expected"

    # ============ ERROR HANDLING TESTS ============

    # Test invalid join request (non-existent invitation)
    logger.info("Testing invalid join request (non-existent invitation)")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitation/non-existent-id/join",
        headers={"Authorization": f"Bearer {api.tokens[users[2]['email']]}"},
        expected_status_code=404,
        expected_error_message="Invitation not found",
    )
    logger.info(" Invalid join request test passed")

    # Test invalid pagination parameters
    logger.info("Testing invalid pagination parameters")
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/me/requests?limit=101",  # Test limit > 100
        headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
        expected_status_code=400,
        expected_error_message="Invalid request parameters",
    )
    logger.info(" Invalid pagination parameters test passed")

    # Test unauthorized access to join request
    logger.info("Testing unauthorized access to join request")
    if my_join_requests3["join_requests"]:
        some_request_id = my_join_requests3["join_requests"][0]["request_id"]
        api.make_request_expecting_error(
            "get",
            f"{API_BASE_URL}/me/requests/{some_request_id}",
            headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
            expected_status_code=404,
            expected_error_message="Join request not found",
        )
        logger.info(" Unauthorized access test passed")

    logger.info("All invitation and join request tests completed successfully!")


if __name__ == "__main__":
    try:
        run_invitation_demo()
    except Exception as e:
        logger.error(f"Error running invitation demo: {e}")
    finally:
        logger.info("Invitation demo completed")
