import { Request } from 'express';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { JoinRequest } from '../models/data-models.js';
import { JoinRequestFields } from '../models/constants.js';
import { ForbiddenError } from '../utils/errors.js';
import { formatJoinRequest, getInvitationDocForUser, getJoinRequestDoc } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Gets a single join request by ID.
 *
 * This function:
 * 1. Retrieves the user's invitation document
 * 2. Finds the join request in the invitation's join requests subcollection
 * 3. Validates that the current user is either the sender or receiver of the join request
 * 4. Returns the join request data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - request_id: The ID of the join request to retrieve
 *
 * @returns An ApiResponse containing the join request and analytics
 *
 * @throws 403: You are not authorized to view this join request
 * @throws 404: Join request not found
 * @throws 404: Invitation not found
 */
export const getJoinRequest = async (req: Request): Promise<ApiResponse<JoinRequest>> => {
  // Get validated params
  const currentUserId = req.userId;
  const requestId = req.params.request_id as string;

  logger.info(`Getting join request ${requestId} for user ${currentUserId}`);

  // Get the user's invitation
  const { ref: invitationRef } = await getInvitationDocForUser(currentUserId);
  const invitationId = invitationRef.id;

  // Get the join request from the subcollection
  const { ref: requestRef, data: requestData } = await getJoinRequestDoc(invitationId, requestId);

  // Extract requester and receiver IDs from the join request
  const requesterId = requestData[JoinRequestFields.REQUESTER_ID] as string;
  const receiverId = requestData[JoinRequestFields.RECEIVER_ID] as string;

  // Validate that the current user is either the sender or receiver
  if (currentUserId !== requesterId && currentUserId !== receiverId) {
    logger.warn(
      `User ${currentUserId} attempted to view join request ${requestId} but is neither the sender nor receiver`,
    );
    throw new ForbiddenError('You are not authorized to view this join request');
  }

  // Format the join request
  const joinRequest = formatJoinRequest(requestRef.id, requestData);

  logger.info(`Successfully retrieved join request ${requestId} for invitation ${invitationId}`);

  // Return the join request
  return {
    data: joinRequest,
    status: 200,
    analytics: {
      event: EventName.JOIN_REQUEST_VIEWED,
      userId: currentUserId,
      params: {
        invitation_id: invitationId,
        request_id: requestId,
      },
    },
  };
};
