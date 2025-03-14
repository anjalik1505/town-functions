import datetime
import uuid

from firebase_admin import firestore
from flask import Request, abort
from google.cloud.firestore import SERVER_TIMESTAMP
from models.constants import Collections, GroupFields, ProfileFields, Status, FriendshipFields
from models.data_models import Group
from utils.logging_utils import get_logger


def create_group(request: Request) -> Group:
    """
    Create a new group, ensuring the current user is in the members list.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: The validated request parameters containing:
                    - name: The name of the group
                    - icon: (Optional) The icon for the group
                    - members: (Optional) List of user IDs to add to the group
        
    Returns:
        Group: A response object with the created group data
        
    Raises:
        400: Members are not all friends with each other
        404: Member profile not found
        500: Internal server error
    """
    logger = get_logger(__name__)
    logger.info(f"Creating new group with name: {request.validated_params.name}")

    # Get the current user ID from the request (set by authentication middleware)
    current_user_id = request.user_id

    # Get the validated request data
    validated_params = request.validated_params

    # Extract group data
    name = validated_params.name
    icon = validated_params.icon
    members = validated_params.members if validated_params.members else []

    # Ensure current user is in the members list
    if current_user_id not in members:
        members.append(current_user_id)

    try:
        db = firestore.client()

        # Skip current user in validation since we know they exist
        members_to_validate = [member_id for member_id in members if member_id != current_user_id]

        if members_to_validate:
            # 1. Verify members exist
            member_profile_refs = [db.collection(Collections.PROFILES).document(member_id) for member_id in
                                   members_to_validate]
            member_profiles = db.get_all(member_profile_refs)

            # Check if all member profiles exist
            missing_members = []
            for i, profile_snapshot in enumerate(member_profiles):
                if not profile_snapshot.exists:
                    missing_members.append(members_to_validate[i])

            if missing_members:
                missing_members_str = ", ".join(missing_members)
                logger.warning(f"Member profiles not found: {missing_members_str}")
                abort(404, description=f"Member profiles not found: {missing_members_str}")

            # 2. Optimized friendship check using batch fetching
            # We need to verify that all members are friends with each other

            # Create a dictionary to track friendships
            # Key: tuple of (user1_id, user2_id) where user1_id < user2_id (for consistent ordering)
            # Value: True if friendship exists, False otherwise
            friendship_exists = {}

            # Initialize all possible member pairs as not friends
            for i, member1 in enumerate(members):
                for j, member2 in enumerate(members):
                    if i < j:  # Only check each pair once
                        pair = (member1, member2) if member1 < member2 else (member2, member1)
                        friendship_exists[pair] = False

            # Firestore allows up to 10 values in array-contains-any
            # We'll process members in batches of 10 if needed
            batch_size = 10
            for i in range(0, len(members), batch_size):
                batch_members = members[i:i + batch_size]

                # Fetch all friendships where any of the batch members is in the members array
                friendships_query = db.collection(Collections.FRIENDSHIPS) \
                    .where(FriendshipFields.MEMBERS, "array-contains-any", batch_members) \
                    .where(FriendshipFields.STATUS, "==", Status.ACCEPTED) \
                    .get()

                logger.info(
                    f"Fetched {len(list(friendships_query))} friendships for batch of {len(batch_members)} members")

                # Process each friendship to mark member pairs as friends
                for doc in friendships_query:
                    friendship_data = doc.to_dict()
                    members_in_friendship = friendship_data.get(FriendshipFields.MEMBERS, [])

                    # Check which group members are in this friendship
                    friendship_group_members = [m for m in members if m in members_in_friendship]

                    # If we found at least 2 group members in this friendship, mark them as friends
                    if len(friendship_group_members) >= 2:
                        for x, member1 in enumerate(friendship_group_members):
                            for y, member2 in enumerate(friendship_group_members):
                                if x < y:  # Only process each pair once
                                    pair = (member1, member2) if member1 < member2 else (member2, member1)
                                    friendship_exists[pair] = True

            # Check if any member pairs are not friends
            not_friends = []
            for pair, exists in friendship_exists.items():
                if not exists:
                    not_friends.append(pair)

            if not_friends:
                # Format the error message
                not_friends_str = ", ".join([f"{pair[0]} and {pair[1]}" for pair in not_friends])
                logger.warning(f"Members are not friends: {not_friends_str}")
                abort(400, description="All members must be friends with each other to be in the same group")

        # All validations passed, now create the group

        # Generate a unique group ID
        group_id = str(uuid.uuid4())
        logger.info(f"Validation passed, creating group with ID: {group_id}")

        # Create the group document reference
        group_ref = db.collection(Collections.GROUPS).document(group_id)

        # Prepare group data
        group_data = {
            GroupFields.NAME: name,
            GroupFields.ICON: icon,
            GroupFields.MEMBERS: members,
            GroupFields.CREATED_AT: SERVER_TIMESTAMP
        }

        # Create a batch operation for all database writes
        batch = db.batch()

        # Add the group to Firestore
        batch.set(group_ref, group_data)
        logger.info(f"Adding group {group_id} with name '{name}' to batch")

        # Add the group ID to each member's profile
        for member_id in members:
            profile_ref = db.collection(Collections.PROFILES).document(member_id)
            batch.update(profile_ref, {
                ProfileFields.GROUP_IDS: firestore.ArrayUnion([group_id])
            })
            logger.info(f"Adding group {group_id} to member {member_id}'s profile in batch")

        # Execute the batch operation
        batch.commit()
        logger.info(f"Batch committed successfully: created group {group_id} and updated all member profiles")

        # For the response, we need to convert SERVER_TIMESTAMP to a string
        # Since SERVER_TIMESTAMP is only resolved when written to Firestore, we'll use current time for the response
        response_created_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

        # Return the created group data
        return Group(
            groupId=group_id,
            name=name,
            icon=icon,
            members=members,
            created_at=response_created_at
        )
    except Exception as e:
        logger.error(f"Error creating group: {str(e)}", exc_info=True)
        abort(500, description="Internal server error")
