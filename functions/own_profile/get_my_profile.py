from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, InsightsFields
from models.data_models import ProfileResponse, Insights
from utils.logging_utils import get_logger


def get_my_profile(request) -> ProfileResponse:
    """
    Retrieves the current user's profile with insights information.

    This function:
    1. Fetches the authenticated user's profile data from Firestore
    2. Retrieves any available insights data
    3. Combines the data into a comprehensive profile response

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)

    Returns:
        A ProfileResponse containing:
        - Basic profile information (id, username, name, avatar)
        - Optional profile fields (location, birthday, notification_settings, summary, suggestions)
        - Insights information (emotional overview, key moments, themes, growth)

    Raises:
        404: Profile not found
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving profile for user: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Get the user's profile document
    profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
    profile_doc = profile_ref.get()

    # Check if the profile exists
    if not profile_doc.exists:
        logger.warning(f"Profile not found for user: {current_user_id}")
        abort(404, "Profile not found")

    # Extract profile data
    profile_data = profile_doc.to_dict() or {}
    logger.info(f"Retrieved profile data for user: {current_user_id}")

    # Get insights data - using collection().limit(1) instead of direct document reference
    # as we're not sure which document to use
    insights_doc = next(
        profile_ref.collection(Collections.INSIGHTS).limit(1).stream(), None
    )
    insights_data = insights_doc.to_dict() if insights_doc else {}
    logger.info(f"Retrieved insights data for user: {current_user_id}")

    # Construct and return the profile response
    return ProfileResponse(
        user_id=current_user_id,
        username=profile_data.get(ProfileFields.USERNAME, ""),
        name=profile_data.get(ProfileFields.NAME, None),
        avatar=profile_data.get(ProfileFields.AVATAR, None),
        location=profile_data.get(ProfileFields.LOCATION, None),
        birthday=profile_data.get(ProfileFields.BIRTHDAY, None),
        notification_settings=profile_data.get(
            ProfileFields.NOTIFICATION_SETTINGS, None
        ),
        summary=profile_data.get(ProfileFields.SUMMARY, None),
        suggestions=profile_data.get(ProfileFields.SUGGESTIONS, None),
        insights=Insights(
            emotional_overview=insights_data.get(InsightsFields.EMOTIONAL_OVERVIEW, ""),
            key_moments=insights_data.get(InsightsFields.KEY_MOMENTS, ""),
            recurring_themes=insights_data.get(InsightsFields.RECURRING_THEMES, ""),
            progress_and_growth=insights_data.get(
                InsightsFields.PROGRESS_AND_GROWTH, ""
            ),
        ),
    )
