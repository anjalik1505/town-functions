from firebase_admin import firestore
from models.constants import Collections, FriendshipFields, QueryOperators, Status
from models.data_models import FriendsResponse, Friend
from utils.logging_utils import get_logger


def get_my_friends(request) -> FriendsResponse:
    """
    Retrieves the current user's friends and pending friendship requests.

    This function fetches all accepted and pending friendships where the current user
    is in the members array, and returns the friend's information with status.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)

    Returns:
        A FriendsResponse containing:
        - A list of Friend objects with the friend's profile information and friendship status
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving friends and pending requests for user: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Use a single efficient query with array_contains and in operator for multiple statuses
    friendships_query = (
        db.collection(Collections.FRIENDSHIPS)
        .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, current_user_id)
        .where(
            FriendshipFields.STATUS,
            QueryOperators.IN,
            [Status.ACCEPTED, Status.PENDING],
        )
    )

    logger.info(f"Querying friendships for user: {current_user_id}")

    # Execute the query
    friendships = list(friendships_query.stream())

    friends = []

    # Process friendships
    for doc in friendships:
        friendship_data = doc.to_dict()
        friendship_status = friendship_data.get(FriendshipFields.STATUS)

        # Determine if the current user is the sender or receiver
        if friendship_data.get(FriendshipFields.SENDER_ID) == current_user_id:
            # Current user is the sender, so friend is the receiver
            friend_id = friendship_data.get(FriendshipFields.RECEIVER_ID)
            friend_username = friendship_data.get(
                FriendshipFields.RECEIVER_USERNAME, ""
            )
            friend_name = friendship_data.get(FriendshipFields.RECEIVER_NAME, "")
            friend_avatar = friendship_data.get(FriendshipFields.RECEIVER_AVATAR, "")
        else:
            # Current user is the receiver, so friend is the sender
            friend_id = friendship_data.get(FriendshipFields.SENDER_ID)
            friend_username = friendship_data.get(FriendshipFields.SENDER_USERNAME, "")
            friend_name = friendship_data.get(FriendshipFields.SENDER_NAME, "")
            friend_avatar = friendship_data.get(FriendshipFields.SENDER_AVATAR, "")

        logger.info(
            f"Processing friendship with friend: {friend_id}, status: {friendship_status}"
        )

        friends.append(
            Friend(
                user_id=friend_id,
                username=friend_username,
                name=friend_name,
                avatar=friend_avatar,
            )
        )

    logger.info(
        f"Retrieved {len(friends)} friends and pending requests for user: {current_user_id}"
    )

    # Return the list of friends
    return FriendsResponse(friends=friends)
