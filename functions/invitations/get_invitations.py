from datetime import datetime, timezone

from firebase_admin import firestore
from models.constants import Collections, InvitationFields, Status
from models.data_models import Invitation, InvitationsResponse
from utils.logging_utils import get_logger


def get_invitations(request) -> InvitationsResponse:
    """
    Gets all invitations for the current user, checking if any have expired.

    This function:
    1. Retrieves all invitations where the current user is the sender
    2. Checks if any pending invitations have expired and updates their status
    3. Returns all invitations to the user

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)

    Returns:
        An InvitationsResponse object containing all invitations
    """
    logger = get_logger(__name__)
    logger.info(f"Getting invitations for user {request.user_id}")

    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Get all invitations where the current user is the sender
    invitations_query = (
        db.collection(Collections.INVITATIONS)
        .where(InvitationFields.SENDER_ID, "==", current_user_id)
        .get()
    )

    invitations = []
    batch = db.batch()
    batch_updated = False

    current_time = datetime.now(timezone.utc)

    # Process each invitation
    for doc in invitations_query:
        invitation_data = doc.to_dict()
        invitation_id = doc.id

        # Check if pending invitation has expired
        status = invitation_data.get(InvitationFields.STATUS)
        expires_at = invitation_data.get(InvitationFields.EXPIRES_AT)

        # Only update if the invitation is pending and has expired
        if (
            status == Status.PENDING
            and isinstance(expires_at, datetime)
            and expires_at < current_time
        ):
            # Use the document reference directly from the query
            batch.update(doc.reference, {InvitationFields.STATUS: Status.EXPIRED})
            batch_updated = True

            # Update status for the response
            invitation_data[InvitationFields.STATUS] = Status.EXPIRED

        # Format datetime objects for consistent API response
        created_at = invitation_data.get(InvitationFields.CREATED_AT, "")
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()

        expires_at_formatted = invitation_data.get(InvitationFields.EXPIRES_AT, "")
        if isinstance(expires_at_formatted, datetime):
            expires_at_formatted = expires_at_formatted.isoformat()

        # Create Invitation object
        invitation = Invitation(
            invitation_id=invitation_id,
            created_at=created_at,
            expires_at=expires_at_formatted,
            sender_id=invitation_data.get(InvitationFields.SENDER_ID, ""),
            status=invitation_data.get(InvitationFields.STATUS, ""),
            username=invitation_data.get(InvitationFields.USERNAME, ""),
            name=invitation_data.get(InvitationFields.NAME, ""),
            avatar=invitation_data.get(InvitationFields.AVATAR, ""),
        )

        invitations.append(invitation)

    # Commit batch if any updates were made
    if batch_updated:
        batch.commit()
        logger.info(f"Updated expired invitations for user {current_user_id}")

    logger.info(f"Retrieved {len(invitations)} invitations for user {current_user_id}")

    # Return the invitations response
    return InvitationsResponse(invitations=invitations)
