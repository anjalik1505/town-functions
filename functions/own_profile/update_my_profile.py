from firebase_admin import firestore
from flask import abort
from models.constants import (
    Collections,
    FriendshipFields,
    GroupFields,
    InvitationFields,
    ProfileFields,
)
from models.data_models import Insights, ProfileResponse
from utils.logging_utils import get_logger


def update_profile(request):
    """
    Updates the authenticated user's profile information.

    This function:
    1. Checks if a profile exists for the authenticated user
    2. Updates the profile with the provided data
    3. If username, name, or avatar changes, updates these fields in related collections:
       - Invitations
       - Friendships (both as sender and receiver)
       - Groups (in member_profiles)

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: Profile data that can include:
                    - username: Optional updated username
                    - name: Optional updated display name
                    - avatar: Optional updated avatar URL
                    - location: Optional updated location information
                    - birthday: Optional updated birthday in ISO format
                    - notification_settings: Optional updated list of notification preferences

    Returns:
        A ProfileResponse containing the updated profile information

    Raises:
        404: Profile not found
    """
    logger = get_logger(__name__)
    logger.info(f"Starting update_profile operation for user ID: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Get the validated profile data
    profile_data_input = request.validated_params

    # Initialize Firestore client
    db = firestore.client()

    # Check if profile exists
    profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
    profile_doc = profile_ref.get()

    if not profile_doc.exists:
        logger.warning(f"Profile not found for user {current_user_id}")
        abort(404, description=f"Profile not found")

    # Get current profile data
    current_profile_data = profile_doc.to_dict()
    logger.info(f"Retrieved current profile data for user {current_user_id}")

    # Check if username, name, or avatar has changed
    username_changed = (
        hasattr(profile_data_input, "username")
        and profile_data_input.username is not None
        and profile_data_input.username
        != current_profile_data.get(ProfileFields.USERNAME)
    )

    name_changed = (
        hasattr(profile_data_input, "name")
        and profile_data_input.name is not None
        and profile_data_input.name != current_profile_data.get(ProfileFields.NAME)
    )

    avatar_changed = (
        hasattr(profile_data_input, "avatar")
        and profile_data_input.avatar is not None
        and profile_data_input.avatar != current_profile_data.get(ProfileFields.AVATAR)
    )

    # Prepare update data
    profile_updates = {}

    # Only update fields that are provided in the request
    if (
        hasattr(profile_data_input, "username")
        and profile_data_input.username is not None
    ):
        profile_updates[ProfileFields.USERNAME] = profile_data_input.username

    if hasattr(profile_data_input, "name") and profile_data_input.name is not None:
        profile_updates[ProfileFields.NAME] = profile_data_input.name

    if hasattr(profile_data_input, "avatar") and profile_data_input.avatar is not None:
        profile_updates[ProfileFields.AVATAR] = profile_data_input.avatar

    if (
        hasattr(profile_data_input, "location")
        and profile_data_input.location is not None
    ):
        profile_updates[ProfileFields.LOCATION] = profile_data_input.location

    if (
        hasattr(profile_data_input, "birthday")
        and profile_data_input.birthday is not None
    ):
        profile_updates[ProfileFields.BIRTHDAY] = profile_data_input.birthday

    if (
        hasattr(profile_data_input, "notification_settings")
        and profile_data_input.notification_settings is not None
    ):
        profile_updates[ProfileFields.NOTIFICATION_SETTINGS] = (
            profile_data_input.notification_settings
        )

    # Create a batch for all updates (profile and references)
    batch = db.batch()

    # Update the profile in the batch
    if profile_updates:
        batch.update(profile_ref, profile_updates)
        logger.info(f"Added profile update to batch for user {current_user_id}")

    # If username, name, or avatar changed, update references in other collections
    if username_changed or name_changed or avatar_changed:
        logger.info(
            f"Updating username/name/avatar references for user {current_user_id}"
        )

        # 1. Update all invitations created by this user
        invitations_query = db.collection(Collections.INVITATIONS).where(
            InvitationFields.SENDER_ID, "==", current_user_id
        )

        invitation_docs = invitations_query.stream()
        for invitation_doc in invitation_docs:
            invitation_ref = invitation_doc.reference
            invitation_updates = {}

            if username_changed:
                invitation_updates[InvitationFields.USERNAME] = profile_updates[
                    ProfileFields.USERNAME
                ]

            if name_changed:
                invitation_updates[InvitationFields.NAME] = profile_updates[
                    ProfileFields.NAME
                ]

            if avatar_changed:
                invitation_updates[InvitationFields.AVATAR] = profile_updates[
                    ProfileFields.AVATAR
                ]

            if invitation_updates:
                batch.update(invitation_ref, invitation_updates)

        # 2. Update friendships where user is sender
        friendships_as_sender_query = db.collection(Collections.FRIENDSHIPS).where(
            FriendshipFields.SENDER_ID, "==", current_user_id
        )

        friendship_sender_docs = friendships_as_sender_query.stream()
        for friendship_doc in friendship_sender_docs:
            friendship_ref = friendship_doc.reference
            friendship_updates = {}

            if username_changed:
                friendship_updates[FriendshipFields.SENDER_USERNAME] = profile_updates[
                    ProfileFields.USERNAME
                ]

            if name_changed:
                friendship_updates[FriendshipFields.SENDER_NAME] = profile_updates[
                    ProfileFields.NAME
                ]

            if avatar_changed:
                friendship_updates[FriendshipFields.SENDER_AVATAR] = profile_updates[
                    ProfileFields.AVATAR
                ]

            if friendship_updates:
                batch.update(friendship_ref, friendship_updates)

        # 3. Update friendships where user is receiver
        friendships_as_receiver_query = db.collection(Collections.FRIENDSHIPS).where(
            FriendshipFields.RECEIVER_ID, "==", current_user_id
        )

        friendship_receiver_docs = friendships_as_receiver_query.stream()
        for friendship_doc in friendship_receiver_docs:
            friendship_ref = friendship_doc.reference
            friendship_updates = {}

            if username_changed:
                friendship_updates[FriendshipFields.RECEIVER_USERNAME] = (
                    profile_updates[ProfileFields.USERNAME]
                )

            if name_changed:
                friendship_updates[FriendshipFields.RECEIVER_NAME] = profile_updates[
                    ProfileFields.NAME
                ]

            if avatar_changed:
                friendship_updates[FriendshipFields.RECEIVER_AVATAR] = profile_updates[
                    ProfileFields.AVATAR
                ]

            if friendship_updates:
                batch.update(friendship_ref, friendship_updates)

        # 4. Update groups where user is a member
        # First, get all groups the user is a member of
        groups_query = db.collection(Collections.GROUPS).where(
            GroupFields.MEMBERS, "array_contains", current_user_id
        )

        group_docs = groups_query.stream()
        for group_doc in group_docs:
            group_ref = group_doc.reference
            group_data = group_doc.to_dict()

            # Find and update the user's profile in member_profiles array
            member_profiles = group_data.get(GroupFields.MEMBER_PROFILES, [])
            for i, member_profile in enumerate(member_profiles):
                if member_profile.get(ProfileFields.USER_ID) == current_user_id:
                    # Create update path for the specific array element
                    if username_changed:
                        batch.update(
                            group_ref,
                            {
                                f"{GroupFields.MEMBER_PROFILES}.{i}.{ProfileFields.USERNAME}": profile_updates[
                                    ProfileFields.USERNAME
                                ]
                            },
                        )

                    if name_changed:
                        batch.update(
                            group_ref,
                            {
                                f"{GroupFields.MEMBER_PROFILES}.{i}.{ProfileFields.NAME}": profile_updates[
                                    ProfileFields.NAME
                                ]
                            },
                        )

                    if avatar_changed:
                        batch.update(
                            group_ref,
                            {
                                f"{GroupFields.MEMBER_PROFILES}.{i}.{ProfileFields.AVATAR}": profile_updates[
                                    ProfileFields.AVATAR
                                ]
                            },
                        )

                    break

    # Commit all the updates in a single atomic operation
    if profile_updates or username_changed or name_changed or avatar_changed:
        batch.commit()
        logger.info(f"Committed batch updates for user {current_user_id}")

    # Get the updated profile data
    updated_profile_doc = profile_ref.get()
    updated_profile_data = updated_profile_doc.to_dict()

    # Get insights data
    insights_doc = next(
        profile_ref.collection(Collections.INSIGHTS).limit(1).stream(), None
    )
    insights_data = insights_doc.to_dict() if insights_doc else {}

    # Construct and return the profile response
    return ProfileResponse(
        user_id=current_user_id,
        username=updated_profile_data.get(ProfileFields.USERNAME, ""),
        name=updated_profile_data.get(ProfileFields.NAME, None),
        avatar=updated_profile_data.get(ProfileFields.AVATAR, None),
        location=updated_profile_data.get(ProfileFields.LOCATION, None),
        birthday=updated_profile_data.get(ProfileFields.BIRTHDAY, None),
        notification_settings=updated_profile_data.get(
            ProfileFields.NOTIFICATION_SETTINGS, None
        ),
        summary=updated_profile_data.get(ProfileFields.SUMMARY, None),
        suggestions=updated_profile_data.get(ProfileFields.SUGGESTIONS, None),
        insights=Insights(
            emotional_overview=insights_data.get("emotional_overview", ""),
            key_moments=insights_data.get("key_moments", ""),
            recurring_themes=insights_data.get("recurring_themes", ""),
            progress_and_growth=insights_data.get("progress_and_growth", ""),
        ),
    )
