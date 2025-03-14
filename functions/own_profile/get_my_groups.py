from firebase_admin import firestore
from flask import abort
from models.constants import Collections, GroupFields
from models.data_models import GroupsResponse, Group
from utils.logging_utils import get_logger


def get_my_groups(request) -> GroupsResponse:
    """
    Retrieves all groups where the current user is a member.
    
    This function queries the groups collection to find all groups that have the 
    authenticated user's ID in their members array. For each group, it retrieves 
    the basic information (groupId, name, icon, created_at).
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
    
    Returns:
        A GroupsResponse containing:
        - A list of Group objects with basic information for each group
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving groups for user: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    try:
        # Query for groups where the current user is a member
        groups_query = db.collection(Collections.GROUPS) \
            .where(GroupFields.MEMBERS, "array-contains", current_user_id) \
            .stream()

        logger.info(f"Querying groups for user: {current_user_id}")

        groups = []

        for doc in groups_query:
            group_id = doc.id
            group_data = doc.to_dict() or {}
            logger.info(f"Processing group: {group_id}")

            groups.append(Group(
                groupId=group_id,
                name=group_data.get(GroupFields.NAME, ""),
                icon=group_data.get(GroupFields.ICON, ""),
                members=group_data.get(GroupFields.MEMBERS, []),
                created_at=group_data.get(GroupFields.CREATED_AT, "")
            ))
            logger.info(f"Added group {group_id} to results")

        logger.info(f"Retrieved {len(groups)} groups for user: {current_user_id}")

        # Return the list of groups
        return GroupsResponse(
            groups=groups
        )
    except Exception as e:
        logger.error(f"Error retrieving groups for user {current_user_id}: {str(e)}", exc_info=True)
        # Use abort instead of returning empty response
        abort(500, "Internal server error")
