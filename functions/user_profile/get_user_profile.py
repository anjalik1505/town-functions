from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, SummaryFields
from models.data_models import ProfileResponse, Summary


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
    db = firestore.client()
    current_user_id = request.user_id

    # Redirect users to the appropriate endpoint for their own profile
    if current_user_id == user_id:
        abort(400, "Use /me/profile endpoint to view your own profile")

    # Get the target user's profile
    target_user_profile_ref = db.collection(Collections.PROFILES).document(user_id)
    target_user_profile_doc = target_user_profile_ref.get()

    # Check if the target profile exists
    if not target_user_profile_doc.exists:
        abort(404, "Profile not found")

    target_user_profile_data = target_user_profile_doc.to_dict() or {}

    # Check if users are friends
    current_user_profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
    friend_ref = current_user_profile_ref.collection(Collections.FRIENDS).document(user_id)
    is_friend = friend_ref.get().exists

    # If they are not friends, return an error
    if not is_friend:
        abort(403, "You must be friends with this user to view their profile")

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

    # Collect summary data from each shared group
    if shared_groups:
        for group_id in shared_groups:
            summary_ref = db.collection(Collections.GROUPS).document(group_id).collection(
                Collections.USER_SUMMARIES).document(user_id)
            summary_doc = summary_ref.get()

            if summary_doc.exists:
                summary_data = summary_doc.to_dict() or {}

                # Extract and format summary data from this group
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

    # Check for direct chat between the two users
    user_ids = sorted([current_user_id, user_id])
    chat_id = f"{user_ids[0]}_{user_ids[1]}"

    # Try to get the direct chat document
    chat_ref = db.collection(Collections.CHATS).document(chat_id)
    chat_doc = chat_ref.get()

    # Collect summary data from direct chat if it exists
    if chat_doc.exists:
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

            if SummaryFields.PROGRESS_AND_GROWTH in summary_data and summary_data[SummaryFields.PROGRESS_AND_GROWTH]:
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

    # TODO: Implement AI aggregation to shorten and combine the summaries
    # This would involve calling an AI service to process the combined summaries
    # and generate a more concise version
    #
    # Example pseudocode:
    # aggregated_emotional_journey = ai_service.aggregate(emotional_journey)
    # aggregated_key_moments = ai_service.aggregate(key_moments)
    # aggregated_recurring_themes = ai_service.aggregate(recurring_themes)
    # aggregated_progress_and_growth = ai_service.aggregate(progress_and_growth)
    # aggregated_suggestions = ai_service.aggregate_suggestions(suggestions)

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
