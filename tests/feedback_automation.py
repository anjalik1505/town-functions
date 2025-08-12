#!/usr/bin/env python3
"""
Town API Feedback Automation Script

This script automates API calls to the Town Firebase emulator for testing feedback functionality.
It creates a user, authenticates them, and performs feedback operations:
- Create feedback
- Test validation
- Test authentication
"""

import json
import logging

from utils.town_api import API_BASE_URL, TownAPI

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Test configuration
TEST_CONFIG = {
    "wait_time": 2,  # Time to wait between operations
}


def run_feedback_tests():
    """Run tests for the Town API feedback functionality"""
    api = TownAPI()

    # Create a test user
    user = {
        "email": "feedback_test@example.com",
        "password": "password123",
        "name": "Feedback Test User",
    }

    # Create and authenticate user
    api.create_user(user["email"], user["password"], user["name"])

    # Create profile for the user
    profile_data = {
        "username": user["email"].split("@")[0],
        "name": user["name"],
        "avatar": f"https://example.com/avatar_{user['name'].replace(' ', '_').lower()}.jpg",
        "birthday": "1990-01-01",
    }
    api.create_profile(user["email"], profile_data)
    logger.info(f"Created profile for user: {user['email']}")

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Step 1: Create feedback
    logger.info("Step 1: Creating feedback")
    feedback_content = "This is a test feedback message"
    feedback = api.create_feedback(user["email"], feedback_content)
    logger.info(f"Created feedback: {json.dumps(feedback, indent=2)}")

    # Verify feedback data
    assert "feedback_id" in feedback, "Feedback missing feedback_id"
    assert "content" in feedback, "Feedback missing content"
    assert feedback["content"] == feedback_content, "Feedback content mismatch"
    assert "created_by" in feedback, "Feedback missing created_by"
    assert "created_at" in feedback, "Feedback missing created_at"
    logger.info("✓ Feedback data verification passed")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Try to create empty feedback
    logger.info("Test 1: Attempting to create empty feedback")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/feedback",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[user['email']]}",
        },
        json_data={"content": ""},
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Empty feedback test passed")

    # Test 2: Try to create feedback without authentication
    logger.info("Test 2: Attempting to create feedback without authentication")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/feedback",
        headers={},
        json_data={"content": "This should fail"},
        expected_status_code=401,
    )
    logger.info("✓ Unauthenticated feedback test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_feedback_tests()
    except Exception as e:
        logger.error(f"Error running tests: {e}")
        raise
