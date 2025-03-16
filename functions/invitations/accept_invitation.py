from datetime import datetime, timezone
from firebase_admin import firestore
from flask import abort
from models.constants import (
    Collections,
    InvitationFields,
    Status,
    FriendshipFields,
    ProfileFields,
)
from models.data_models import Friend
from utils.logging_utils import get_logger


def accept_invitation(request, invitation_id) -> Friend:
    """
    Accepts an invitation and creates a friendship between the users.

    This function:
    1. Checks if the invitation exists and is still valid
    2. Creates a new friendship document between the accepting user and the sender
    3. Deletes the invitation document

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
        invitation_id: The ID of the invitation to accept

    Returns:
        A Friend object representing the new friendship

    Raises:
        400: Invitation cannot be accepted (status: {status})
        400: Invitation has expired
        400: You cannot accept your own invitation
        404: Invitation not found
        404: User profile not found
        404: Sender profile not found
    """
    logger = get_logger(__name__)
    logger.info(f"User {request.user_id} accepting invitation {invitation_id}")

    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Get the invitation document
    invitation_ref = db.collection(Collections.INVITATIONS).document(invitation_id)
    invitation_doc = invitation_ref.get()

    # Check if the invitation exists
    if not invitation_doc.exists:
        logger.warning(f"Invitation {invitation_id} not found")
        abort(404, description="Invitation not found")

    invitation_data = invitation_doc.to_dict()

    # Check invitation status
    status = invitation_data.get(InvitationFields.STATUS)
    if status != Status.PENDING:
        logger.warning(f"Invitation {invitation_id} has status {status}, not pending")
        abort(400, description=f"Invitation cannot be accepted (status: {status})")

    # Check if invitation has expired
    current_time = datetime.now(timezone.utc)
    expires_at = invitation_data.get(InvitationFields.EXPIRES_AT)
    if expires_at and isinstance(expires_at, datetime) and expires_at < current_time:
        # Update invitation status to expired
        invitation_ref.update({InvitationFields.STATUS: Status.EXPIRED})
        logger.warning(f"Invitation {invitation_id} has expired")
        abort(400, description="Invitation has expired")

    # Get the sender's user ID
    sender_id = invitation_data.get(InvitationFields.SENDER_ID)

    # Ensure the current user is not the sender (can't accept your own invitation)
    if sender_id == current_user_id:
        logger.warning(
            f"User {current_user_id} attempted to accept their own invitation {invitation_id}"
        )
        abort(400, description="You cannot accept your own invitation")

    # Get current user's profile
    current_user_profile_ref = db.collection(Collections.PROFILES).document(
        current_user_id
    )
    current_user_profile_doc = current_user_profile_ref.get()

    if not current_user_profile_doc.exists:
        logger.warning(f"Current user profile {current_user_id} not found")
        abort(404, description="User profile not found")

    current_user_profile = current_user_profile_doc.to_dict()

    # Get sender's profile
    sender_profile_ref = db.collection(Collections.PROFILES).document(sender_id)
    sender_profile_doc = sender_profile_ref.get()

    if not sender_profile_doc.exists:
        logger.warning(f"Sender profile {sender_id} not found")
        abort(404, description="Sender profile not found")

    sender_profile = sender_profile_doc.to_dict()

    # Create a batch operation for atomicity
    batch = db.batch()

    # Create a consistent friendship ID by sorting the user IDs
    user_ids = sorted([current_user_id, sender_id])
    friendship_id = f"{user_ids[0]}_{user_ids[1]}"

    # Check if friendship already exists
    friendship_ref = db.collection(Collections.FRIENDSHIPS).document(friendship_id)
    friendship_doc = friendship_ref.get()

    if friendship_doc.exists:
        friendship_data = friendship_doc.to_dict()
        status = friendship_data.get(FriendshipFields.STATUS)

        if status == Status.ACCEPTED:
            logger.warning(
                f"Users {current_user_id} and {sender_id} are already friends"
            )
            # Delete the invitation since they're already friends
            batch.delete(invitation_ref)
            batch.commit()

            # Return the existing friend using data from the friendship document
            if friendship_data.get(FriendshipFields.SENDER_ID) == sender_id:
                friend_name = friendship_data.get(FriendshipFields.SENDER_NAME, "")
                friend_username = friendship_data.get(
                    FriendshipFields.SENDER_USERNAME, ""
                )
                friend_avatar = friendship_data.get(FriendshipFields.SENDER_AVATAR, "")
            else:
                friend_name = friendship_data.get(FriendshipFields.RECEIVER_NAME, "")
                friend_username = friendship_data.get(
                    FriendshipFields.RECEIVER_USERNAME, ""
                )
                friend_avatar = friendship_data.get(
                    FriendshipFields.RECEIVER_AVATAR, ""
                )

            return Friend(
                user_id=sender_id,
                username=friend_username,
                name=friend_name,
                avatar=friend_avatar,
            )

    # Create the friendship document using profile data directly
    friendship_data = {
        FriendshipFields.SENDER_ID: sender_id,
        FriendshipFields.SENDER_NAME: sender_profile.get(ProfileFields.NAME, ""),
        FriendshipFields.SENDER_USERNAME: sender_profile.get(
            ProfileFields.USERNAME, ""
        ),
        FriendshipFields.SENDER_AVATAR: sender_profile.get(ProfileFields.AVATAR, ""),
        FriendshipFields.RECEIVER_ID: current_user_id,
        FriendshipFields.RECEIVER_NAME: current_user_profile.get(
            ProfileFields.NAME, ""
        ),
        FriendshipFields.RECEIVER_USERNAME: current_user_profile.get(
            ProfileFields.USERNAME, ""
        ),
        FriendshipFields.RECEIVER_AVATAR: current_user_profile.get(
            ProfileFields.AVATAR, ""
        ),
        FriendshipFields.STATUS: Status.ACCEPTED,
        FriendshipFields.CREATED_AT: current_time,
        FriendshipFields.UPDATED_AT: current_time,
        FriendshipFields.MEMBERS: [sender_id, current_user_id],
    }

    # Add operations to batch
    batch.set(friendship_ref, friendship_data)
    batch.delete(invitation_ref)

    # Commit the batch
    batch.commit()

    logger.info(
        f"User {current_user_id} accepted invitation {invitation_id} from {sender_id}"
    )

    # Return the friend object using sender's profile data
    return Friend(
        user_id=sender_id,
        username=sender_profile.get(ProfileFields.USERNAME, ""),
        name=sender_profile.get(ProfileFields.NAME, ""),
        avatar=sender_profile.get(ProfileFields.AVATAR, ""),
    )
