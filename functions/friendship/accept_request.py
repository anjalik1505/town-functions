from firebase_admin import firestore
from flask import abort
from google.cloud.firestore import SERVER_TIMESTAMP
from models.constants import Collections, FriendshipFields, Status
from models.data_models import AddFriendResponse
from utils.logging_utils import get_logger


def accept_request(request, friend_id) -> AddFriendResponse:
    """
    Accepts a pending friend request from the specified user.
    
    This function updates the status of a pending friendship request to "accepted".
    It performs validation to ensure the friend request exists and is in a pending state.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
        friend_id: The ID of the user whose friend request is being accepted
    
    Returns:
        An AddFriendResponse containing:
        - status: "ok" for success, "error" for failure
        - message: A description of the result or error
    
    Raises:
        404: Friend request not found
        400: Invalid request (e.g., no pending request exists)
        500: Server error during operation
    """
    logger = get_logger(__name__)
    logger.info(f"Accepting friend request from {friend_id} to {request.user_id}")

    current_user_id = request.user_id

    try:
        # Initialize Firestore client
        db = firestore.client()

        # Create a consistent friendship ID by sorting the user IDs
        user_ids = sorted([current_user_id, friend_id])
        friendship_id = f"{user_ids[0]}_{user_ids[1]}"

        # Get the friendship document
        friendship_ref = db.collection(Collections.FRIENDSHIPS).document(friendship_id)
        friendship_doc = friendship_ref.get()

        # Check if the friendship document exists
        if not friendship_doc.exists:
            logger.warning(f"No friendship document found with ID {friendship_id}")
            abort(404, description="Friend request not found")

        friendship_data = friendship_doc.to_dict()
        status = friendship_data.get(FriendshipFields.STATUS)
        sender_id = friendship_data.get(FriendshipFields.SENDER_ID)
        receiver_id = friendship_data.get(FriendshipFields.RECEIVER_ID)

        # Check if the friendship is in pending state
        if status != Status.PENDING:
            logger.warning(f"Friendship with ID {friendship_id} is not in pending state, current state: {status}")
            abort(400, description="No pending friend request found")

        # Check if the current user is the receiver of the friend request
        if receiver_id != current_user_id:
            logger.warning(f"User {current_user_id} is not the receiver of the friend request")
            abort(400, description="You cannot accept this friend request")

        # Update the friendship document to accepted status
        friendship_ref.update({
            FriendshipFields.STATUS: Status.ACCEPTED,
            FriendshipFields.UPDATED_AT: SERVER_TIMESTAMP
        })
        
        logger.info(f"Friend request from {sender_id} to {current_user_id} accepted successfully")
        return AddFriendResponse(
            status=Status.OK,
            message="Friend request accepted"
        )
    except Exception as e:
        logger.error(f"Error accepting friend request: {str(e)}", exc_info=True)
        abort(500, description="Internal server error")
