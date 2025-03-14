from firebase_admin import firestore
from flask import abort

from functions.data_models import ProfileResponse, Summary


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
    """
    db = firestore.client()

    # Get the user's profile document
    profile_ref = db.collection('profiles').document(request.user_id)
    profile_doc = profile_ref.get()

    # Check if the profile exists
    if not profile_doc.exists:
        abort(404, "Profile not found")

    # Extract profile data
    profile_data = profile_doc.to_dict() or {}

    # Get summary data from the summary subcollection
    summary_doc = next(profile_ref.collection('summary').limit(1).stream(), None)
    summary_data = summary_doc.to_dict() if summary_doc else {}

    # Construct and return the profile response
    return ProfileResponse(
        id=request.user_id,
        name=profile_data.get('name', ''),
        avatar=profile_data.get('avatar', ''),
        summary=Summary(
            emotional_journey=summary_data.get('emotional_journey', ''),
            key_moments=summary_data.get('key_moments', ''),
            recurring_themes=summary_data.get('recurring_themes', ''),
            progress_and_growth=summary_data.get('progress_and_growth', '')
        ),
        suggestions=summary_data.get('suggestions', [])
    )
