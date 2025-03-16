from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, InsightsFields, Documents
from models.data_models import ProfileResponse, Insights
from utils.logging_utils import get_logger


def create_profile(request):
    """
    Creates a new profile for the authenticated user.

    This function checks if a profile already exists for the authenticated user.
    If it does, it aborts with a 400 error. Otherwise, it creates a new empty
    profile according to the schema and initializes related collections.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: Profile data including:
                    - username: Mandatory username for the user
                    - name: Optional display name
                    - avatar: Optional avatar URL
                    - location: Optional location information
                    - birthday: Optional birthday in ISO format
                    - notification_settings: Optional list of notification preferences

    Returns:
        A ProfileResponse containing:
        - Basic profile information (id, username, name, avatar)
        - Optional profile fields (location, birthday, notification_settings)
        - Empty insights, summary, suggestions information

    Raises:
        400: If a profile already exists for the authenticated user
    """
    logger = get_logger(__name__)
    logger.info(f"Starting add_user operation for user ID: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Get the validated profile data
    profile_data_input = request.validated_params

    # Initialize Firestore client
    db = firestore.client()

    # Check if profile already exists
    profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
    profile_doc = profile_ref.get()

    if profile_doc.exists:
        logger.warning(f"Profile already exists for user {current_user_id}")
        abort(400, description=f"Profile already exists for user {current_user_id}")

    logger.info(f"Creating new profile for user {current_user_id}")

    # Create profile with provided data
    profile_data = {
        ProfileFields.USERNAME: profile_data_input.username,
        ProfileFields.NAME: profile_data_input.name or "",
        ProfileFields.AVATAR: profile_data_input.avatar or "",
        ProfileFields.LOCATION: profile_data_input.location or "",
        ProfileFields.BIRTHDAY: profile_data_input.birthday or "",
        ProfileFields.NOTIFICATION_SETTINGS: profile_data_input.notification_settings
        or [],
        ProfileFields.SUMMARY: "",
        ProfileFields.SUGGESTIONS: "",
        ProfileFields.GROUP_IDS: [],
    }

    # Create the profile document
    profile_ref.set(profile_data)
    logger.info(f"Profile document created for user {current_user_id}")

    # Create an empty insights subcollection document
    insights_ref = profile_ref.collection(Collections.INSIGHTS).document(
        Documents.DEFAULT_INSIGHTS
    )
    insights_data = {
        InsightsFields.EMOTIONAL_OVERVIEW: "",
        InsightsFields.KEY_MOMENTS: "",
        InsightsFields.RECURRING_THEMES: "",
        InsightsFields.PROGRESS_AND_GROWTH: "",
    }
    insights_ref.set(insights_data)
    logger.info(f"Insights document created for user {current_user_id}")

    # Return a properly formatted response
    insights = Insights(
        emotional_overview="",
        key_moments="",
        recurring_themes="",
        progress_and_growth="",
    )

    response = ProfileResponse(
        user_id=current_user_id,
        username=profile_data[ProfileFields.USERNAME],
        name=profile_data[ProfileFields.NAME],
        avatar=profile_data[ProfileFields.AVATAR],
        location=profile_data[ProfileFields.LOCATION],
        birthday=profile_data[ProfileFields.BIRTHDAY],
        notification_settings=profile_data[ProfileFields.NOTIFICATION_SETTINGS],
        summary="",
        suggestions="",
        insights=insights,
    )

    logger.info(
        f"User profile creation completed successfully for user {current_user_id}"
    )
    return response
