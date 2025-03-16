from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, SummaryFields, Documents
from models.data_models import ProfileResponse, Summary
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

    Returns:
        A ProfileResponse containing:
        - Basic profile information (id, name, avatar)
        - Empty summary information

    Raises:
        400: If a profile already exists for the authenticated user
        500: Server error during profile creation
    """
    logger = get_logger(__name__)
    logger.info(f"Starting add_user operation for user ID: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Check if profile already exists
    profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
    profile_doc = profile_ref.get()

    if profile_doc.exists:
        logger.warning(f"Profile already exists for user {current_user_id}")
        abort(400, description=f"Profile already exists for user {current_user_id}")

    logger.info(f"Creating new profile for user {current_user_id}")

    # Create an empty profile according to the schema
    profile_data = {
        ProfileFields.NAME: "",
        ProfileFields.AVATAR: "",
        ProfileFields.EMAIL: "",
        ProfileFields.GROUP_IDS: [],
    }

    # Create the profile document
    profile_ref.set(profile_data)
    logger.info(f"Profile document created for user {current_user_id}")

    # Create an empty summary subcollection document
    summary_ref = profile_ref.collection(Collections.SUMMARY).document(
        Documents.DEFAULT_SUMMARY
    )
    summary_data = {
        SummaryFields.EMOTIONAL_JOURNEY: "",
        SummaryFields.KEY_MOMENTS: "",
        SummaryFields.RECURRING_THEMES: "",
        SummaryFields.PROGRESS_AND_GROWTH: "",
        SummaryFields.SUGGESTIONS: [],
    }
    summary_ref.set(summary_data)
    logger.info(f"Summary document created for user {current_user_id}")

    # Return a properly formatted response
    summary = Summary(
        emotional_journey="",
        key_moments="",
        recurring_themes="",
        progress_and_growth="",
    )

    response = ProfileResponse(
        user_id=current_user_id,
        user_name="",
        user_avatar="",
        summary=summary,
        suggestions=[],
    )

    logger.info(
        f"User profile creation completed successfully for user {current_user_id}"
    )
    return response
