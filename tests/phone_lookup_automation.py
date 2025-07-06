#!/usr/bin/env python3
"""Phone Lookup Automation Test

Flow:
1. Create user with phone number, create profile.
2. Lookup phone, expect match.
3. Update profile (name/username/avatar), lookup again expect updated fields.
4. Update profile with new phone number.
5. Lookup old phone – expect no match.
6. Lookup new phone – expect match with updated data.
"""

import json
import logging
import time

from utils.village_api import VillageAPI

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Test configuration
TEST_CONFIG = {
    "wait_time": 5,  # Time to wait between operations
}

def run_phone_lookup_tests():
    api = VillageAPI()

    user = {
        "email": "phone_lookup@example.com",
        "password": "password123",
        "name": "Phone Lookup User",
    }

    # Create and auth
    api.create_user(user["email"], user["password"], user["name"])

    phone1 = "+11111111111"
    phone2 = "+12222222222"

    # Create profile with phone1
    profile_data = {
        "username": "phonelookup",
        "name": user["name"],
        "avatar": "https://example.com/avatar.jpg",
        "phone_number": phone1,
    }
    api.create_profile(user["email"], profile_data)

    # Lookup phone1
    lookup = api.lookup_phones(user["email"], [phone1])
    logger.info("Lookup result after create: %s", json.dumps(lookup, indent=2))
    assert len(lookup["matches"]) == 1, "Phone should be found"
    match = lookup["matches"][0]
    assert match["username"] == profile_data["username"]
    assert match["name"] == profile_data["name"]
    assert match["avatar"] == profile_data["avatar"]

    # Update profile details (same phone)
    updated_info = {
        "username": "phonelookup_new",
        "name": "Phone Lookup User New",
        "avatar": "https://example.com/avatar_new.jpg",
    }
    api.update_profile(user["email"], updated_info)

    # Wait for update triggers to process
    logger.info(
        f"Waiting {TEST_CONFIG['wait_time']} seconds for profile update triggers to process..."
    )
    time.sleep(TEST_CONFIG["wait_time"])

    # Lookup again
    lookup2 = api.lookup_phones(user["email"], [phone1])
    match2 = lookup2["matches"][0]
    assert match2["username"] == updated_info["username"]
    assert match2["name"] == updated_info["name"]
    assert match2["avatar"] == updated_info["avatar"]

    # Change phone number to phone2
    api.update_profile(user["email"], {"phone_number": phone2})

    # Lookup old phone – expect no matches
    lookup_old = api.lookup_phones(user["email"], [phone1])
    assert len(lookup_old["matches"]) == 0, "Old phone should not return matches"

    # Lookup new phone – expect match
    lookup_new = api.lookup_phones(user["email"], [phone2])
    assert len(lookup_new["matches"]) == 1, "New phone should return match"

    logger.info("Phone lookup tests passed")


if __name__ == "__main__":
    run_phone_lookup_tests()
