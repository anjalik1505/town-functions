import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, InvitationFields, Status } from "../models/constants";
import { Invitation } from "../models/data-models";
import { BadRequestError, NotFoundError } from "./errors";
import { getLogger } from "./logging-utils";
import { formatTimestamp } from "./timestamp-utils";

const logger = getLogger(__filename);

/**
 * Gets an invitation document by ID
 * @param invitationId The ID of the invitation to retrieve
 * @returns The invitation document and data
 * @throws NotFoundError if the invitation doesn't exist
 */
export const getInvitationDoc = async (invitationId: string) => {
  const db = getFirestore();
  const invitationRef = db.collection(Collections.INVITATIONS).doc(invitationId);
  const invitationDoc = await invitationRef.get();

  if (!invitationDoc.exists) {
    logger.warn(`Invitation ${invitationId} not found`);
    throw new NotFoundError(`Invitation not found`);
  }

  return {
    ref: invitationRef,
    doc: invitationDoc,
    data: invitationDoc.data() || {}
  };
};

/**
 * Checks if an invitation has expired
 * @param expiresAt The expiration timestamp
 * @returns True if the invitation has expired
 */
export const isInvitationExpired = (expiresAt: Timestamp): boolean => {
  const currentTime = Timestamp.now();
  return expiresAt && expiresAt.toDate() < currentTime.toDate();
};

/**
 * Checks if a user has permission to act on an invitation
 * @param senderId The ID of the user who sent the invitation
 * @param currentUserId The ID of the current user
 * @param action The action being performed (e.g., "view", "accept", "reject")
 * @throws ForbiddenError if the user is trying to act on their own invitation
 */
export const hasInvitationPermission = (senderId: string, currentUserId: string, action: string): void => {
  if (senderId === currentUserId) {
    logger.warn(`User ${currentUserId} attempted to ${action} their own invitation`);
    throw new BadRequestError(`You cannot ${action} your own invitation`);
  }
};

/**
 * Formats an invitation document into an Invitation object
 * @param invitationId The ID of the invitation
 * @param invitationData The invitation data
 * @returns A formatted Invitation object
 */
export const formatInvitation = (invitationId: string, invitationData: any): Invitation => {
  const createdAt = invitationData[InvitationFields.CREATED_AT] as Timestamp;
  const expiresAt = invitationData[InvitationFields.EXPIRES_AT] as Timestamp;

  return {
    invitation_id: invitationId,
    created_at: createdAt ? formatTimestamp(createdAt) : "",
    expires_at: expiresAt ? formatTimestamp(expiresAt) : "",
    sender_id: invitationData[InvitationFields.SENDER_ID] || "",
    status: invitationData[InvitationFields.STATUS] || "",
    username: invitationData[InvitationFields.USERNAME] || "",
    name: invitationData[InvitationFields.NAME] || "",
    avatar: invitationData[InvitationFields.AVATAR] || "",
    receiver_name: invitationData[InvitationFields.RECEIVER_NAME] || ""
  };
};

/**
 * Updates the status of an invitation
 * @param invitationRef The reference to the invitation document
 * @param status The new status to set
 * @returns A promise that resolves when the update is complete
 */
export const updateInvitationStatus = async (invitationRef: FirebaseFirestore.DocumentReference, status: string) => {
  await invitationRef.update({ [InvitationFields.STATUS]: status });
  logger.info(`Updated invitation ${invitationRef.id} status to ${status}`);
};

/**
 * Checks if an invitation can be acted upon based on its status
 * @param status The current status of the invitation
 * @param action The action being performed (e.g., "accept", "reject")
 * @throws BadRequestError if the invitation cannot be acted upon
 */
export const canActOnInvitation = (status: string, action: string): void => {
  if (status !== Status.PENDING) {
    logger.warn(`Invitation cannot be ${action}ed (status: ${status})`);
    throw new BadRequestError(`Invitation cannot be ${action}ed (status: ${status})`);
  }
};