#!/usr/bin/env python3
"""
Village API Sentiment Analysis Automation Script

This script automates API calls to the Village Firebase emulator for testing the sentiment analysis functionality.
It creates a user, authenticates them, and tests the sentiment analysis endpoint:
- Create a user
- Analyze sentiment for a text
- Test negative cases (missing content, etc.)
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


def run_sentiment_tests():
    """Run tests for the Village API sentiment analysis functionality"""
    api = VillageAPI()

    # Create a test user
    user = {
        "email": "sentiment_test@example.com",
        "password": "password123",
        "name": "Sentiment Test User",
    }

    # Create and authenticate user
    api.create_user(user["email"], user["password"], user["name"])

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Analyze sentiment for a text
    logger.info("Analyzing sentiment for a text")
    text = "I'm really happy today! Everything is going great and I feel wonderful."
    sentiment_result = api.analyze_sentiment(user["email"], text)
    logger.info(
        f"Received sentiment analysis: {json.dumps(sentiment_result, indent=2)}"
    )

    # Verify sentiment response format
    assert "sentiment" in sentiment_result, "Response does not contain sentiment field"
    assert "score" in sentiment_result, "Response does not contain score field"
    assert "emoji" in sentiment_result, "Response does not contain emoji field"
    assert isinstance(
        sentiment_result["sentiment"], str
    ), "Sentiment should be a string"
    assert isinstance(sentiment_result["score"], int), "Score should be a number"
    assert isinstance(sentiment_result["emoji"], str), "Emoji should be a string"
    logger.info("✓ Sentiment format verification passed")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Try to analyze sentiment with empty content
    logger.info("Test 1: Attempting to analyze sentiment with empty content")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/sentiment",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[user['email']]}",
        },
        json_data={"content": ""},
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Empty content test passed")

    # Test 2: Try to analyze sentiment without content field
    logger.info("Test 2: Attempting to analyze sentiment without content field")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/sentiment",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[user['email']]}",
        },
        json_data={},
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Missing content field test passed")

    # Test 3: Try to analyze sentiment without authentication
    logger.info("Test 3: Attempting to analyze sentiment without authentication")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/sentiment",
        headers={"Content-Type": "application/json"},
        json_data={"content": "This should not be analyzed"},
        expected_status_code=401,
    )
    logger.info("✓ Unauthenticated access test passed")

    logger.info("========== ALL TESTS COMPLETED ==========")


if __name__ == "__main__":
    try:
        run_sentiment_tests()
        logger.info("Sentiment analysis automation completed successfully")
    except Exception as e:
        logger.error(f"Sentiment analysis automation failed: {str(e)}")
        raise
