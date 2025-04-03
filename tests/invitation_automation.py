#!/usr/bin/env python3
"""
Village API Invitation Automation Script

This script automates API calls to the Village Firebase emulator for testing invitation functionality.
It creates users, authenticates them, and performs various invitation operations.
"""

import json
import logging
import os
from datetime import timedelta

import firebase_admin
from firebase_admin import credentials, firestore
from utils.village_api import API_BASE_URL, VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

os.environ["FIRESTORE_EMULATOR_HOST"] = "localhost:8080"


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
    invitation = api.create_invitation(users[0]["email"], "Test Receiver One")
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
    invitation2 = api.create_invitation(users[1]["email"], "Test Receiver Two")
    logger.info(f"Second user created invitation: {json.dumps(invitation2, indent=2)}")

    # Step 8.1: Create additional invitations for pagination test
    logger.info("Step 8.1: Creating additional invitations for pagination test")
    invitation3 = api.create_invitation(users[1]["email"], "Test Receiver Three")
    invitation4 = api.create_invitation(users[1]["email"], "Test Receiver Four")
    logger.info("Created two additional invitations")

    # Step 9: Second user gets their invitations
    invitations2 = api.get_invitations(users[1]["email"])
    logger.info(f"Second user's invitations: {json.dumps(invitations2, indent=2)}")

    # Step 9.1: Test pagination for invitations
    logger.info("Step 9.1: Testing pagination for invitations")
    # Get first page with limit of 2
    first_page = api.get_invitations(users[1]["email"], limit=2)
    logger.info(f"First page of invitations: {json.dumps(first_page, indent=2)}")

    # Get second page using next_cursor
    if first_page.get("next_cursor"):
        second_page = api.get_invitations(
            users[1]["email"], limit=2, after_cursor=first_page["next_cursor"]
        )
        logger.info(f"Second page of invitations: {json.dumps(second_page, indent=2)}")

    # Step 9.2: Test getting single invitation
    logger.info("Step 9.2: Testing get single invitation")
    # Get the first invitation from the list
    if invitations2["invitations"]:
        first_invitation = invitations2["invitations"][0]
        invitation_id = first_invitation["invitation_id"]

        # Get the invitation by ID
        single_invitation = api.get_invitation(users[1]["email"], invitation_id)
        logger.info(
            f"Retrieved single invitation: {json.dumps(single_invitation, indent=2)}"
        )

        # Verify the invitation data matches
        assert (
            single_invitation["invitation_id"] == first_invitation["invitation_id"]
        ), "Invitation IDs do not match"
        assert (
            single_invitation["status"] == first_invitation["status"]
        ), "Invitation statuses do not match"
        assert (
            single_invitation["receiver_name"] == first_invitation["receiver_name"]
        ), "Receiver names do not match"
        logger.info("✓ Single invitation retrieval test passed")

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
    invitation4 = api.create_invitation(users[3]["email"], "Test Receiver Five")
    invitation4_id = api.invitation_ids[users[3]["email"]]
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/{invitation4_id}/accept",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=400,
        expected_error_message="Cannot accept your own invitation",
    )
    logger.info("✓ Accept own invitation test passed")

    # Test 5: User attempts to reject their own invitation
    logger.info("Test 5: User attempting to reject their own invitation")
    # Create a new invitation specifically for this test
    invitation5 = api.create_invitation(users[3]["email"], "Test Receiver Six")
    invitation5_id = api.invitation_ids[users[3]["email"]]
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/{invitation5_id}/reject",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=400,
        expected_error_message="Cannot reject your own invitation",
    )
    logger.info("✓ Reject own invitation test passed")

    # Test 6: User attempts to resend someone else's invitation
    logger.info("Test 6: User attempting to resend someone else's invitation")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/{invitation5_id}/resend",
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
        json_data={
            "receiver_name": "Test Receiver"
        },  # Include receiver_name to properly test profile validation
        expected_status_code=404,
        expected_error_message="Profile not found",
    )
    logger.info("✓ Create invitation without profile test passed")

    # Test 7.1: Attempt to create invitation without receiver_name
    logger.info("Test 7.1: Attempting to create invitation without receiver_name")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[users[0]['email']]}",
        },
        json_data={},
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Create invitation without receiver_name test passed")

    # Test 8: Attempt to access invitations without authentication
    logger.info("Test 8: Attempting to access invitations without authentication")
    api.make_request_expecting_error(
        "get", f"{API_BASE_URL}/invitations", headers={}, expected_status_code=401
    )
    logger.info("✓ Unauthenticated access test passed")

    # Test 9: Test combined limit (5 friends + active invitations)
    logger.info("Test 9: Testing combined limit (5 friends + active invitations)")

    # Get current state
    current_invitations = api.get_invitations(users[3]["email"])
    current_friends = api.get_friends(users[3]["email"])

    # Calculate current counts
    active_invitations = len(
        [
            inv
            for inv in current_invitations["invitations"]
            if inv["status"] == "pending"
        ]
    )
    friend_count = len(current_friends.get("friends", []))
    total_count = active_invitations + friend_count

    logger.info(
        f"Current state - Friends: {friend_count}, Active Invitations: {active_invitations}, Total: {total_count}"
    )

    # Calculate how many more invitations we need to reach exactly 5
    invitations_to_create = 5 - total_count

    if invitations_to_create > 0:
        # Create additional invitations to reach exactly 5
        for i in range(invitations_to_create):
            invitation = api.create_invitation(
                users[3]["email"], f"Test Receiver {i+7}"
            )
            logger.info(
                f"Created invitation {i+1}/{invitations_to_create}: {json.dumps(invitation, indent=2)}"
            )

    # Verify we have exactly 5 total (friends + active invitations)
    final_invitations = api.get_invitations(users[3]["email"])
    final_friends = api.get_friends(users[3]["email"])
    final_active_invitations = len(
        [inv for inv in final_invitations["invitations"] if inv["status"] == "pending"]
    )
    final_friend_count = len(final_friends.get("friends", []))
    final_total = final_active_invitations + final_friend_count

    if final_total != 5:
        raise Exception(
            f"Expected total of 5 (friends + active invitations), got {final_total}"
        )

    # Attempt to create a 6th invitation
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=400,
        expected_error_message="You have reached the maximum number of friends and active invitations",
    )
    logger.info("✓ Combined limit test passed")

    # Test 10: Test combined limit when resending
    logger.info("Test 10: Testing combined limit when resending")

    # Get the first pending invitation from the existing invitations
    pending_invitations = [
        inv for inv in final_invitations["invitations"] if inv["status"] == "pending"
    ]
    if not pending_invitations:
        raise Exception("No pending invitations found for resend test")

    expired_invitation = pending_invitations[0]
    expired_invitation_id = expired_invitation["invitation_id"]

    # Manually expire the invitation by setting its expiration date to 1 second after creation
    # Requires default credentials to be set up
    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    invitation_ref = db.collection("invitations").document(expired_invitation_id)
    invitation_doc = invitation_ref.get()
    if not invitation_doc.exists:
        raise Exception(f"Invitation {expired_invitation_id} not found in database")

    invitation_data = invitation_doc.to_dict()
    created_at = invitation_data["created_at"]
    # Set expiration to 1 second after creation
    expires_at = created_at + timedelta(seconds=1)
    invitation_ref.update({"expires_at": expires_at})
    logger.info(f"Manually expired invitation {expired_invitation_id}")

    # Create a new invitation to reach the limit again
    new_invitation = api.create_invitation(users[3]["email"], "Test Receiver Seven")
    logger.info(
        f"Created new invitation to reach limit: {json.dumps(new_invitation, indent=2)}"
    )

    # Attempt to resend the expired invitation
    logger.info(f"Attempting to resend expired invitation {expired_invitation_id}")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/{expired_invitation_id}/resend",
        headers={"Authorization": f"Bearer {api.tokens[users[3]['email']]}"},
        expected_status_code=400,
        expected_error_message="You have reached the maximum number of friends and active invitations",
    )
    logger.info("✓ Combined limit resend test passed")

    # Test 11: Test combined limit when accepting
    logger.info("Test 11: Testing combined limit when accepting")

    # Find the user with the most friends
    max_friends = 0
    user_with_most_friends = None
    for user in users:
        friends = api.get_friends(user["email"])
        friend_count = len(friends.get("friends", []))
        if friend_count > max_friends:
            max_friends = friend_count
            user_with_most_friends = user

    if not user_with_most_friends:
        raise Exception("No users found with friends")

    logger.info(
        f"User with most friends: {user_with_most_friends['email']} ({max_friends} friends)"
    )

    # Calculate how many more friends we need to create
    friends_to_create = 5 - max_friends

    # Create additional friends to reach exactly 5
    for i in range(friends_to_create):
        # Create a new user for each friend
        friend_user = {
            "email": f"friend{i+1}_test@example.com",
            "password": "password123",
            "name": f"Friend Test {i+1}",
        }
        api.create_user(
            friend_user["email"], friend_user["password"], friend_user["name"]
        )

        # Create profile for the friend
        profile_data = {
            "username": friend_user["email"].split("@")[0],
            "name": friend_user["name"],
            "avatar": f"https://example.com/avatar_{friend_user['name'].replace(' ', '_').lower()}.jpg",
            "location": "Test City",
            "birthday": "1990-01-01",
        }
        api.create_profile(friend_user["email"], profile_data)

        # Create and accept invitation
        invitation = api.create_invitation(
            user_with_most_friends["email"], "Test Receiver Eight"
        )
        accepted = api.accept_invitation(
            friend_user["email"], api.invitation_ids[user_with_most_friends["email"]]
        )
        logger.info(
            f"Created and accepted friend {i+1}/{friends_to_create}: {json.dumps(accepted, indent=2)}"
        )

    # Verify we have exactly 5 friends
    final_friends = api.get_friends(user_with_most_friends["email"])
    final_friend_count = len(final_friends.get("friends", []))
    if final_friend_count != 5:
        raise Exception(f"Expected 5 friends, got {final_friend_count}")

    # Create a new user to send an invitation to the user who has reached their combined limit
    sender_user = {
        "email": "sender_test@example.com",
        "password": "password123",
        "name": "Sender Test User",
    }
    api.create_user(sender_user["email"], sender_user["password"], sender_user["name"])

    # Create profile for the sender
    profile_data = {
        "username": sender_user["email"].split("@")[0],
        "name": sender_user["name"],
        "avatar": f"https://example.com/avatar_{sender_user['name'].replace(' ', '_').lower()}.jpg",
        "location": "Test City",
        "birthday": "1990-01-01",
    }
    api.create_profile(sender_user["email"], profile_data)

    # Create invitation from the new user to the user who has reached their combined limit
    invitation = api.create_invitation(sender_user["email"], "Test Receiver Nine")
    logger.info(
        f"Created invitation from {sender_user['email']} to {user_with_most_friends['email']}"
    )

    # Attempt to accept the invitation (should fail due to combined limit)
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/invitations/{api.invitation_ids[sender_user['email']]}/accept",
        headers={
            "Authorization": f"Bearer {api.tokens[user_with_most_friends['email']]}"
        },
        expected_status_code=400,
        expected_error_message="You have reached the maximum number of friends and active invitations",
    )
    logger.info("✓ Combined limit accept test passed")

    # Test 12: Test get-invitation negative cases
    logger.info("Test 12: Testing get-invitation negative cases")

    # Test 12.1: Attempt to get non-existent invitation
    logger.info("Test 12.1: Attempting to get non-existent invitation")
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/invitations/non-existent-invitation-id",
        headers={"Authorization": f"Bearer {api.tokens[users[0]['email']]}"},
        expected_status_code=404,
        expected_error_message="Invitation not found",
    )
    logger.info("✓ Get non-existent invitation test passed")

    # Test 12.2: Attempt to get someone else's invitation
    logger.info("Test 12.2: Attempting to get someone else's invitation")
    # Get an invitation ID from the fourth user (we know they have invitations from Test 9)
    fourth_user_invitations = api.get_invitations(users[3]["email"])
    if not fourth_user_invitations["invitations"]:
        raise Exception("No invitations found for fourth user")
    fourth_user_invitation_id = fourth_user_invitations["invitations"][0][
        "invitation_id"
    ]

    # Try to get it with the second user's token
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/invitations/{fourth_user_invitation_id}",
        headers={"Authorization": f"Bearer {api.tokens[users[1]['email']]}"},
        expected_status_code=403,
        expected_error_message="You can only view your own invitations",
    )
    logger.info("✓ Get someone else's invitation test passed")

    # Test 12.3: Attempt to get invitation without authentication
    logger.info("Test 12.3: Attempting to get invitation without authentication")
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/invitations/{fourth_user_invitation_id}",
        headers={},
        expected_status_code=401,
    )
    logger.info("✓ Get invitation without authentication test passed")

    logger.info("========== NEGATIVE PATH TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_invitation_demo()
        logger.info("Invitation automation completed successfully!")
    except Exception as e:
        logger.error(f"Invitation automation failed: {str(e)}")
        raise
