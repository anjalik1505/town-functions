import { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FirestoreEvent } from "firebase-functions/v2/firestore";
import { FriendshipFields, Status } from "../models/constants";
import { getLogger } from "../utils/logging-utils";
import { syncFriendshipDataForUser } from "../utils/friendship-utils";

const logger = getLogger(__filename);

/**
 * Firestore trigger function that runs when a new friendship is created.
 * This function:
 * 1. Queries all updates of the friendship sender that have all_village=true
 * 2. Creates feed items for the receiver for each of these updates
 * 3. Gets the last 10 shared items and triggers the friend summary AI flow
 *
 * @param event - The Firestore event object containing the document data
 */
export const onFriendshipCreated = async (event: FirestoreEvent<QueryDocumentSnapshot | undefined, {
  id: string
}>): Promise<void> => {
  if (!event.data) {
    logger.error("No data in friendship event");
    return;
  }

  logger.info(`Processing new friendship: ${event.data.id}`);

  // Get the friendship data directly from the event
  const friendshipData = event.data.data() || {};

  // Check if the friendship has the required fields and is in ACCEPTED status
  if (!friendshipData ||
    !friendshipData[FriendshipFields.SENDER_ID] ||
    !friendshipData[FriendshipFields.RECEIVER_ID] ||
    friendshipData[FriendshipFields.STATUS] !== Status.ACCEPTED) {
    logger.error(`Friendship ${event.data.id} has invalid data or is not in ACCEPTED status`);
    return;
  }

  // Get the sender and receiver IDs
  const senderId = friendshipData[FriendshipFields.SENDER_ID];
  const receiverId = friendshipData[FriendshipFields.RECEIVER_ID];

  // Run both sync directions in parallel
  await Promise.all([
    syncFriendshipDataForUser(senderId, receiverId, { ...friendshipData, id: event.data.id }),
    syncFriendshipDataForUser(receiverId, senderId, { ...friendshipData, id: event.data.id })
  ]);
};
