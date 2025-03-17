from firebase_admin import firestore
from flask import Request, abort
from models.constants import (
    Collections,
    GroupFields,
    ProfileFields,
    QueryOperators,
    Status,
    FriendshipFields,
)
from models.data_models import Group
from utils.logging_utils import get_logger


def add_members_to_group(request: Request, group_id: str) -> Group:
    """
    Add new members to an existing group.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: The validated request parameters containing:
                    - members: List of user IDs to add to the group
        group_id: The ID of the group to add members to

    Returns:
        Group: A response object with the updated group data

    Raises:
        400: Members are not all friends with each other
        403: User is not a member of the group
        404: Group not found or member profile not found
        500: Internal server error
    """
    logger = get_logger(__name__)
    logger.info(f"Adding members to group: {group_id}")

    # Get the current user ID from the request (set by authentication middleware)
    current_user_id = request.user_id

    # Get the validated request data
    validated_params = request.validated_params

    # Extract new members to add
    new_members = validated_params.members if validated_params.members else []

    if not new_members:
        logger.warning("No members provided to add to the group")
        abort(400, description="No members provided to add to the group")

    db = firestore.client()

    # 1. Check if the group exists and the current user is a member
    group_ref = db.collection(Collections.GROUPS).document(group_id)
    group_doc = group_ref.get()

    if not group_doc.exists:
        logger.warning(f"Group {group_id} not found")
        abort(404, description=f"Group not found")

    group_data = group_doc.to_dict()
    current_members = group_data.get(GroupFields.MEMBERS, [])

    if current_user_id not in current_members:
        logger.warning(f"User {current_user_id} is not a member of group {group_id}")
        abort(403, description="You must be a member of the group to add new members")

    # 2. Filter out members who are already in the group
    new_members_to_add = [
        member_id for member_id in new_members if member_id not in current_members
    ]

    if not new_members_to_add:
        logger.warning("All provided members are already in the group")
        abort(400, description="All provided members are already in the group")

    # 3. Verify new members exist
    new_member_profile_refs = [
        db.collection(Collections.PROFILES).document(member_id)
        for member_id in new_members_to_add
    ]
    new_member_profiles = db.get_all(new_member_profile_refs)

    # Check if all new member profiles exist
    missing_members = []
    for i, profile_snapshot in enumerate(new_member_profiles):
        if not profile_snapshot.exists:
            missing_members.append(new_members_to_add[i])

    if missing_members:
        missing_members_str = ", ".join(missing_members)
        logger.warning(f"Member profiles not found: {missing_members_str}")
        abort(404, description=f"Member profiles not found: {missing_members_str}")

    # 4. Optimized friendship check using batch fetching
    # We need to verify that all new members are friends with all existing members

    # Create a dictionary to track friendships
    # Key: tuple of (user1_id, user2_id) where user1_id < user2_id (for consistent ordering)
    # Value: True if friendship exists, False otherwise
    friendship_exists = {}

    # Initialize all possible member pairs as not friends
    for new_member_id in new_members_to_add:
        for current_member_id in current_members:
            # Skip self-comparison
            if new_member_id == current_member_id:
                continue
            # Ensure consistent ordering of the pair
            pair = (
                (new_member_id, current_member_id)
                if new_member_id < current_member_id
                else (current_member_id, new_member_id)
            )
            friendship_exists[pair] = False

    # Combine all members that need to be checked
    all_members_to_check = list(set(new_members_to_add + current_members))
    # Firestore allows up to 10 values in array_contains_any
    # We'll process members in batches of 10 if needed
    batch_size = 10
    for i in range(0, len(all_members_to_check), batch_size):
        batch_members = all_members_to_check[i : i + batch_size]

        # Fetch all friendships where any of the batch members is in the members array
        friendships_query = (
            db.collection(Collections.FRIENDSHIPS)
            .where(
                FriendshipFields.MEMBERS,
                QueryOperators.ARRAY_CONTAINS_ANY,
                batch_members,
            )
            .where(FriendshipFields.STATUS, QueryOperators.EQUALS, Status.ACCEPTED)
            .get()
        )

        logger.info(
            f"Fetched {len(list(friendships_query))} friendships for batch of {len(batch_members)} members"
        )

        # Process each friendship to mark member pairs as friends
        for doc in friendships_query:
            friendship_data = doc.to_dict()
            members_in_friendship = friendship_data.get(FriendshipFields.MEMBERS, [])

            # Check which members are in this friendship
            for member1 in members_in_friendship:
                for member2 in members_in_friendship:
                    if member1 < member2:  # Only process each pair once
                        pair = (member1, member2)
                        if pair in friendship_exists:
                            friendship_exists[pair] = True

    # Check if any required member pairs are not friends
    not_friends = []
    for pair, exists in friendship_exists.items():
        if not exists:
            not_friends.append(pair)

    if not_friends:
        # Format the error message
        not_friends_str = ", ".join(
            [f"{pair[0]} and {pair[1]}" for pair in not_friends]
        )
        logger.warning(f"Members are not friends: {not_friends_str}")
        abort(
            400,
            description="All members must be friends with each other to be in the same group",
        )

    # All validations passed, now update the group

    # Create a batch operation for all database writes
    batch = db.batch()

    # Update the group with the new members
    updated_members = current_members + new_members_to_add

    # Get the existing member profiles
    existing_member_profiles = group_data.get(GroupFields.MEMBER_PROFILES, [])

    # Get profile information for new members to add to denormalized data
    new_member_profile_data = []
    for profile_snapshot in new_member_profiles:
        if profile_snapshot.exists:
            profile_data = profile_snapshot.to_dict()
            new_member_profile_data.append(
                {
                    ProfileFields.USER_ID: profile_snapshot.id,
                    ProfileFields.USERNAME: profile_data.get(
                        ProfileFields.USERNAME, ""
                    ),
                    ProfileFields.NAME: profile_data.get(ProfileFields.NAME, ""),
                    ProfileFields.AVATAR: profile_data.get(ProfileFields.AVATAR, ""),
                }
            )

    # Combine existing and new member profiles
    updated_member_profiles = existing_member_profiles + new_member_profile_data

    # Update the group document with both members array and denormalized profiles
    batch.update(
        group_ref,
        {
            GroupFields.MEMBERS: updated_members,
            GroupFields.MEMBER_PROFILES: updated_member_profiles,
        },
    )
    logger.info(f"Adding {len(new_members_to_add)} new members to group {group_id}")

    # Add the group ID to each new member's profile
    for member_id in new_members_to_add:
        profile_ref = db.collection(Collections.PROFILES).document(member_id)
        batch.update(
            profile_ref, {ProfileFields.GROUP_IDS: firestore.ArrayUnion([group_id])}
        )
        logger.info(f"Adding group {group_id} to member {member_id}'s profile")

    # Execute the batch operation
    batch.commit()
    logger.info(
        f"Batch committed successfully: updated group {group_id} and member profiles"
    )

    # Get the updated group data
    updated_group_doc = group_ref.get()
    updated_group_data = updated_group_doc.to_dict()

    # Return the updated group data
    return Group(
        group_id=group_id,
        name=updated_group_data.get(GroupFields.NAME, ""),
        icon=updated_group_data.get(GroupFields.ICON, ""),
        members=updated_group_data.get(GroupFields.MEMBERS, []),
        member_profiles=updated_group_data.get(GroupFields.MEMBER_PROFILES, []),
        created_at=updated_group_data.get(GroupFields.CREATED_AT, ""),
    )
