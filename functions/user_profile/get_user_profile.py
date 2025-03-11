from firebase_admin import firestore
from flask import abort

from functions.data_models import ProfileResponse, Summary


def get_user_profile(request, user_id) -> ProfileResponse:
    """
    Retrieves a user's profile with summary and suggestions.
    
    This function checks if the current user is a friend of the requested user.
    If they are friends, it fetches and aggregates summary data from shared groups
    and their direct chat.
    
    Args:
        request: The Flask request object containing the authenticated user_id
        user_id: The ID of the user whose profile is being requested
        
    Returns:
        A ProfileResponse object containing the user's profile data with
        summary and suggestions
    """
    db = firestore.client()
    current_user_id = request.user_id
    
    # Don't allow users to view their own profile through this endpoint
    if current_user_id == user_id:
        abort(400, "Use /me/profile endpoint to view your own profile")
    
    # Get the target user's profile
    profile_ref = db.collection('profiles').document(user_id)
    profile_doc = profile_ref.get()
    
    if not profile_doc.exists:
        abort(404, "Profile not found")
    
    profile_data = profile_doc.to_dict() or {}
    
    # Check if users are friends
    friend_ref = db.collection('profiles').document(current_user_id).collection('friends').document(user_id)
    is_friend = friend_ref.get().exists
    
    # If they are not friends, return an error
    if not is_friend:
        abort(403, "You must be friends with this user to view their profile")
    
    # Initialize empty lists to collect all summary data
    emotional_journey_parts = []
    key_moments_parts = []
    recurring_themes_parts = []
    progress_and_growth_parts = []
    suggestions_parts = []
    
    # Get current user's groups
    current_user_profile = db.collection('profiles').document(current_user_id).get().to_dict() or {}
    current_user_groups = current_user_profile.get('group_ids', [])
    
    # Get target user's groups
    target_user_groups = profile_data.get('group_ids', [])
    
    # Find shared groups
    shared_groups = list(set(current_user_groups) & set(target_user_groups))
    
    # If they share groups, fetch partial summaries from each shared group
    if shared_groups:
        for group_id in shared_groups:
            summary_ref = db.collection('groups').document(group_id).collection('user_summaries').document(user_id)
            summary_doc = summary_ref.get()
            
            if summary_doc.exists:
                summary_data = summary_doc.to_dict() or {}
                
                # Collect summary data
                if 'emotional_journey' in summary_data and summary_data['emotional_journey']:
                    emotional_journey_parts.append(f"From group {group_id}: {summary_data['emotional_journey']}")
                
                if 'key_moments' in summary_data and summary_data['key_moments']:
                    key_moments_parts.append(f"From group {group_id}: {summary_data['key_moments']}")
                
                if 'recurring_themes' in summary_data and summary_data['recurring_themes']:
                    recurring_themes_parts.append(f"From group {group_id}: {summary_data['recurring_themes']}")
                
                if 'progress_and_growth' in summary_data and summary_data['progress_and_growth']:
                    progress_and_growth_parts.append(f"From group {group_id}: {summary_data['progress_and_growth']}")
                
                if 'suggestions' in summary_data and summary_data['suggestions']:
                    if isinstance(summary_data['suggestions'], list):
                        for suggestion in summary_data['suggestions']:
                            suggestions_parts.append(f"From group {group_id}: {suggestion}")
                    else:
                        suggestions_parts.append(f"From group {group_id}: {summary_data['suggestions']}")
    
    # Check for direct chat between the two users
    # For one-to-one chats, we can use a convention where the document ID
    # is a combination of the two user IDs (sorted and joined)
    user_ids = sorted([current_user_id, user_id])
    chat_id = f"{user_ids[0]}_{user_ids[1]}"
    
    # Try to get the chat document directly
    chat_ref = db.collection('chats').document(chat_id)
    chat_doc = chat_ref.get()
    
    if chat_doc.exists:
        # Fetch the summary for the requested user from the chat's summaries collection
        summary_ref = chat_ref.collection('summaries').document(user_id)
        summary_doc = summary_ref.get()
        
        if summary_doc.exists:
            summary_data = summary_doc.to_dict() or {}
            
            # Collect summary data from chat
            if 'emotional_journey' in summary_data and summary_data['emotional_journey']:
                emotional_journey_parts.append(f"From direct chat: {summary_data['emotional_journey']}")
            
            if 'key_moments' in summary_data and summary_data['key_moments']:
                key_moments_parts.append(f"From direct chat: {summary_data['key_moments']}")
            
            if 'recurring_themes' in summary_data and summary_data['recurring_themes']:
                recurring_themes_parts.append(f"From direct chat: {summary_data['recurring_themes']}")
            
            if 'progress_and_growth' in summary_data and summary_data['progress_and_growth']:
                progress_and_growth_parts.append(f"From direct chat: {summary_data['progress_and_growth']}")
            
            if 'suggestions' in summary_data and summary_data['suggestions']:
                if isinstance(summary_data['suggestions'], list):
                    for suggestion in summary_data['suggestions']:
                        suggestions_parts.append(f"From direct chat: {suggestion}")
                else:
                    suggestions_parts.append(f"From direct chat: {summary_data['suggestions']}")
    
    # Combine all parts with empty lines in between
    emotional_journey = "\n\n".join(emotional_journey_parts)
    key_moments = "\n\n".join(key_moments_parts)
    recurring_themes = "\n\n".join(recurring_themes_parts)
    progress_and_growth = "\n\n".join(progress_and_growth_parts)
    suggestions = suggestions_parts  # Keep as a list
    
    # TODO: Implement AI aggregation to shorten and combine the summaries
    # This would involve calling an AI service to process the combined summaries
    # and generate a more concise version
    #
    # Example pseudocode:
    # aggregated_emotional_journey = ai_service.aggregate(emotional_journey)
    # aggregated_key_moments = ai_service.aggregate(key_moments)
    # aggregated_recurring_themes = ai_service.aggregate(recurring_themes)
    # aggregated_progress_and_growth = ai_service.aggregate(progress_and_growth)
    # aggregated_suggestions = ai_service.aggregate_suggestions(suggestions)
    
    # Return the profile with summary and suggestions
    return ProfileResponse(
        id=user_id,
        name=profile_data.get('name', ''),
        avatar=profile_data.get('avatar', ''),
        summary=Summary(
            emotional_journey=emotional_journey,
            key_moments=key_moments,
            recurring_themes=recurring_themes,
            progress_and_growth=progress_and_growth
        ),
        suggestions=suggestions
    )
