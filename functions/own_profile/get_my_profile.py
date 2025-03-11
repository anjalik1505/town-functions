from firebase_admin import firestore
from flask import abort

from functions.data_models import ProfileResponse, Summary


def get_my_profile(request) -> ProfileResponse:
    """
    Retrieves the current user's profile.
    
    Returns:
    - A ProfileResponse object containing the user's profile data
    """
    db = firestore.client()
    profile_ref = db.collection('profiles').document(request.user_id)

    if not profile_ref.get().exists:
        abort(404, "Profile not found")

    profile_data = profile_ref.get().to_dict() or {}

    summary_doc = next(profile_ref.collection('summary').limit(1).stream(), None)
    summary_data = summary_doc.to_dict() if summary_doc else {}

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
