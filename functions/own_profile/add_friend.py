from firebase_admin import firestore
from google.cloud.firestore import SERVER_TIMESTAMP

from functions.data_models import AddFriendResponse


def add_friend(request) -> AddFriendResponse:
    """
    Creates a mutual friendship relationship between the current user and another user.
    
    This function establishes a bidirectional friendship connection between the authenticated
    user and the specified friend. It creates entries in both users' friends subcollections
    with "accepted" status. The function performs validation to ensure the friend exists
    and that users cannot add themselves as friends.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: The validated request parameters containing:
                    - friendId: The ID of the user to add as a friend
    
    Query Parameters:
        - friendId: The ID of the user to add as a friend
    
    Returns:
        An AddFriendResponse containing:
        - status: "ok" for success, "error" for failure
        - message: A description of the result or error
    
    Raises:
        No exceptions are raised; errors are returned in the response object.
    """
    db = firestore.client()

    # Get the friend ID from the validated request parameters
    friend_id = request.validated_params.friendId
    current_user_id = request.user_id

    # Check if the friend profile exists
    friend_profile_ref = db.collection("profiles").document(friend_id)
    friend_profile = friend_profile_ref.get()

    if not friend_profile.exists:
        return AddFriendResponse(
            status="error",
            message="Friend profile not found"
        )

    # Prevent users from adding themselves as friends
    if friend_id == current_user_id:
        return AddFriendResponse(
            status="error",
            message="Cannot add yourself as a friend"
        )

    # Create references to both sides of the friendship relationship
    current_user_friend_ref = db.collection(f"profiles/{current_user_id}/friends").document(friend_id)
    friend_user_ref = db.collection(f"profiles/{friend_id}/friends").document(current_user_id)

    # Use a batch write to ensure atomicity
    batch = db.batch()

    # Prepare the friendship data
    friend_data = {
        "status": "accepted",
        "created_at": SERVER_TIMESTAMP
    }

    # Add both friendship documents in a single batch
    batch.set(current_user_friend_ref, friend_data)
    batch.set(friend_user_ref, friend_data)

    # Commit the batch
    batch.commit()

    # Return success response
    return AddFriendResponse(
        status="ok",
        message="Friend added."
    )
