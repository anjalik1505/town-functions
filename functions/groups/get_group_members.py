from firebase_admin import firestore
from flask import Request, abort
from models.constants import Collections, GroupFields, ProfileFields
from models.data_models import GroupMember, GroupMembersResponse
from utils.logging_utils import get_logger


def get_group_members(request: Request, group_id: str) -> GroupMembersResponse:
    """
    Retrieves all members of a specific group with their basic profile information.

    This function fetches the group document to get the member information. If the group
    has denormalized member_profiles, it uses that data directly.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
        group_id: The ID of the group to retrieve members for

    Returns:
        A GroupMembersResponse containing:
        - A list of GroupMember objects with each member's profile information

    Raises:
        404: Group not found
        403: User is not a member of the group
        500: Internal server error
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving members for group: {group_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Get the group document
    group_ref = db.collection(Collections.GROUPS).document(group_id)
    group_doc = group_ref.get()

    if not group_doc.exists:
        logger.warning(f"Group {group_id} not found")
        abort(404, description="Group not found")

    group_data = group_doc.to_dict()
    members_ids = group_data.get(GroupFields.MEMBERS, [])

    # Check if the current user is a member of the group
    if current_user_id not in members_ids:
        logger.warning(f"User {current_user_id} is not a member of group {group_id}")
        abort(403, description="You must be a member of the group to view its members")

    members = []

    # Check if we have denormalized member profiles available
    member_profiles = group_data.get(GroupFields.MEMBER_PROFILES, [])

    if member_profiles:
        # Use the denormalized data
        logger.info(f"Using denormalized member profiles for group: {group_id}")
        for profile in member_profiles:
            members.append(
                GroupMember(
                    id=profile.get(ProfileFields.ID, ""),
                    name=profile.get(ProfileFields.NAME, ""),
                    avatar=profile.get(ProfileFields.AVATAR, ""),
                )
            )

    logger.info(f"Retrieved {len(members)} members for group: {group_id}")

    # Return the list of members
    return GroupMembersResponse(members=members)
