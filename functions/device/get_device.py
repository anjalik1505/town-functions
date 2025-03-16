from datetime import datetime

from firebase_admin import firestore
from flask import Request, abort
from models.constants import Collections, DeviceFields
from models.data_models import Device
from utils.logging_utils import get_logger


def get_device(request: Request):
    """
    Get the device information for the authenticated user.

    Args:
        request: The Flask request object with user_id attached from authentication.

    Returns:
        A Device object containing the device information if found.

    Raises:
        404: Device not found
    """
    logger = get_logger(__name__)
    logger.info(f"Getting device for user {request.user_id}")

    # Reference to the user's device document
    db = firestore.client()
    device_ref = db.collection(Collections.DEVICES).document(request.user_id)

    # Get the device document
    device_doc = device_ref.get()
    if not device_doc.exists:
        logger.warning(f"Device not found for user {request.user_id}")
        abort(404, description="Device not found")

    # Get device data and create Device object
    device_data = device_doc.to_dict()
    logger.info(f"Device retrieved for user {request.user_id}")

    updated_at = device_data.get(DeviceFields.UPDATED_AT, "")
    if isinstance(updated_at, datetime):
        updated_at = updated_at.isoformat() + "Z"

    return Device(
        device_id=device_data.get(DeviceFields.DEVICE_ID, ""), updated_at=updated_at
    )
