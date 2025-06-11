#!/usr/bin/env python3
"""
Village API Deletion Automation Script

This script automates API calls to the Village Firebase emulator for testing deletion functionality.
It creates users, authenticates them, and performs various operations to test the deletion process:
- Create two users
- Connect them as friends
- First user creates an additional invitation
- First user creates an update
- First user updates a device
- First user gets deleted
- Wait a bit
- Check second user's feed that no items are there
- Check second user's friends are empty
- Check in DB directly that updates, feed items, device, and invitation are non-existent
"""

import json
import logging
import os
import time

import firebase_admin
from firebase_admin import credentials, firestore
from utils.village_api import VillageAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Set up Firestore emulator
os.environ["FIRESTORE_EMULATOR_HOST"] = "localhost:8080"


def run_deletion_test():
    """Run a test of the Village API deletion functionality"""
    api = VillageAPI()

    # Create two users
    users = [
        {
            "email": "deletion_test1@example.com",
            "password": "password123",
            "name": "Deletion Test One",
        },
        {
            "email": "deletion_test2@example.com",
            "password": "password123",
            "name": "Deletion Test Two",
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

    # Connect users as friends
    # Create friendship between users
    invitation = api.get_invitation(users[0]["email"])
    logger.info(f"User 1 created invitation: {json.dumps(invitation, indent=2)}")
    invitation_id = invitation["invitation_id"]

    join_request = api.request_to_join(users[1]["email"], invitation_id)
    logger.info(f"User 2 requests to join: {json.dumps(join_request, indent=2)}")

    accept_result = api.accept_join_request(
        users[0]["email"], join_request["request_id"]
    )
    logger.info(f"User 1 accepted invitation: {json.dumps(accept_result, indent=2)}")

    # Verify friendship was created
    friends_before_user1 = api.get_friends(users[0]["email"])
    logger.info(f"Friends of user 1 before deletion: {friends_before_user1}")
    assert any(
        friend["name"] == users[1]["name"] and friend["last_update_emoji"] == ""
        for friend in friends_before_user1["friends"]
    )

    friends_before_user2 = api.get_friends(users[1]["email"])
    logger.info(f"Friends of user 2 before deletion: {friends_before_user2}")
    assert any(
        friend["name"] == users[0]["name"] and friend["last_update_emoji"] == ""
        for friend in friends_before_user2["friends"]
    )

    # First user creates an update
    logger.info("First user creates an update")
    update_data = {
        "content": "This is a test update for deletion",
        "sentiment": "happy",
        "score": 5,
        "emoji": "😊",
        "friend_ids": [api.user_ids[users[1]["email"]]],  # Share with user 2
        "group_ids": [],  # No groups
    }
    created_update = api.create_update(users[0]["email"], update_data)
    logger.info(f"First user created update: {json.dumps(created_update, indent=2)}")

    # First user updates a device
    logger.info("First user updates a device")
    device_data = {
        "device_id": "test-device-id-123",
    }
    updated_device = api.update_device(users[0]["email"], device_data)
    logger.info(f"First user updated device: {json.dumps(updated_device, indent=2)}")

    # Get user 2's feed before deletion
    logger.info("Getting user 2's feed before deletion")
    user2_feed_before = api.get_my_feed(users[1]["email"])
    logger.info(
        f"User 2's feed before deletion: {json.dumps(user2_feed_before, indent=2)}"
    )

    # Verify user 2's feed contains user 1's update
    user1_updates_in_feed = [
        update
        for update in user2_feed_before["updates"]
        if update["created_by"] == api.user_ids[users[0]["email"]]
    ]
    assert (
        len(user1_updates_in_feed) > 0
    ), "User 1's update not found in User 2's feed before deletion"
    logger.info(
        f"User 2's feed contains {len(user1_updates_in_feed)} updates from User 1 before deletion"
    )

    # First user gets deleted
    logger.info("Deleting first user's profile")
    api.delete_profile(users[0]["email"])

    # Wait a bit for the Firestore triggers to process the deletion
    wait_time = 10  # seconds
    logger.info(
        f"Waiting {wait_time} seconds for Firestore triggers to process deletion..."
    )
    time.sleep(wait_time)

    # Check second user's feed that no items are there
    logger.info("Checking user 2's feed after deletion")
    user2_feed_after = api.get_my_feed(users[1]["email"])
    logger.info(
        f"User 2's feed after deletion: {json.dumps(user2_feed_after, indent=2)}"
    )

    # Verify user 2's feed doesn't contain user 1's update
    user1_updates_in_feed_after = [
        update
        for update in user2_feed_after["updates"]
        if update.get("created_by") == api.user_ids[users[0]["email"]]
    ]
    assert (
        len(user1_updates_in_feed_after) == 0
    ), "User 1's update found in User 2's feed after deletion"
    logger.info("User 2's feed doesn't contain any updates from User 1 after deletion")

    # Verify user 1 is no longer in user 2's friends list
    friends_after_user2 = api.get_friends(users[1]["email"])
    logger.info(f"Friends of user 2 after deletion: {friends_after_user2}")
    assert not any(
        friend["name"] == users[0]["name"] for friend in friends_after_user2["friends"]
    )

    logger.info("Deletion test for profiles and friendships completed successfully!")

    # ============ DELETING UPDATES AND FEEDS ============

    # Check in DB directly that updates, feed items, device, and invitation are non-existent
    logger.info("Checking DB directly for deleted items")

    # Initialize Firestore client
    if not firebase_admin._apps:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)
    db = firestore.client()

    # Check for user 1's updates
    updates_query = db.collection("updates").where(
        "created_by", "==", api.user_ids[users[0]["email"]]
    )
    updates_docs = list(updates_query.stream())
    assert (
        len(updates_docs) == 0
    ), f"Found {len(updates_docs)} updates for User 1 in DB after deletion"
    logger.info("No updates found for User 1 in DB after deletion")

    # Check for user 1's device
    device_doc = (
        db.collection("devices").document(api.user_ids[users[0]["email"]]).get()
    )
    assert (
        not device_doc.exists
    ), "Device document still exists for User 1 after deletion"
    logger.info("No device document found for User 1 in DB after deletion")

    # Check for user 1's invitations
    invitations_query = db.collection("invitations").where(
        "sender_id", "==", api.user_ids[users[0]["email"]]
    )
    invitation_docs = list(invitations_query.stream())
    assert (
        len(invitation_docs) == 0
    ), f"Found {len(invitation_docs)} invitations for User 1 in DB after deletion"
    logger.info("No invitations found for User 1 in DB after deletion")

    # Check for feed items referencing user 1's updates
    feed_query = db.collection_group("feed").where(
        "created_by", "==", api.user_ids[users[0]["email"]]
    )
    feed_docs = list(feed_query.stream())
    assert (
        len(feed_docs) == 0
    ), f"Found {len(feed_docs)} feed items for User 1 in DB after deletion"
    logger.info("No feed items found for User 1 in DB after deletion")

    logger.info("All deletion tests passed successfully!")


if __name__ == "__main__":
    try:
        # Import requests here to avoid circular import with the monkey patching
        import requests

        run_deletion_test()
        logger.info("Deletion automation completed successfully!")
    except Exception as e:
        logger.error(f"Deletion automation failed: {str(e)}")
        raise
