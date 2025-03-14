# Welcome to Cloud Functions for Firebase for Python!
# To get started, simply uncomment the below code or create your own.
# Deploy with `firebase deploy`
import functools
import json

from firebase_admin import initialize_app, firestore, auth
from firebase_functions import https_fn
from flask import Flask, request, jsonify, abort
from pydantic import ValidationError
from werkzeug.exceptions import HTTPException
from werkzeug.wrappers import Response

from models.pydantic_models import GetPaginatedRequest, AddFriendRequest
from own_profile.add_friend import add_friend
from own_profile.add_user import add_user
from own_profile.get_my_feeds import get_my_feeds
from own_profile.get_my_friends import get_my_friends
from own_profile.get_my_profile import get_my_profile
from own_profile.get_my_updates import get_my_updates

initialize_app()
app = Flask(__name__)


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


def authenticate_request():
    """
    Verifies Firebase ID token from Authorization header and attaches uid to request.
    """
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        abort(401, description="Authentication required: valid Firebase ID token needed")

    parts = auth_header.split()
    if parts[0].lower() == 'bearer' and len(parts) == 2:
        token = parts[1]
    else:
        token = auth_header

    try:
        # Verify the Firebase ID token
        decoded_token = auth.verify_id_token(token)
        # Extract the Firebase user ID from the token
        user_id = decoded_token.get('uid')
        if not user_id:
            abort(401, description="Authentication required: valid Firebase ID token needed")
        # Attach user_id to the request for downstream usage
        request.user_id = user_id
    except Exception as e:
        abort(401, description=f"Authentication failed: {str(e)}")


@app.before_request
def before_request():
    authenticate_request()


def handle_errors(validate_request=False):
    """
    A decorator for route handlers that provides consistent error handling.
    
    Args:
        validate_request: If True, ValidationError will be caught and return 400.
                          If False, ValidationError will be propagated.
    """

    def decorator(f):
        @functools.wraps(f)
        def wrapper(*args, **kwargs):
            try:
                return f(*args, **kwargs)
            except ValidationError as e:
                if validate_request:
                    abort(400, description="Invalid request parameters")
                else:
                    # If we don't handle validation here, re-raise it
                    raise
            except HTTPException as e:
                # Re-raise HTTP exceptions so they're properly returned to the client
                app.logger.error(f"Error in {f.__name__}: {str(e)}")
                raise
            except Exception as e:
                # For any other exceptions, return a generic 500 error
                app.logger.error(f"Error in {f.__name__}: {str(e)}")
                abort(500, description="Internal server error")

        return wrapper

    return decorator


@app.route('/')
@handle_errors()
def index():
    # Reject all requests to the root endpoint
    abort(403, description="Forbidden")


@app.route('/me/profile', methods=['GET'])
@handle_errors()
def my_profile():
    return get_my_profile(request).to_json()


@app.route('/me/profile', methods=['POST'])
@handle_errors()
def create_user_profile():
    return add_user(request).to_json()


@app.route('/me/updates', methods=['GET'])
@handle_errors(validate_request=True)
def my_updates():
    args_dict = request.args.to_dict(flat=True)
    request.validated_params = GetPaginatedRequest.model_validate(args_dict)
    return get_my_updates(request).to_json()


@app.route('/me/feed', methods=['GET'])
@handle_errors(validate_request=True)
def my_feed():
    args_dict = request.args.to_dict(flat=True)
    request.validated_params = GetPaginatedRequest.model_validate(args_dict)
    return get_my_feeds(request).to_json()


@app.route('/me/friends', methods=['GET'])
@handle_errors()
def my_friends():
    return get_my_friends(request).to_json()


@app.route('/me/friends', methods=['POST'])
@handle_errors(validate_request=True)
def add_my_friend():
    data = request.get_json()
    if not data:
        abort(400, description="Request body is required")
    validated_params = AddFriendRequest.model_validate(data)
    request.validated_params = validated_params
    return add_friend(request).to_json()


@app.route('/users/<user_id>/feed', methods=['GET'])
@handle_errors()
def user_feed(user_id):
    return jsonify({"user": user_id, "feed": "Feed not implemented"})


# Firebase Function entry point 
@https_fn.on_request()
def api(incoming_request):
    """Cloud Function entry point that dispatches incoming HTTP requests to the Flask app."""
    return Response.from_app(app, incoming_request.environ)


if __name__ == '__main__':
    app.run(debug=True)
