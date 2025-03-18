import asyncio
from datetime import datetime, timezone
from typing import Dict, Optional

from firebase_admin import firestore
from models.constants import (
    Collections,
    Documents,
    InsightsFields,
    ProfileFields,
    UpdateFields,
    UserSummaryFields,
)
from utils.logging_utils import get_logger


async def generate_summary(
    existing_summary: Optional[str], update_content: str, sentiment: str
) -> str:
    """
    Generate a summary using AI. This is a dummy implementation.

    Args:
        existing_summary: The existing summary text, if any
        update_content: The content of the new update
        sentiment: The sentiment of the new update

    Returns:
        The updated summary text
    """
    # TODO: Implement actual AI call to Gemini Flash Lite 2.0
    # This is a dummy implementation
    logger = get_logger(__name__)
    logger.info("Generating summary with AI")

    # No sleep for testing purposes

    if existing_summary:
        return (
            f"{existing_summary}\nNew update: {update_content} (Sentiment: {sentiment})"
        )
    else:
        return f"Summary started with: {update_content} (Sentiment: {sentiment})"


async def generate_suggestions(
    existing_suggestions: Optional[str], update_content: str, sentiment: str
) -> str:
    """
    Generate suggestions using AI. This is a dummy implementation.

    Args:
        existing_suggestions: The existing suggestions text, if any
        update_content: The content of the new update
        sentiment: The sentiment of the new update

    Returns:
        The updated suggestions text
    """
    # TODO: Implement actual AI call to Gemini Flash Lite 2.0
    # This is a dummy implementation
    logger = get_logger(__name__)
    logger.info("Generating suggestions with AI")

    # No sleep for testing purposes

    if existing_suggestions:
        return f"{existing_suggestions}\nNew suggestion based on: {update_content}"
    else:
        return f"Consider asking about: {update_content}"


async def generate_insights(
    existing_insights: Optional[Dict], update_content: str, sentiment: str
) -> Dict:
    """
    Generate insights using AI. This is a dummy implementation.

    Args:
        existing_insights: The existing insights data, if any
        update_content: The content of the new update
        sentiment: The sentiment of the new update

    Returns:
        The updated insights data
    """
    # TODO: Implement actual AI call to Gemini Flash Lite 2.0
    # This is a dummy implementation
    logger = get_logger(__name__)
    logger.info("Generating insights with AI")

    # No sleep for testing purposes

    # Create default insights if none exist
    if not existing_insights:
        existing_insights = {
            InsightsFields.EMOTIONAL_OVERVIEW: "",
            InsightsFields.KEY_MOMENTS: "",
            InsightsFields.RECURRING_THEMES: "",
            InsightsFields.PROGRESS_AND_GROWTH: "",
        }

    # Update the insights with new information
    insights = {
        InsightsFields.EMOTIONAL_OVERVIEW: f"{existing_insights.get(InsightsFields.EMOTIONAL_OVERVIEW, '')}\nSentiment: {sentiment}",
        InsightsFields.KEY_MOMENTS: f"{existing_insights.get(InsightsFields.KEY_MOMENTS, '')}\nNew moment: {update_content}",
        InsightsFields.RECURRING_THEMES: existing_insights.get(
            InsightsFields.RECURRING_THEMES, "Themes will be identified over time"
        ),
        InsightsFields.PROGRESS_AND_GROWTH: existing_insights.get(
            InsightsFields.PROGRESS_AND_GROWTH,
            "Progress tracking will develop over time",
        ),
    }

    return insights


async def process_friend_summary(
    db: firestore.Client,
    update_data: Dict,
    creator_id: str,
    friend_id: str,
    batch: firestore.WriteBatch,
) -> None:
    """
    Process a summary for a specific friend.

    Args:
        db: Firestore client
        update_data: The update document data
        creator_id: The ID of the user who created the update
        friend_id: The ID of the friend to process the summary for
        batch: Firestore write batch for atomic operations
    """
    logger = get_logger(__name__)

    # Sort user IDs to create a consistent relationship ID
    user_ids = sorted([creator_id, friend_id])
    relationship_id = f"{user_ids[0]}_{user_ids[1]}"

    # Determine which user is the target (the friend who will see the summary)
    target_id = friend_id

    # Get the existing summary document if it exists
    summary_ref = db.collection(Collections.USER_SUMMARIES).document(relationship_id)
    summary_doc = summary_ref.get()

    # Extract data from the existing summary or initialize new data
    if summary_doc.exists:
        summary_data = summary_doc.to_dict()
        existing_summary = summary_data.get(UserSummaryFields.SUMMARY)
        existing_suggestions = summary_data.get(UserSummaryFields.SUGGESTIONS)
        update_count = summary_data.get(UserSummaryFields.UPDATE_COUNT, 0) + 1
    else:
        existing_summary = None
        existing_suggestions = None
        update_count = 1

    # Extract update content and sentiment
    update_content = update_data.get(UpdateFields.CONTENT)
    sentiment = update_data.get(UpdateFields.SENTIMENT)
    update_id = update_data.get(UpdateFields.ID)

    # Generate summary and suggestions in parallel
    summary_task = generate_summary(existing_summary, update_content, sentiment)
    suggestions_task = generate_suggestions(
        existing_suggestions, update_content, sentiment
    )

    # Wait for both tasks to complete
    new_summary, new_suggestions = await asyncio.gather(summary_task, suggestions_task)

    # Prepare the summary document
    now = datetime.now(timezone.utc)
    summary_data = {
        UserSummaryFields.CREATOR_ID: creator_id,
        UserSummaryFields.TARGET_ID: target_id,
        UserSummaryFields.SUMMARY: new_summary,
        UserSummaryFields.SUGGESTIONS: new_suggestions,
        UserSummaryFields.LAST_UPDATE_ID: update_id,
        UserSummaryFields.UPDATED_AT: now,
        UserSummaryFields.UPDATE_COUNT: update_count,
    }

    # If this is a new summary, add created_at
    if not summary_doc.exists:
        summary_data[UserSummaryFields.CREATED_AT] = now

    # Add to batch instead of writing immediately
    batch.set(summary_ref, summary_data, merge=True)
    logger.info(f"Added summary update for relationship {relationship_id} to batch")


async def update_creator_profile(
    db: firestore.Client,
    update_data: Dict,
    creator_id: str,
    batch: firestore.WriteBatch,
) -> None:
    """
    Update the creator's own profile with summary, suggestions, and insights.

    Args:
        db: Firestore client
        update_data: The update document data
        creator_id: The ID of the user who created the update
        batch: Firestore write batch for atomic operations
    """
    logger = get_logger(__name__)

    # Get the creator's profile
    profile_ref = db.collection(Collections.PROFILES).document(creator_id)
    profile_doc = profile_ref.get()

    if not profile_doc.exists:
        logger.warning(f"Creator profile not found: {creator_id}")
        return

    profile_data = profile_doc.to_dict()

    # Extract existing summary and suggestions
    existing_summary = profile_data.get(ProfileFields.SUMMARY)
    existing_suggestions = profile_data.get(ProfileFields.SUGGESTIONS)

    # Extract update content and sentiment
    update_content = update_data.get(UpdateFields.CONTENT)
    sentiment = update_data.get(UpdateFields.SENTIMENT)
    update_id = update_data.get(UpdateFields.ID)

    # Get insights data from the profile's insights subcollection
    insights_doc = next(
        profile_ref.collection(Collections.INSIGHTS).limit(1).stream(), None
    )
    existing_insights = insights_doc.to_dict() if insights_doc else {}

    # Generate summary, suggestions, and insights in parallel
    summary_task = generate_summary(existing_summary, update_content, sentiment)
    suggestions_task = generate_suggestions(
        existing_suggestions, update_content, sentiment
    )
    insights_task = generate_insights(existing_insights, update_content, sentiment)

    # Wait for all tasks to complete
    new_summary, new_suggestions, new_insights = await asyncio.gather(
        summary_task, suggestions_task, insights_task
    )

    # Update the profile
    now = datetime.now(timezone.utc)
    profile_updates = {
        ProfileFields.SUMMARY: new_summary,
        ProfileFields.SUGGESTIONS: new_suggestions,
        ProfileFields.LAST_UPDATE_ID: update_id,
        ProfileFields.UPDATED_AT: now,
    }

    # Add profile update to batch
    batch.update(profile_ref, profile_updates)
    logger.info(f"Added profile update for creator {creator_id} to batch")

    # Update or create the insights document
    insights_ref = profile_ref.collection(Collections.INSIGHTS).document(
        Documents.DEFAULT_INSIGHTS
    )
    batch.set(insights_ref, new_insights, merge=True)
    logger.info(f"Added insights update for creator {creator_id} to batch")


async def process_all_summaries(db: firestore.Client, update_data: Dict) -> None:
    """
    Process summaries for all friends and the creator in parallel.

    Args:
        db: Firestore client
        update_data: The update document data
    """
    logger = get_logger(__name__)

    # Get the creator ID and friend IDs
    creator_id = update_data.get(UpdateFields.CREATED_BY)
    friend_ids = update_data.get(UpdateFields.FRIEND_IDS, [])

    if not creator_id:
        logger.error(f"Update has no creator ID")
        return

    # Create a batch for atomic writes
    batch = db.batch()

    # Create tasks for all friends and the creator
    tasks = []

    # Add task for updating the creator's profile
    tasks.append(update_creator_profile(db, update_data, creator_id, batch))

    # Add tasks for all friends
    for friend_id in friend_ids:
        tasks.append(
            process_friend_summary(db, update_data, creator_id, friend_id, batch)
        )

    # Run all tasks in parallel
    await asyncio.gather(*tasks)

    # Commit the batch
    if tasks:
        batch.commit()
        logger.info(f"Committed batch with {len(tasks)} summary updates")


def on_update_created(event):
    """
    Firestore trigger function that runs when a new update is created.

    Args:
        event: The Firestore event object containing the document data

    Returns:
        None
    """
    logger = get_logger(__name__)
    logger.error(f"Processing new update: {event}")

    # Get the update data directly from the event
    update_data = event.data.to_dict() if event.data else {}

    # Add the document ID to the update data
    if event.data and hasattr(event.data, "id"):
        update_data[UpdateFields.ID] = event.data.id
    else:
        # Fallback to extracting from resource path if needed
        update_data[UpdateFields.ID] = context.resource.split("/")[-1]

    # Check if the update has the required fields
    if not update_data:
        logger.error(
            f"Update {update_data.get(UpdateFields.ID, 'unknown')} has no data"
        )
        return

    # Initialize Firestore client
    db = firestore.client()

    try:
        # Use asyncio to run the async functions
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(process_all_summaries(db, update_data))
        loop.close()

        logger.info(
            f"Successfully processed update {update_data.get(UpdateFields.ID, 'unknown')}"
        )
    except Exception as e:
        logger.error(
            f"Error processing update {update_data.get(UpdateFields.ID, 'unknown')}: {str(e)}"
        )
        # In a production environment, we would implement retry logic here
