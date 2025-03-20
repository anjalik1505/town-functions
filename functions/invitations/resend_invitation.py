from datetime import datetime, timedelta, timezone

from firebase_admin import firestore
from flask import abort
from models.constants import Collections, InvitationFields, Status
from models.data_models import Invitation
from utils.logging_utils import get_logger


def resend_invitation(request, invitation_id) -> Invitation:
    """
    Resends an invitation by resetting its created_at time and updating the expires_at time.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
        invitation_id: The ID of the invitation to resend

    Returns:
        The updated Invitation object with refreshed timestamps

    Raises:
        403: You can only resend your own invitations
        404: Invitation not found
    """
    logger = get_logger(__name__)
    logger.info(f"User {request.user_id} resending invitation {invitation_id}")

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

    # Check if the current user is the sender of the invitation
    sender_id = invitation_data.get(InvitationFields.SENDER_ID)
    if sender_id != current_user_id:
        logger.warning(
            f"User {current_user_id} is not the sender of invitation {invitation_id}"
        )
        abort(403, description="You can only resend your own invitations")

    # Set new timestamps
    current_time = datetime.now(timezone.utc)
    expires_at = current_time + timedelta(days=1)

    # Update the invitation with new timestamps
    invitation_ref.update(
        {
            InvitationFields.CREATED_AT: current_time,
            InvitationFields.EXPIRES_AT: expires_at,
            InvitationFields.STATUS: Status.PENDING,
        }
    )

    logger.info(f"User {current_user_id} resent invitation {invitation_id}")

    # Return the updated invitation
    return Invitation(
        invitation_id=invitation_id,
        created_at=current_time.isoformat(),
        expires_at=expires_at.isoformat(),
        sender_id=current_user_id,
        status=Status.PENDING,
        username=invitation_data.get(InvitationFields.USERNAME, ""),
        name=invitation_data.get(InvitationFields.NAME, ""),
        avatar=invitation_data.get(InvitationFields.AVATAR, ""),
    )
