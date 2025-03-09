from firebase_admin import firestore
from google.cloud.firestore import SERVER_TIMESTAMP

from functions.data_models import AddFriendResponse


def add_friend(request) -> AddFriendResponse:
    """
    Adds a friend directly (Option A - Immediate friend).
    
    Input:
    - friendId: The ID of the user to add as a friend
    
    Implementation:
    - In profiles/{currentUserId}/friends/{friendId} set:
      { "status": "accepted", "created_at": serverTimestamp() }
    - In profiles/{friendId}/friends/{currentUserId} do the same.
    
    Returns:
    - Success message
    """
    db = firestore.client()

    friend_id = request.validated_params.friendId
    current_user_id = request.user_id

    friend_profile_ref = db.collection("profiles").document(friend_id)
    friend_profile = friend_profile_ref.get()

    if not friend_profile.exists:
        return AddFriendResponse(
            status="error",
            message="Friend profile not found"
        )

    if friend_id == current_user_id:
        return AddFriendResponse(
            status="error",
            message="Cannot add yourself as a friend"
        )

    current_user_friend_ref = db.collection(f"profiles/{current_user_id}/friends").document(friend_id)

    friend_user_ref = db.collection(f"profiles/{friend_id}/friends").document(current_user_id)

    batch = db.batch()

    friend_data = {
        "status": "accepted",
        "created_at": SERVER_TIMESTAMP
    }

    batch.set(current_user_friend_ref, friend_data)
    batch.set(friend_user_ref, friend_data)

    batch.commit()

    return AddFriendResponse(
        status="ok",
        message="Friend added."
    )
