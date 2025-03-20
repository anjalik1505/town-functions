from firebase_functions import firestore_fn
from models.constants import Collections
from updates.on_creation import on_update_created


# Firestore trigger for new updates
@firestore_fn.on_document_created(document=f"{Collections.UPDATES}/{{id}}")
def process_update_creation(
    event: firestore_fn.Event[firestore_fn.DocumentSnapshot | None],
) -> None:
    """
    Firestore trigger function that runs when a new update is created in the updates collection.

    Args:
        event: The Firestore event containing the document data

    Returns:
        None
    """
    return on_update_created(event)
