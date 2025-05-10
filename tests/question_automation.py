#!/usr/bin/env python3
"""
Village API Question Automation Script

This script automates API calls to the Village Firebase emulator for testing the question generation functionality.
It creates a user, authenticates them, creates a profile, and tests the question generation endpoint:
- Create a user
- Create a profile
- Get a personalized question
- Test negative cases (missing profile, etc.)
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


def run_question_tests():
    """Run tests for the Village API question generation functionality"""
    api = VillageAPI()

    # Create a test user
    user = {
        "email": "question_test@example.com",
        "password": "password123",
        "name": "Question Test User",
    }

    # Create and authenticate user
    api.create_user(user["email"], user["password"], user["name"])

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Step 1: Create a profile for the user
    profile_data = {
        "username": user["email"].split("@")[0],
        "name": user["name"],
        "avatar": f"https://example.com/avatar_{user['name'].replace(' ', '_').lower()}.jpg",
        "location": "New York",
        "birthday": "1990-01-01",
        "notification_settings": ["all"],
        "gender": "male",
    }
    created_profile = api.create_profile(user["email"], profile_data)
    logger.info(f"Created profile: {json.dumps(created_profile, indent=2)}")

    # Step 2: Get a personalized question
    logger.info("Getting personalized question")
    question_data = api.get_question(user["email"])
    logger.info(f"Received question: {json.dumps(question_data, indent=2)}")

    # Verify question response format
    assert "question" in question_data, "Response does not contain question field"
    assert isinstance(question_data["question"], str), "Question should be a string"
    assert len(question_data["question"]) > 0, "Question should not be empty"
    logger.info("✓ Question format verification passed")

    # Step 3: Create some updates to test context-aware questions
    logger.info("Creating updates to test context-aware questions")
    update_data = {
        "content": "I'm working on a new project and facing some challenges with the team.",
        "sentiment": "neutral",
        "score": 3,
        "emoji": "👍",
        "friend_ids": [],
        "group_ids": [],
    }
    created_update = api.create_update(user["email"], update_data)
    logger.info(f"Created update: {json.dumps(created_update, indent=2)}")

    # Wait a bit for the AI to process the update
    logger.info("Waiting for AI to process the update...")
    time.sleep(10)

    # Get another question to verify context awareness
    logger.info("Getting another personalized question after update")
    new_question_data = api.get_question(user["email"])
    logger.info(f"Received new question: {json.dumps(new_question_data, indent=2)}")

    # Verify the new question is different from the first one
    assert (
            new_question_data["question"] != question_data["question"]
    ), "Questions should be different"
    logger.info("✓ Context-aware question verification passed")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Try to get a question without a profile
    logger.info("Test 1: Attempting to get a question without a profile")
    # Create a new user without a profile
    no_profile_user = {
        "email": "no_profile_question@example.com",
        "password": "password123",
        "name": "No Profile Question",
    }
    api.create_user(
        no_profile_user["email"],
        no_profile_user["password"],
        no_profile_user["name"],
    )

    # Try to get a question
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/me/question",
        headers={"Authorization": f"Bearer {api.tokens[no_profile_user['email']]}"},
        expected_status_code=404,
        expected_error_message="Profile not found",
    )
    logger.info("✓ No profile test passed")

    # Test 2: Try to get a question without authentication
    logger.info("Test 2: Attempting to get a question without authentication")
    api.make_request_expecting_error(
        "get",
        f"{API_BASE_URL}/me/question",
        headers={},
        expected_status_code=401,
    )
    logger.info("✓ Unauthenticated access test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_question_tests()
        logger.info("Question automation completed successfully")
    except Exception as e:
        logger.error(f"Question automation failed: {str(e)}")
        raise
