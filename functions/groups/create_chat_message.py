from firebase_admin import firestore
from firebase_admin.firestore import SERVER_TIMESTAMP
from flask import Request, abort
from models.constants import Collections, GroupFields, ChatFields
from models.data_models import ChatMessage
from utils.logging_utils import get_logger


def create_group_chat_message(request: Request, group_id: str) -> ChatMessage:
    """
    Creates a new chat message in a specific group.

    This function adds a new message to the group's chats subcollection.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: The validated request body containing:
                    - text: The message text
                    - attachments: Optional list of attachment URLs
        group_id: The ID of the group to add the chat message to

    Returns:
        A ChatMessage object representing the newly created message

    Raises:
        404: Group not found
        403: User is not a member of the group
        400: Invalid request data
        500: Internal server error
    """
    logger = get_logger(__name__)
    logger.info(f"Creating new chat message in group: {group_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Get the validated request data
    validated_data = request.validated_data
    text = validated_data.text
    attachments = validated_data.attachments or []

    # Initialize Firestore client
    db = firestore.client()

    # First, check if the group exists and if the user is a member
    group_ref = db.collection(Collections.GROUPS).document(group_id)
    group_doc = group_ref.get()

    if not group_doc.exists:
        logger.warning(f"Group {group_id} not found")
        abort(404, description="Group not found")

    group_data = group_doc.to_dict()
    members = group_data.get(GroupFields.MEMBERS, [])

    # Check if the current user is a member of the group
    if current_user_id not in members:
        logger.warning(f"User {current_user_id} is not a member of group {group_id}")
        abort(403, description="You must be a member of the group to post messages")

    # Create the chat message
    chats_ref = group_ref.collection(Collections.CHATS)

    # Prepare the message data
    message_data = {
        ChatFields.SENDER_ID: current_user_id,
        ChatFields.TEXT: text,
        ChatFields.CREATED_AT: SERVER_TIMESTAMP,
    }

    # Add attachments if provided
    if attachments:
        message_data[ChatFields.ATTACHMENTS] = attachments

    # Add the message to Firestore
    new_message_ref = chats_ref.document()  # Auto-generate ID
    new_message_ref.set(message_data)

    # Get the created message
    new_message_doc = new_message_ref.get()
    new_message_data = new_message_doc.to_dict()

    # Convert server timestamp to string for the response
    created_at = ""
    if new_message_data.get(ChatFields.CREATED_AT):
        created_at = new_message_data.get(ChatFields.CREATED_AT).isoformat()

    logger.info(f"Created new chat message with ID: {new_message_ref.id}")

    # Return the created message
    return ChatMessage(
        message_id=new_message_ref.id,
        sender_id=current_user_id,
        text=text,
        created_at=created_at,
        attachments=attachments,
    )
