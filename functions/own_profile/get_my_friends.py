from firebase_admin import firestore
from models.constants import Collections, ProfileFields, FriendFields, Status
from models.data_models import FriendsResponse, Friend


def get_my_friends(request) -> FriendsResponse:
    """
    Retrieves the current user's friends with "accepted" status.
    
    Input: (None, uses auth token)
    
    Returns:
    - A list of the user's friends with minimal profile data
    """
    db = firestore.client()

    friends_ref = db.collection(f"{Collections.PROFILES}/{request.user_id}/{Collections.FRIENDS}") \
        .where(FriendFields.STATUS, "==", Status.ACCEPTED) \
        .stream()

    friends = []

    for doc in friends_ref:
        friend_user_id = doc.id

        profile_ref = db.collection(Collections.PROFILES).document(friend_user_id).get()

        if profile_ref.exists:
            profile_data = profile_ref.to_dict() or {}

            friends.append(Friend(
                id=friend_user_id,
                name=profile_data.get(ProfileFields.NAME, ""),
                avatar=profile_data.get(ProfileFields.AVATAR, "")
            ))

    return FriendsResponse(
        friends=friends
    )
