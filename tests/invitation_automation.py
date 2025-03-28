#!/usr/bin/env python3
"""
Village API Invitation Automation Script

This script automates API calls to the Village Firebase emulator for testing invitation functionality.
It creates users, authenticates them, and performs various invitation operations.
"""

import json
import logging

from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


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
        api.create_user(user["email"], user["password"], user["name"])

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

    # Step 8.1: Create additional invitations for pagination test
    logger.info("Step 8.1: Creating additional invitations for pagination test")
    invitation3 = api.create_invitation(users[1]["email"])
    invitation4 = api.create_invitation(users[1]["email"])
    logger.info("Created two additional invitations")

    # Step 9: Second user gets their invitations
    invitations2 = api.get_invitations(users[1]["email"])
    logger.info(f"Second user's invitations: {json.dumps(invitations2, indent=2)}")

    # Step 9.1: Test pagination for invitations
    logger.info("Step 9.1: Testing pagination for invitations")
    # Get first page with limit of 2
    first_page = api.get_invitations(users[1]["email"], limit=2)
    logger.info(f"First page of invitations: {json.dumps(first_page, indent=2)}")

    # Get second page using next_timestamp
    if first_page.get("next_timestamp"):
        second_page = api.get_invitations(
            users[1]["email"], limit=2, after_timestamp=first_page["next_timestamp"]
        )
        logger.info(f"Second page of invitations: {json.dumps(second_page, indent=2)}")

    # Test invalid pagination parameters
    logger.info("Testing invalid pagination parameters")
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/invitations?limit=101",  # Test limit > 100
        headers={"Authorization": f"Bearer {api.tokens[users[1]['email']]}"},
        expected_status_code=400,
        expected_error_message="Invalid request parameters",
    )
    logger.info("✓ Invalid pagination parameters test passed")

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

    api.create_user(
        no_profile_user["email"],
        no_profile_user["password"],
        no_profile_user["name"],
    )

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
