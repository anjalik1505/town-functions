from datetime import datetime, timezone

from firebase_admin import firestore
from flask import Request
from models.constants import Collections, DeviceFields
from models.data_models import Device
from utils.logging_utils import get_logger


def update_device(request: Request):
    """
    Update the device ID for the authenticated user.

    Args:
        request: The Flask request object with user_id attached from authentication.

    Returns:
        A Device object containing the updated device information.
    """
    logger = get_logger(__name__)
    logger.info(f"Updating device for user {request.user_id}")

    # Get validated data from request
    device_data_input = request.validated_params

    current_time = datetime.now(timezone.utc)

    # Reference to the user's device document
    db = firestore.client()
    device_ref = db.collection(Collections.DEVICES).document(request.user_id)

    # Create or update the device document
    device_data = {
        DeviceFields.DEVICE_ID: device_data_input.device_id,
        DeviceFields.UPDATED_AT: current_time,
    }

    # Update the device document
    device_ref.set(device_data, merge=True)
    logger.info(f"Device updated for user {request.user_id}")

    # Create and return a Device object
    return Device(
        device_id=device_data_input.device_id, updated_at=current_time.isoformat() + "Z"
    )
