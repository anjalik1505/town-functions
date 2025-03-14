from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, SummaryFields, Documents
from models.data_models import ProfileResponse, Summary


def add_user(request):
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
    """
    # Get the authenticated user ID from the request
    user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Check if profile already exists
    profile_ref = db.collection(Collections.PROFILES.value).document(request.user_id)

    if profile_ref.get().exists:
        abort(400, description=f"Profile already exists for user {request.user_id}")

    # Create an empty profile according to the schema
    profile_data = {
        ProfileFields.NAME.value: '',
        ProfileFields.AVATAR.value: '',
        ProfileFields.EMAIL.value: '',
        ProfileFields.GROUP_IDS.value: []  # Added based on get_my_feeds.py
    }

    # Create the profile document
    profile_ref.set(profile_data)

    # Create an empty summary subcollection document
    summary_ref = profile_ref.collection(Collections.SUMMARY.value).document(Documents.DEFAULT_SUMMARY.value)
    summary_data = {
        SummaryFields.EMOTIONAL_JOURNEY.value: '',
        SummaryFields.KEY_MOMENTS.value: '',
        SummaryFields.RECURRING_THEMES.value: '',
        SummaryFields.PROGRESS_AND_GROWTH.value: '',
        SummaryFields.SUGGESTIONS.value: []
    }
    summary_ref.set(summary_data)

    # We don't need to create any documents in the friends subcollection initially,
    # but we can create the collection structure by adding and then deleting a placeholder document
    # This is optional as Firestore creates collections lazily when the first document is added
    friends_ref = profile_ref.collection(Collections.FRIENDS.value)
    friend_requests_ref = profile_ref.collection(Collections.FRIEND_REQUESTS.value)

    # If we want to ensure the collections exist (optional)
    # Create and immediately delete a placeholder document
    placeholder_data = {'placeholder': True}

    # For friends collection
    placeholder_doc = friends_ref.document('placeholder')
    placeholder_doc.set(placeholder_data)
    placeholder_doc.delete()

    # For friend_requests collection
    placeholder_doc = friend_requests_ref.document('placeholder')
    placeholder_doc.set(placeholder_data)
    placeholder_doc.delete()

    # Return a properly formatted response
    summary = Summary(
        emotional_journey='',
        key_moments='',
        recurring_themes='',
        progress_and_growth=''
    )

    response = ProfileResponse(
        id=user_id,
        name='',
        avatar='',
        summary=summary,
        suggestions=[]
    )

    return response
