from firebase_admin import firestore

from functions.data_models import FriendsResponse, Friend


def get_my_friends(request) -> FriendsResponse:
    """
    Retrieves the current user's friends with "accepted" status.
    
    Input: (None, uses auth token)
    
    Returns:
    - A list of the user's friends with minimal profile data
    """
    db = firestore.client()
    
    friends_ref = db.collection(f"profiles/{request.user_id}/friends") \
        .where("status", "==", "accepted") \
        .stream()
    
    friends = []
    
    for doc in friends_ref:
        friend_user_id = doc.id
        
        profile_ref = db.collection("profiles").document(friend_user_id).get()
        
        if profile_ref.exists:
            profile_data = profile_ref.to_dict() or {}
            
            friends.append(Friend(
                id=friend_user_id,
                name=profile_data.get("name", ""),
                avatar=profile_data.get("avatar", "")
            ))
    
    return FriendsResponse(
        friends=friends
    )
