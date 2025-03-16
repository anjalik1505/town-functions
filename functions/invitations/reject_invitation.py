from firebase_admin import firestore
from flask import abort
from google.cloud.firestore import SERVER_TIMESTAMP
from models.constants import Collections, InvitationFields, Status
from models.data_models import Invitation
from utils.logging_utils import get_logger


def reject_invitation(request, invitation_id) -> Invitation:
    """
    Rejects an invitation by setting its status to rejected.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
        invitation_id: The ID of the invitation to reject

    Returns:
        The updated Invitation object with status set to rejected

    Raises:
        400: Invitation cannot be rejected (status: {status})
        400: You cannot reject your own invitation
        404: Invitation not found
    """
    logger = get_logger(__name__)
    logger.info(f"User {request.user_id} rejecting invitation {invitation_id}")

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
        abort(400, description=f"Invitation cannot be rejected (status: {status})")

    # Get the sender's user ID and ensure current user is not the sender
    sender_id = invitation_data.get(InvitationFields.SENDER_ID)
    if sender_id == current_user_id:
        logger.warning(
            f"User {current_user_id} attempted to reject their own invitation {invitation_id}"
        )
        abort(400, description="You cannot reject your own invitation")

    # Update the invitation status to rejected
    invitation_ref.update({InvitationFields.STATUS: Status.REJECTED})

    logger.info(f"User {current_user_id} rejected invitation {invitation_id}")

    # Return the updated invitation
    invitation_data[InvitationFields.STATUS] = Status.REJECTED

    return Invitation(
        invitation_id=invitation_id,
        created_at=invitation_data.get(InvitationFields.CREATED_AT, ""),
        expires_at=invitation_data.get(InvitationFields.EXPIRES_AT, ""),
        sender_id=invitation_data.get(InvitationFields.SENDER_ID, ""),
        status=Status.REJECTED,
        user_name=invitation_data.get(InvitationFields.USER_NAME, ""),
        user_avatar=invitation_data.get(InvitationFields.USER_AVATAR, ""),
    )
