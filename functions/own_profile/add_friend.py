from firebase_admin import firestore
from flask import abort
from google.cloud.firestore import SERVER_TIMESTAMP
from models.constants import Collections, FriendFields, Status
from models.data_models import AddFriendResponse


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
    - Success message with appropriate HTTP status code
    
    HTTP Status Codes:
    - 404: Friend profile not found
    - 400: Invalid request (e.g., trying to add yourself as a friend)
    - 409: Conflict (e.g., friend relationship already exists)
    - 500: Server error during operation
    """
    db = firestore.client()

    friend_id = request.validated_params.friendId
    current_user_id = request.user_id

    # Validate input parameters
    if friend_id == current_user_id:
        abort(400, description="Cannot add yourself as a friend")

    # Check if friend profile exists
    friend_profile_ref = db.collection(Collections.PROFILES).document(friend_id)
    friend_profile = friend_profile_ref.get()

    if not friend_profile.exists:
        abort(404, description="Friend profile not found")

    # Check if friendship already exists
    current_user_friend_ref = db.collection(f"{Collections.PROFILES}/{current_user_id}/{Collections.FRIENDS}").document(
        friend_id)

    existing_friendship = current_user_friend_ref.get()
    if existing_friendship.exists:
        # If already friends, return a conflict status
        abort(409, description="Friend relationship already exists")

    friend_user_ref = db.collection(f"{Collections.PROFILES}/{friend_id}/{Collections.FRIENDS}").document(
        current_user_id)

    try:
        batch = db.batch()

        friend_data = {
            FriendFields.STATUS: Status.ACCEPTED,
            FriendFields.CREATED_AT: SERVER_TIMESTAMP
        }

        batch.set(current_user_friend_ref, friend_data)
        batch.set(friend_user_ref, friend_data)

        batch.commit()

        return AddFriendResponse(
            status=Status.OK,
            message="Friend added successfully"
        )
    except Exception as e:
        # Log the error but don't expose details to the client
        print(f"Error adding friend: {str(e)}")
        abort(500, description="Internal server error")
