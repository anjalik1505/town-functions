#!/usr/bin/env python3
"""
Town API Transcription Automation Script

This script automates API calls to the Town Firebase emulator for testing the audio transcription functionality.
It creates a user, authenticates them, and tests the transcription endpoint:
- Create a user
- Transcribe audio from a file
- Test negative cases (invalid audio data, missing fields, etc.)
"""

import base64
import gzip
import logging
import os

from utils.town_api import API_BASE_URL, TownAPI

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Path to the audio file for testing
AUDIO_FILE_PATH = os.path.join(os.path.dirname(__file__), "resources", "audio2.mp3")


def compress_data(data: bytes, compression_type: str = "gzip") -> bytes:
    """Compress binary data using the specified compression method."""
    if compression_type == "gzip":
        return gzip.compress(data)
    else:
        raise ValueError(f"Unsupported compression type: {compression_type}")


def main():
    """
    Test the audio transcription functionality.
    
    This test:
    1. Creates a test user
    2. Reads and encodes an audio file
    3. Tests transcription with both uncompressed and compressed audio
    4. Validates the response format and content
    5. Tests error handling for invalid inputs
    """
    # Initialize the Town API client
api = TownAPI()

    # ============ SETUP ============
    logger.info("========== SETUP ==========")

    # Create a test user
    user = {
        "email": "transcribe_test@example.com",
        "password": "password123",
        "name": "Transcribe Test User",
    }

    # Create a test user
    api.create_user(user["email"], user["password"], user["name"])
    logger.info(f"Created test user: {user['email']}")

    # Read the audio file
    with open(AUDIO_FILE_PATH, "rb") as audio_file:
        audio_data = audio_file.read()

    # Encode the audio data as base64
    base64_audio = base64.b64encode(audio_data).decode("utf-8")
    logger.info(f"Read and encoded audio file: {AUDIO_FILE_PATH}")

    # Compress the audio data for compressed tests
    compressed_audio = compress_data(audio_data)
    base64_compressed_audio = base64.b64encode(compressed_audio).decode("utf-8")
    logger.info(f"Compressed audio data: original size={len(audio_data)}, compressed size={len(compressed_audio)}")

    # ============ POSITIVE PATH TESTS ============
    logger.info("========== STARTING POSITIVE PATH TESTS ==========")

    # Test 1: Transcribe uncompressed audio
    logger.info("Test 1: Transcribing uncompressed audio")
    response = api.transcribe_audio(user["email"], base64_audio)

    # Validate the response
    assert "transcription" in response, "Response missing 'transcription' field"
    assert "sentiment" in response, "Response missing 'sentiment' field"
    assert "score" in response, "Response missing 'score' field"
    assert "emoji" in response, "Response missing 'emoji' field"

    logger.info(f"Response: {response}")
    logger.info("✓ Uncompressed audio transcription test passed")

    # Test 2: Transcribe compressed audio
    logger.info("Test 2: Transcribing compressed audio")
    response = api.transcribe_audio(user["email"], base64_compressed_audio)

    # Validate the response
    assert "transcription" in response, "Response missing 'transcription' field"
    assert "sentiment" in response, "Response missing 'sentiment' field"
    assert "score" in response, "Response missing 'score' field"
    assert "emoji" in response, "Response missing 'emoji' field"

    logger.info(f"Response: {response}")
    logger.info("✓ Compressed audio transcription test passed")

    # ============ NEGATIVE PATH TESTS ============
    logger.info("========== STARTING NEGATIVE PATH TESTS ==========")

    # Test 1: Try to transcribe with invalid base64 data
    logger.info("Test 1: Attempting to transcribe with invalid base64 data")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/transcribe",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[user['email']]}",
        },
        json_data={"audio_data": "not-valid-base64!"},
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Invalid base64 data test passed")

    # Test 2: Try to transcribe without audio_data field
    logger.info("Test 2: Attempting to transcribe without audio_data field")
    api.make_request_expecting_error(
        "post",
        f"{API_BASE_URL}/updates/transcribe",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api.tokens[user['email']]}",
        },
        json_data={},
        expected_status_code=400,
        expected_error_message="validation error",
    )
    logger.info("✓ Missing audio_data test passed")

    logger.info("All tests completed successfully!")


if __name__ == "__main__":
    main()
