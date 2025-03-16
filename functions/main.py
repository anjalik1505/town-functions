# Welcome to Cloud Functions for Firebase for Python!
# To get started, simply uncomment the below code or create your own.
# Deploy with `firebase deploy`

import functools
import json

from firebase_admin import initialize_app, firestore, auth
from firebase_functions import https_fn
from flask import Flask, request, abort, Response
from pydantic import ValidationError
from werkzeug.exceptions import HTTPException

from models.pydantic_models import (
    GetPaginatedRequest,
    CreateProfileRequest,
)
from own_profile.create_my_profile import create_profile
from own_profile.get_my_feeds import get_my_feeds
from own_profile.get_my_friends import get_my_friends
from own_profile.get_my_profile import get_my_profile
from own_profile.get_my_updates import get_my_updates
from user_profile.get_user_profile import get_user_profile
from user_profile.get_user_updates import get_user_updates
from invitations.create_invitation import create_invitation
from invitations.accept_invitation import accept_invitation
from invitations.reject_invitation import reject_invitation
from invitations.resend_invitation import resend_invitation
from invitations.get_invitations import get_invitations

initialize_app()
app = Flask(__name__)


# Custom error handler for all HTTP exceptions
@app.errorhandler(HTTPException)
def handle_exception(e):
    """Return JSON instead of HTML for HTTP errors."""
    # Start with the correct headers and status code from the error
    response = e.get_response()
    # Replace the body with JSON
    response.data = json.dumps(
        {
            "code": e.code,
            "name": e.name,
            "description": e.description,
        }
    )
    response.content_type = "application/json"
    return response


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
            update_doc = (
                db.collection(f"profiles/{user_id}/user_posts")
                .document(update_id)
                .get()
            )
            if update_doc.exists:
                update_data = {"update": update_doc.to_dict()}

        # Merge the feed, user, and update data
        full_data.append({**feed_data, **user_data, **update_data})

    return https_fn.Response(json.dumps(full_data), mimetype="application/json")


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
        [
            db.collection(f"profiles/{user_id}/user_posts").document(update_id)
            for user_id, update_id in update_requests
        ]
    )
    updates = {
        f"{doc.reference.parent.parent.id}-{doc.id}": doc.to_dict()
        for doc in update_docs
        if doc.exists
    }

    # Merge data
    full_data = []
    for feed_data in feed_data_list:
        user_id = feed_data.get("user_id")
        update_id = feed_data.get("update_id")
        combined_data = {
            **feed_data,
            "user": users.get(user_id, {}),
            "update": updates.get(f"{user_id}-{update_id}", {}),
        }
        full_data.append(combined_data)

    return https_fn.Response(json.dumps(full_data), mimetype="application/json")


def authenticate_request():
    """
    Verifies Firebase ID token from Authorization header and attaches uid to request.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        abort(
            401, description="Authentication required: valid Firebase ID token needed"
        )

    parts = auth_header.split()
    if parts[0].lower() == "bearer" and len(parts) == 2:
        token = parts[1]
    else:
        token = auth_header

    try:
        # Verify the Firebase ID token
        decoded_token = auth.verify_id_token(token)
        # Extract the Firebase user ID from the token
        user_id = decoded_token.get("uid")
        if not user_id:
            abort(
                401,
                description="Authentication required: valid Firebase ID token needed",
            )
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


@app.route("/")
@handle_errors()
def index():
    """
    Reject all requests to the root endpoint.
    """
    abort(403, description="Forbidden")


@app.route("/me/profile", methods=["GET"])
@handle_errors()
def my_profile():
    """
    Get the user's profile.
    """
    return get_my_profile(request).to_json()


@app.route("/me/profile", methods=["POST"])
@handle_errors(validate_request=True)
def create_my_profile():
    """
    Create a new user profile.
    """
    data = request.get_json(silent=True)
    if not data:
        abort(400, description="Invalid request parameters")

    request.validated_params = CreateProfileRequest.model_validate(data)
    return create_profile(request).to_json()


@app.route("/me/updates", methods=["GET"])
@handle_errors(validate_request=True)
def my_updates():
    """
    Get all updates of the user, paginated.
    """
    args_dict = request.args.to_dict(flat=True)
    request.validated_params = GetPaginatedRequest.model_validate(args_dict)
    return get_my_updates(request).to_json()


@app.route("/me/feed", methods=["GET"])
@handle_errors(validate_request=True)
def my_feed():
    """
    Get all feeds of the user, paginated.
    """
    args_dict = request.args.to_dict(flat=True)
    request.validated_params = GetPaginatedRequest.model_validate(args_dict)
    return get_my_feeds(request).to_json()


@app.route("/me/friends", methods=["GET"])
@handle_errors()
def my_friends():
    """
    Get all friends of the user.
    """
    return get_my_friends(request).to_json()


# @app.route("/me/groups", methods=["GET"])
# @handle_errors()
# def my_groups():
#     """
#     Get all groups the user is a member of.
#     """
#     return get_my_groups(request).to_json()


# @app.route("/groups", methods=["POST"])
# @handle_errors(validate_request=True)
# def create_new_group():
#     """
#     Create a new group.
#     """
#     # Validate request data using Pydantic
#     data = request.get_json(silent=True)
#     if not data:
#         abort(400, description="Invalid request parameters")
#     request.validated_params = CreateGroupRequest.model_validate(data)
#     # Process the request
#     return create_group(request).to_json()


# @app.route("/groups/<group_id>/members", methods=["POST"])
# @handle_errors(validate_request=True)
# def add_group_members(group_id):
#     """
#     Add new members to an existing group.
#     """
#     # Validate request data using Pydantic
#     data = request.get_json(silent=True)
#     if not data:
#         abort(400, description="Invalid request parameters")
#     request.validated_params = AddGroupMembersRequest.model_validate(data)
#     # Process the request
#     return add_members_to_group(request, group_id).to_json()


# @app.route("/groups/<group_id>/members", methods=["GET"])
# @handle_errors()
# def group_members(group_id):
#     """
#     Get all members of a specific group with their basic profile information.
#     """
#     return get_group_members(request, group_id).to_json()


# @app.route("/groups/<group_id>/feed", methods=["GET"])
# @handle_errors(validate_request=True)
# def group_feed(group_id):
#     """
#     Get all updates for a specific group, paginated.
#     """
#     params = request.args.to_dict(flat=True)
#     request.validated_params = GetPaginatedRequest.model_validate(params)
#     return get_group_feed(request, group_id).to_json()


# @app.route("/groups/<group_id>/chats", methods=["GET"])
# @handle_errors(validate_request=True)
# def group_chats(group_id):
#     """
#     List group chat messages, paginated.
#     """
#     params = request.args.to_dict(flat=True)
#     request.validated_params = GetPaginatedRequest.model_validate(params)
#     return get_group_chats(request, group_id).to_json()


# @app.route("/groups/<group_id>/chats", methods=["POST"])
# @handle_errors(validate_request=True)
# def create_group_chat_message(group_id):
#     """
#     Post a new message in group chat.
#     """
#     data = request.get_json(silent=True)
#     if not data:
#         abort(400, description="Invalid request parameters")

#     request.validated_params = CreateChatMessageRequest.model_validate(data)
#     return create_group_chat_message(request, group_id).to_json()


@app.route("/users/<user_id>/profile", methods=["GET"])
@handle_errors()
def user_profile(user_id):
    """
    Fetch basic profile info plus a short summary and suggestions derived from shared data
    (common groups or a direct friend relationship).
    """
    return get_user_profile(request, user_id).to_json()


@app.route("/users/<user_id>/updates", methods=["GET"])
@handle_errors(validate_request=True)
def user_updates(user_id):
    """
    Get all updates for a specific user, paginated.
    """
    params = request.args.to_dict(flat=True)
    request.validated_params = GetPaginatedRequest.model_validate(params)
    return get_user_updates(request, user_id).to_json()


# Invitations routes
@app.route("/invitations", methods=["POST"])
@handle_errors()
def create_new_invitation():
    """
    Create a new invitation.
    """
    return create_invitation(request).to_json()


@app.route("/invitations", methods=["GET"])
@handle_errors()
def get_my_invitations():
    """
    Get all invitations for the current user.
    """
    return get_invitations(request).to_json()


@app.route("/invitations/<invitation_id>/accept", methods=["POST"])
@handle_errors()
def accept_user_invitation(invitation_id):
    """
    Accept an invitation.
    """
    return accept_invitation(request, invitation_id).to_json()


@app.route("/invitations/<invitation_id>/reject", methods=["POST"])
@handle_errors()
def reject_user_invitation(invitation_id):
    """
    Reject an invitation.
    """
    return reject_invitation(request, invitation_id).to_json()


@app.route("/invitations/<invitation_id>/resend", methods=["POST"])
@handle_errors()
def resend_user_invitation(invitation_id):
    """
    Resend an invitation.
    """
    return resend_invitation(request, invitation_id).to_json()


# Firebase Function entry point
@https_fn.on_request()
def api(incoming_request):
    """Cloud Function entry point that dispatches incoming HTTP requests to the Flask app."""
    return Response.from_app(app, incoming_request.environ)


# We should use this but this doesn't always work
# @https_fn.on_request()
# def api(incoming_request: https_fn.Request) -> https_fn.Response:
#     """Cloud Function entry point that dispatches incoming HTTP requests to the Flask app."""
#     with app.request_context(incoming_request.environ):
#         return app.full_dispatch_request()


if __name__ == "__main__":
    app.run(debug=True)
