from firebase_admin import firestore

from functions.data_models import FriendsResponse, Friend


def get_my_friends(request) -> FriendsResponse:
    """
    Retrieves the current user's friends with "accepted" status.
    
    This function fetches all friendship relationships for the authenticated user
    that have an "accepted" status. For each friend, it retrieves their basic profile
    information (id, name, avatar) from the profiles collection.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
    
    Returns:
        A FriendsResponse containing:
        - A list of Friend objects with basic profile information for each friend
    """
    db = firestore.client()

    # Query for friends with "accepted" status
    friends_ref = db.collection(f"profiles/{request.user_id}/friends") \
        .where("status", "==", "accepted") \
        .stream()

    friends = []

    # Process each friend document
    for doc in friends_ref:
        friend_user_id = doc.id

        # Retrieve the friend's profile information
        profile_ref = db.collection("profiles").document(friend_user_id).get()

        # Only include friends with existing profiles
        if profile_ref.exists:
            profile_data = profile_ref.to_dict() or {}

            # Create Friend object with basic profile data
            friends.append(Friend(
                id=friend_user_id,
                name=profile_data.get("name", ""),
                avatar=profile_data.get("avatar", "")
            ))

    # Return the list of friends
    return FriendsResponse(
        friends=friends
    )
