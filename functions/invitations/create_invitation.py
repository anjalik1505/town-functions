from datetime import datetime, timedelta, timezone
from firebase_admin import firestore
from flask import abort
from models.constants import Collections, InvitationFields, Status, ProfileFields
from models.data_models import Invitation
from utils.logging_utils import get_logger


def create_invitation(request) -> Invitation:
    """
    Creates a new invitation from the current user.

    This function creates a new invitation document in the invitations collection.
    The invitation will have a pending status and will expire after 1 day.

    Validates that the user doesn't already have a pending invitation.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)

    Returns:
        An Invitation object representing the newly created invitation

    Raises:
        404: User profile not found
    """
    logger = get_logger(__name__)
    logger.info(f"Creating invitation for user {request.user_id}")

    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Get current user's profile for name and avatar
    current_user_profile_ref = db.collection(Collections.PROFILES).document(
        current_user_id
    )
    current_user_profile_doc = current_user_profile_ref.get()

    if not current_user_profile_doc.exists:
        logger.warning(f"Current user profile {current_user_id} not found")
        abort(404, description="User profile not found")

    current_user_profile = current_user_profile_doc.to_dict()

    # Create a new invitation document
    invitation_ref = db.collection(Collections.INVITATIONS).document()

    # Set expiration time (1 day from now)
    current_time = datetime.now(timezone.utc)
    expires_at = current_time + timedelta(days=1)

    # Create invitation data
    invitation_data = {
        InvitationFields.SENDER_ID: current_user_id,
        InvitationFields.USERNAME: current_user_profile.get(ProfileFields.USERNAME, ""),
        InvitationFields.NAME: current_user_profile.get(ProfileFields.NAME, ""),
        InvitationFields.AVATAR: current_user_profile.get(
            ProfileFields.AVATAR, ""
        ),
        InvitationFields.STATUS: Status.PENDING,
        InvitationFields.CREATED_AT: current_time,
        InvitationFields.EXPIRES_AT: expires_at,
    }

    # Set the invitation document
    invitation_ref.set(invitation_data)

    logger.info(f"Created invitation with ID {invitation_ref.id}")

    # Return the invitation object
    return Invitation(
        invitation_id=invitation_ref.id,
        created_at=current_time.isoformat() + "Z",
        expires_at=expires_at.isoformat() + "Z",
        sender_id=current_user_id,
        status=Status.PENDING,
        username=current_user_profile.get(ProfileFields.USERNAME, ""),
        name=current_user_profile.get(ProfileFields.NAME, ""),
        avatar=current_user_profile.get(ProfileFields.AVATAR, ""),
    )
