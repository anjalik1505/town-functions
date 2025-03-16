#!/usr/bin/env python3
"""
Village API Automation Script

This script automates API calls to the Village Firebase emulator for testing purposes.
It creates users, authenticates them, and performs various API operations.
"""

import requests
import json
import time
from typing import Dict, List, Optional, Any
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Constants
FIREBASE_AUTH_URL = "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key"
API_BASE_URL = "http://localhost:5001/village-staging-9178d/us-central1/api"
FIREBASE_CREATE_USER_URL = "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key"
FIREBASE_UPDATE_USER_URL = "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key"

class VillageAPI:
    """Class to interact with the Village API"""
    
    def __init__(self):
        self.tokens = {}  # Store tokens for each user
        self.user_ids = {}  # Store user IDs for each user
        self.friendship_ids = {}  # Store friendship IDs
        self.group_ids = {}  # Store group IDs
    
    def create_user(self, email: str, password: str, display_name: str) -> Dict[str, Any]:
        """Create a new user in Firebase Auth and set email as verified"""
        logger.info(f"Creating user with email: {email}")
        
        # Step 1: Create the user
        payload = {
            "email": email,
            "password": password,
            "displayName": display_name,
            "returnSecureToken": True
        }
        
        response = requests.post(FIREBASE_CREATE_USER_URL, json=payload)
        if response.status_code != 200:
            logger.error(f"Failed to create user: {response.text}")
            response.raise_for_status()
        
        data = response.json()
        logger.debug(f"User creation response: {json.dumps(data, indent=2)}")
        
        # Store user ID if available
        if "localId" in data:
            user_id = data["localId"]
            self.user_ids[email] = user_id
        
        # Now authenticate to get a token for subsequent API calls
        self.authenticate_user(email, password)
        
        logger.info(f"User created with ID: {self.user_ids.get(email, 'unknown')}")
        return data
    
    def authenticate_user(self, email: str, password: str) -> Dict[str, Any]:
        """Authenticate a user and get a JWT token"""
        logger.info(f"Authenticating user: {email}")
        
        payload = {
            "email": email,
            "password": password,
            "returnSecureToken": True
        }
        
        response = requests.post(FIREBASE_AUTH_URL, json=payload)
        if response.status_code != 200:
            logger.error(f"Authentication failed: {response.text}")
            response.raise_for_status()
        
        data = response.json()
        self.tokens[email] = data["idToken"]
        self.user_ids[email] = data["localId"]
        
        logger.info(f"User authenticated with ID: {self.user_ids[email]}")
        return data
    
    def create_profile(self, email: str, profile_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a user profile"""
        logger.info(f"Creating profile for user: {email}")
        
        if profile_data is None:
            profile_data = {}
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        response = requests.post(f"{API_BASE_URL}/me/profile", headers=headers, json=profile_data)
        if response.status_code != 200:
            logger.error(f"Failed to create profile: {response.text}")
            response.raise_for_status()
        
        logger.info(f"Profile created for user: {email}")
        return response.json()
    
    def get_profile(self, email: str) -> Dict[str, Any]:
        """Get the user's profile"""
        logger.info(f"Getting profile for user: {email}")
        
        headers = {
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        response = requests.get(f"{API_BASE_URL}/me/profile", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get profile: {response.text}")
            response.raise_for_status()
        
        return response.json()
    
    def get_updates(self, email: str, limit: int = 10, after_timestamp: str = "2025-01-01T00:00:00Z") -> Dict[str, Any]:
        """Get user updates"""
        logger.info(f"Getting updates for user: {email}")
        
        headers = {
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        params = {
            "limit": limit,
            "after_timestamp": after_timestamp
        }
        
        response = requests.get(f"{API_BASE_URL}/me/updates", headers=headers, params=params)
        if response.status_code != 200:
            logger.error(f"Failed to get updates: {response.text}")
            response.raise_for_status()
        
        return response.json()
    
    def get_feed(self, email: str, limit: int = 15, after_timestamp: str = "2025-02-01T00:00:00Z") -> Dict[str, Any]:
        """Get user feed"""
        logger.info(f"Getting feed for user: {email}")
        
        headers = {
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        params = {
            "limit": limit,
            "after_timestamp": after_timestamp
        }
        
        response = requests.get(f"{API_BASE_URL}/me/feed", headers=headers, params=params)
        if response.status_code != 200:
            logger.error(f"Failed to get feed: {response.text}")
            response.raise_for_status()
        
        return response.json()
    
    def get_friends(self, email: str) -> Dict[str, Any]:
        """Get user's friends"""
        logger.info(f"Getting friends for user: {email}")
        
        headers = {
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        response = requests.get(f"{API_BASE_URL}/me/friends", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get friends: {response.text}")
            response.raise_for_status()
        
        return response.json()
    
    def add_friend(self, email: str, friend_id: str) -> Dict[str, Any]:
        """Add a friend"""
        logger.info(f"User {email} adding friend with ID: {friend_id}")
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        payload = {
            "friend_id": friend_id
        }
        
        response = requests.post(f"{API_BASE_URL}/friends", headers=headers, json=payload)
        if response.status_code != 200:
            logger.error(f"Failed to add friend: {response.text}")
            response.raise_for_status()
        
        data = response.json()
        # Store the friendship ID for later use
        if "id" in data:
            key = f"{email}_{friend_id}"
            self.friendship_ids[key] = data["id"]
            logger.info(f"Friendship created with ID: {self.friendship_ids[key]}")
        
        return data
    
    def accept_friend_request(self, email: str, friendship_id: str) -> Dict[str, Any]:
        """Accept a friend request"""
        logger.info(f"User {email} accepting friendship with ID: {friendship_id}")
        
        headers = {
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        response = requests.post(f"{API_BASE_URL}/friends/{friendship_id}/accept", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to accept friend request: {response.text}")
            response.raise_for_status()
        
        return response.json()
    
    def get_user_profile(self, email: str, user_id: str) -> Dict[str, Any]:
        """Get another user's profile"""
        logger.info(f"User {email} getting profile for user ID: {user_id}")
        
        headers = {
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        response = requests.get(f"{API_BASE_URL}/users/{user_id}/profile", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get user profile: {response.text}")
            response.raise_for_status()
        
        return response.json()
    
    def get_user_updates(self, email: str, user_id: str, limit: int = 10, after_timestamp: str = "2025-01-01T00:00:00Z") -> Dict[str, Any]:
        """Get another user's updates"""
        logger.info(f"User {email} getting updates for user ID: {user_id}")
        
        headers = {
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        params = {
            "limit": limit,
            "after_timestamp": after_timestamp
        }
        
        response = requests.get(f"{API_BASE_URL}/users/{user_id}/updates", headers=headers, params=params)
        if response.status_code != 200:
            logger.error(f"Failed to get user updates: {response.text}")
            response.raise_for_status()
        
        return response.json()
    
    def get_groups(self, email: str) -> Dict[str, Any]:
        """Get user's groups"""
        logger.info(f"Getting groups for user: {email}")
        
        headers = {
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        response = requests.get(f"{API_BASE_URL}/me/groups", headers=headers)
        if response.status_code != 200:
            logger.error(f"Failed to get groups: {response.text}")
            response.raise_for_status()
        
        return response.json()
    
    def create_group(self, email: str, name: str, description: str = "", avatar_url: str = "") -> Dict[str, Any]:
        """Create a new group"""
        logger.info(f"User {email} creating group: {name}")
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        payload = {
            "name": name,
            "description": description
        }
        
        if avatar_url:
            payload["avatar_url"] = avatar_url
        
        response = requests.post(f"{API_BASE_URL}/groups", headers=headers, json=payload)
        if response.status_code != 200:
            logger.error(f"Failed to create group: {response.text}")
            response.raise_for_status()
        
        data = response.json()
        # Store the group ID for later use
        if "id" in data:
            key = f"{email}_{name}"
            self.group_ids[key] = data["id"]
            logger.info(f"Group created with ID: {self.group_ids[key]}")
        
        return data
    
    def add_members_to_group(self, email: str, group_id: str, member_ids: List[str]) -> Dict[str, Any]:
        """Add members to a group"""
        logger.info(f"User {email} adding members to group ID: {group_id}")
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.tokens[email]}"
        }
        
        payload = {
            "member_ids": member_ids
        }
        
        response = requests.post(f"{API_BASE_URL}/groups/{group_id}/members", headers=headers, json=payload)
        if response.status_code != 200:
            logger.error(f"Failed to add members to group: {response.text}")
            response.raise_for_status()
        
        return response.json()


def run_demo():
    """Run a demonstration of the Village API automation"""
    api = VillageAPI()
    
    # Create users
    users = [
        {"email": "test1@test.com", "password": "testtest", "name": "Test User 1"},
        {"email": "test2@test.com", "password": "testtest", "name": "Test User 2"},
        {"email": "test3@test.com", "password": "testtest", "name": "Test User 3"}
    ]
    
    # Create and authenticate users
    for user in users:
        try:
            # Try to create the user
            api.create_user(user["email"], user["password"], user["name"])
        except requests.exceptions.HTTPError as e:
            # If user already exists, just authenticate
            if "EMAIL_EXISTS" in str(e):
                logger.warning(f"User {user['email']} already exists, authenticating instead")
                api.authenticate_user(user["email"], user["password"])
            else:
                raise
        
        # Create profile for each user
        profile_data = {
            "name": user["name"],
            "bio": f"This is {user['name']}'s bio",
            "avatar_url": f"https://example.com/avatar_{user['name'].replace(' ', '_').lower()}.jpg"
        }
        api.create_profile(user["email"], profile_data)
    
    # Wait a bit for profiles to be created
    logger.info("Waiting for profiles to be created...")
    time.sleep(2)
    
    # Get profiles
    for user in users:
        profile = api.get_profile(user["email"])
        logger.info(f"Profile for {user['email']}: {json.dumps(profile, indent=2)}")
    
    # Add friends (test1 adds test2 and test3)
    api.add_friend(users[0]["email"], api.user_ids[users[1]["email"]])
    api.add_friend(users[0]["email"], api.user_ids[users[2]["email"]])
    
    # Wait a bit for friend requests to be processed
    logger.info("Waiting for friend requests to be processed...")
    time.sleep(2)
    
    # Accept friend requests (test2 and test3 accept test1's requests)
    friendship_key_1 = f"{users[0]['email']}_{api.user_ids[users[1]['email']]}"
    friendship_key_2 = f"{users[0]['email']}_{api.user_ids[users[2]['email']]}"
    
    if friendship_key_1 in api.friendship_ids:
        api.accept_friend_request(users[1]["email"], api.friendship_ids[friendship_key_1])
    
    if friendship_key_2 in api.friendship_ids:
        api.accept_friend_request(users[2]["email"], api.friendship_ids[friendship_key_2])
    
    # Wait a bit for friend acceptances to be processed
    logger.info("Waiting for friend acceptances to be processed...")
    time.sleep(2)
    
    # Get friends list for each user
    for user in users:
        friends = api.get_friends(user["email"])
        logger.info(f"Friends for {user['email']}: {json.dumps(friends, indent=2)}")
    
    # Create a group (test1 creates a family group)
    group = api.create_group(
        users[0]["email"],
        "Family Group",
        "A group for family members",
        "https://example.com/avatar_family.jpg"
    )
    
    # Wait a bit for group creation to be processed
    logger.info("Waiting for group creation to be processed...")
    time.sleep(2)
    
    # Add members to the group (test1 adds test2 and test3)
    group_key = f"{users[0]['email']}_Family Group"
    if group_key in api.group_ids:
        api.add_members_to_group(
            users[0]["email"],
            api.group_ids[group_key],
            [api.user_ids[users[1]["email"]], api.user_ids[users[2]["email"]]]
        )
    
    # Get groups for each user
    for user in users:
        groups = api.get_groups(user["email"])
        logger.info(f"Groups for {user['email']}: {json.dumps(groups, indent=2)}")
    
    # Get updates and feeds
    for user in users:
        updates = api.get_updates(user["email"])
        logger.info(f"Updates for {user['email']}: {json.dumps(updates, indent=2)}")
        
        feed = api.get_feed(user["email"])
        logger.info(f"Feed for {user['email']}: {json.dumps(feed, indent=2)}")


if __name__ == "__main__":
    try:
        run_demo()
        logger.info("Demo completed successfully!")
    except Exception as e:
        logger.error(f"Demo failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
