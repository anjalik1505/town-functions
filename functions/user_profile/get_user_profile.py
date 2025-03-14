from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, SummaryFields
from models.data_models import ProfileResponse, Summary
from utils.logging_utils import get_logger


def get_user_profile(request, user_id) -> ProfileResponse:
    """
    Retrieves a user's profile with summary and suggestions.
    
    This function fetches the profile of the specified user, including their basic profile
    information and aggregated summary data. Summary data is collected from shared groups
    and direct chats between the current user and the requested user. The function enforces
    friendship checks to ensure only friends can view each other's profiles.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
        user_id: The ID of the user whose profile is being requested
    
    Returns:
        A ProfileResponse containing:
        - Basic profile information (id, name, avatar)
        - Aggregated summary information from shared contexts
        - Personalized suggestions
    
    Raises:
        400: If the user tries to view their own profile through this endpoint.
        404: If the target user profile does not exist.
        403: If the requesting user and target user are not friends.
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving profile for user {user_id} requested by {request.user_id}")

    db = firestore.client()
    current_user_id = request.user_id

    # Redirect users to the appropriate endpoint for their own profile
    if current_user_id == user_id:
        logger.warning(f"User {current_user_id} attempted to view their own profile through /user endpoint")
        abort(400, "Use /me/profile endpoint to view your own profile")

    try:
        # Get the target user's profile
        target_user_profile_ref = db.collection(Collections.PROFILES).document(user_id)
        target_user_profile_doc = target_user_profile_ref.get()

        # Check if the target profile exists
        if not target_user_profile_doc.exists:
            logger.warning(f"Profile not found for user {user_id}")
            abort(404, "Profile not found")

        target_user_profile_data = target_user_profile_doc.to_dict() or {}

        # Check if users are friends
        current_user_profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
        friend_ref = current_user_profile_ref.collection(Collections.FRIENDS).document(user_id)
        is_friend = friend_ref.get().exists

        # If they are not friends, return an error
        if not is_friend:
            logger.warning(f"User {current_user_id} attempted to view profile of non-friend {user_id}")
            abort(403, "You must be friends with this user to view their profile")

        logger.info(f"Friendship verified between {current_user_id} and {user_id}")

        # Initialize empty lists to collect all summary data
        emotional_journey_parts = []
        key_moments_parts = []
        recurring_themes_parts = []
        progress_and_growth_parts = []
        suggestions_parts = []

        # Get current user's groups
        current_user_profile_doc = current_user_profile_ref.get()
        current_user_profile = current_user_profile_doc.to_dict() or {}
        current_user_groups = current_user_profile.get(ProfileFields.GROUP_IDS, [])

        # Get target user's groups
        target_user_groups = target_user_profile_data.get(ProfileFields.GROUP_IDS, [])

        # Find groups that both users are members of
        shared_groups = list(set(current_user_groups) & set(target_user_groups))
        logger.info(f"Found {len(shared_groups)} shared groups between users {current_user_id} and {user_id}")

        # Collect summary data from each shared group
        if shared_groups:
            for group_id in shared_groups:
                logger.info(f"Processing summary data from group {group_id}")
                summary_ref = db.collection(Collections.GROUPS).document(group_id).collection(
                    Collections.USER_SUMMARIES).document(user_id)
                summary_doc = summary_ref.get()

                if summary_doc.exists:
                    summary_data = summary_doc.to_dict() or {}

                    # Extract and format summary data from this group
                    if SummaryFields.EMOTIONAL_JOURNEY in summary_data and summary_data[
                        SummaryFields.EMOTIONAL_JOURNEY]:
                        emotional_journey_parts.append(summary_data[SummaryFields.EMOTIONAL_JOURNEY])

                    if SummaryFields.KEY_MOMENTS in summary_data and summary_data[SummaryFields.KEY_MOMENTS]:
                        key_moments_parts.append(summary_data[SummaryFields.KEY_MOMENTS])

                    if SummaryFields.RECURRING_THEMES in summary_data and summary_data[SummaryFields.RECURRING_THEMES]:
                        recurring_themes_parts.append(summary_data[SummaryFields.RECURRING_THEMES])

                    if SummaryFields.PROGRESS_AND_GROWTH in summary_data and summary_data[
                        SummaryFields.PROGRESS_AND_GROWTH]:
                        progress_and_growth_parts.append(summary_data[SummaryFields.PROGRESS_AND_GROWTH])

                    if SummaryFields.SUGGESTIONS in summary_data and summary_data[SummaryFields.SUGGESTIONS]:
                        if isinstance(summary_data[SummaryFields.SUGGESTIONS], list):
                            for suggestion in summary_data[SummaryFields.SUGGESTIONS]:
                                suggestions_parts.append(suggestion)
                        else:
                            suggestions_parts.append(summary_data[SummaryFields.SUGGESTIONS])

        # Check for direct chat between the two users
        user_ids = sorted([current_user_id, user_id])
        chat_id = f"{user_ids[0]}_{user_ids[1]}"
        logger.info(f"Checking direct chat with ID {chat_id}")

        # Try to get the direct chat document
        chat_ref = db.collection(Collections.CHATS).document(chat_id)
        chat_doc = chat_ref.get()

        # Collect summary data from direct chat if it exists
        if chat_doc.exists:
            logger.info(f"Found direct chat between users {current_user_id} and {user_id}")
            # Fetch the summary for the requested user from the chat's summaries collection
            summary_ref = chat_ref.collection(Collections.SUMMARIES).document(user_id)
            summary_doc = summary_ref.get()

            if summary_doc.exists:
                summary_data = summary_doc.to_dict() or {}

                # Extract and format summary data from direct chat
                if SummaryFields.EMOTIONAL_JOURNEY in summary_data and summary_data[SummaryFields.EMOTIONAL_JOURNEY]:
                    emotional_journey_parts.append(summary_data[SummaryFields.EMOTIONAL_JOURNEY])

                if SummaryFields.KEY_MOMENTS in summary_data and summary_data[SummaryFields.KEY_MOMENTS]:
                    key_moments_parts.append(summary_data[SummaryFields.KEY_MOMENTS])

                if SummaryFields.RECURRING_THEMES in summary_data and summary_data[SummaryFields.RECURRING_THEMES]:
                    recurring_themes_parts.append(summary_data[SummaryFields.RECURRING_THEMES])

                if SummaryFields.PROGRESS_AND_GROWTH in summary_data and summary_data[
                    SummaryFields.PROGRESS_AND_GROWTH]:
                    progress_and_growth_parts.append(summary_data[SummaryFields.PROGRESS_AND_GROWTH])

                if SummaryFields.SUGGESTIONS in summary_data and summary_data[SummaryFields.SUGGESTIONS]:
                    if isinstance(summary_data[SummaryFields.SUGGESTIONS], list):
                        for suggestion in summary_data[SummaryFields.SUGGESTIONS]:
                            suggestions_parts.append(suggestion)
                    else:
                        suggestions_parts.append(summary_data[SummaryFields.SUGGESTIONS])

        # Combine all parts with empty lines in between
        emotional_journey = "\n\n".join(emotional_journey_parts)
        key_moments = "\n\n".join(key_moments_parts)
        recurring_themes = "\n\n".join(recurring_themes_parts)
        progress_and_growth = "\n\n".join(progress_and_growth_parts)
        suggestions = suggestions_parts  # Keep as a list

        logger.info(f"Successfully aggregated profile data for user {user_id}")

        # Construct and return the profile response
        return ProfileResponse(
            id=user_id,
            name=target_user_profile_data.get(ProfileFields.NAME, ''),
            avatar=target_user_profile_data.get(ProfileFields.AVATAR, ''),
            summary=Summary(
                emotional_journey=emotional_journey,
                key_moments=key_moments,
                recurring_themes=recurring_themes,
                progress_and_growth=progress_and_growth
            ),
            suggestions=suggestions
        )
    except Exception as e:
        logger.error(f"Error retrieving profile for user {user_id}: {str(e)}", exc_info=True)
        abort(500, "Internal server error while retrieving user profile")
