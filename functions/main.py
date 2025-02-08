# Welcome to Cloud Functions for Firebase for Python!
# To get started, simply uncomment the below code or create your own.
# Deploy with `firebase deploy`

from firebase_functions import https_fn
from firebase_admin import initialize_app
from firebase_admin import initialize_app, firestore
import json

initialize_app()


@https_fn.on_request()
def on_request_example(req: https_fn.Request) -> https_fn.Response:
    return https_fn.Response("Hello world!")

@https_fn.on_request()
def on_get_feeds(req: https_fn.Request) -> https_fn.Response:
    db = firestore.client()
    feeds_ref = db.collection("feeds").get()

    full_data = []

    for doc in feeds_ref:
        feed_data = {"id": doc.id, **doc.to_dict()}
        
        # Fetch related user document
        user_id = feed_data.get("user_id")
        user_data = {}
        if user_id:
            user_doc = db.collection("profiles").document(user_id).get()
            if user_doc.exists:
                user_data = {"user": user_doc.to_dict()}

        # Fetch related update document
        update_id = feed_data.get("update_id")
        update_data = {}
        if update_id:
            update_doc = db.collection(f"profiles/{user_id}/user_posts").document(update_id).get()
            if update_doc.exists:
                update_data = {"update": update_doc.to_dict()}

        # Merge the feed, user, and update data
        full_data.append({**feed_data, **user_data, **update_data})

    return https_fn.Response(
        json.dumps(full_data),
        mimetype="application/json"
    )



@https_fn.on_request()
def on_get_feeds2(req: https_fn.Request) -> https_fn.Response:
    db = firestore.Client()
    feeds_ref = db.collection("feeds").stream()

    feed_data_list = []
    user_ids = set()
    update_requests = []

    # First, prepare a batch of user and update reads
    for doc in feeds_ref:
        feed_data = {"id": doc.id, **doc.to_dict()}
        feed_data_list.append(feed_data)

        user_id = feed_data.get("user_id")
        update_id = feed_data.get("update_id")
        
        if user_id:
            user_ids.add(user_id)
        if user_id and update_id:
            update_requests.append((user_id, update_id))

    # Batch fetch users
    user_docs = db.get_all([db.collection("users").document(uid) for uid in user_ids])
    users = {doc.id: doc.to_dict() for doc in user_docs if doc.exists}

    # Batch fetch updates from nested collections
    update_docs = db.get_all(
        [db.collection(f"profiles/{user_id}/user_posts").document(update_id) 
         for user_id, update_id in update_requests]
    )
    updates = {f"{doc.reference.parent.parent.id}-{doc.id}": doc.to_dict() for doc in update_docs if doc.exists}

    # Merge data
    full_data = []
    for feed_data in feed_data_list:
        user_id = feed_data.get("user_id")
        update_id = feed_data.get("update_id")
        combined_data = {
            **feed_data,
            "user": users.get(user_id, {}),
            "update": updates.get(f"{user_id}-{update_id}", {})
        }
        full_data.append(combined_data)

    return https_fn.Response(
        json.dumps(full_data),
        mimetype="application/json"
    )
