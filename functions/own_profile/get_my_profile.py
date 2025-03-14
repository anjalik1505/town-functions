from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, SummaryFields, Documents
from models.data_models import ProfileResponse, Summary
from utils.logging_utils import get_logger


def get_my_profile(request) -> ProfileResponse:
    """
    Retrieves the current user's profile with summary information.
    
    This function fetches the authenticated user's profile data from Firestore,
    including their basic profile information and any available summary data.
    The summary data includes emotional journey, key moments, recurring themes,
    progress and growth information, and personalized suggestions.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
    
    Returns:
        A ProfileResponse containing:
        - Basic profile information (id, name, avatar)
        - Summary information (emotional journey, key moments, themes, growth)
        - Personalized suggestions
    
    Raises:
        404: If the user's profile does not exist in the database
        500: If an unexpected error occurs during profile retrieval.
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving profile for user: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    try:
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

        # Get summary data - using collection().limit(1) instead of direct document reference
        # as we're not sure which document to use
        summary_doc = next(profile_ref.collection(Collections.SUMMARY).limit(1).stream(), None)
        summary_data = summary_doc.to_dict() if summary_doc else {}
        logger.info(f"Retrieved summary data for user: {current_user_id}")

        # Construct and return the profile response
        return ProfileResponse(
            id=current_user_id,
            name=profile_data.get(ProfileFields.NAME, ''),
            avatar=profile_data.get(ProfileFields.AVATAR, ''),
            summary=Summary(
                emotional_journey=summary_data.get(SummaryFields.EMOTIONAL_JOURNEY, ''),
                key_moments=summary_data.get(SummaryFields.KEY_MOMENTS, ''),
                recurring_themes=summary_data.get(SummaryFields.RECURRING_THEMES, ''),
                progress_and_growth=summary_data.get(SummaryFields.PROGRESS_AND_GROWTH, '')
            ),
            suggestions=summary_data.get(SummaryFields.SUGGESTIONS, [])
        )
    except Exception as e:
        logger.error(f"Error retrieving profile for user {current_user_id}: {str(e)}", exc_info=True)
        abort(500, "Internal server error while retrieving user profile")
