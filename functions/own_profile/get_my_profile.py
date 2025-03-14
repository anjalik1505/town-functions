from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, SummaryFields, Documents
from models.data_models import ProfileResponse, Summary


def get_my_profile(request) -> ProfileResponse:
    """
    Retrieves the current user's profile.
    
    Returns:
    - A ProfileResponse object containing the user's profile data
    """
    db = firestore.client()
    profile_ref = db.collection(Collections.PROFILES.value).document(request.user_id)

    if not profile_ref.get().exists:
        abort(404, "Profile not found")

    profile_data = profile_ref.get().to_dict() or {}

    summary_doc = next(profile_ref.collection(Collections.SUMMARY.value).limit(1).stream(), None)
    summary_data = summary_doc.to_dict() if summary_doc else {}

    return ProfileResponse(
        id=request.user_id,
        name=profile_data.get(ProfileFields.NAME.value, ''),
        avatar=profile_data.get(ProfileFields.AVATAR.value, ''),
        summary=Summary(
            emotional_journey=summary_data.get(SummaryFields.EMOTIONAL_JOURNEY.value, ''),
            key_moments=summary_data.get(SummaryFields.KEY_MOMENTS.value, ''),
            recurring_themes=summary_data.get(SummaryFields.RECURRING_THEMES.value, ''),
            progress_and_growth=summary_data.get(SummaryFields.PROGRESS_AND_GROWTH.value, '')
        ),
        suggestions=summary_data.get(SummaryFields.SUGGESTIONS.value, [])
    )
