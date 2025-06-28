import { Request } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ApiResponse, EventName, PhoneLookupEventParams } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { BaseUser, PhoneLookupPayload, PhoneLookupResponse } from '../models/data-models.js';
import { phoneConverter } from '../models/firestore/index.js';

/**
 * Retrieves user info for provided phone numbers.
 */
export const lookupPhones = async (req: Request): Promise<ApiResponse<PhoneLookupResponse>> => {
  const { phones } = req.validated_params as PhoneLookupPayload;

  const db = getFirestore();
  const phonesCollection = db.collection(Collections.PHONES).withConverter(phoneConverter);
  const docRefs = phones.map((p) => phonesCollection.doc(p));
  const snapshots = await db.getAll(...docRefs);

  const matches: BaseUser[] = [];
  snapshots.forEach((snap) => {
    if (!snap.exists) return;
    const data = snap.data();
    if (data) {
      matches.push({
        user_id: data.user_id,
        username: data.username,
        name: data.name,
        avatar: data.avatar,
      });
    }
  });

  const analyticsParams: PhoneLookupEventParams = {
    requested_count: phones.length,
    match_count: matches.length,
  };

  const response: ApiResponse<PhoneLookupResponse> = {
    data: { matches },
    status: 200,
    analytics: {
      event: EventName.PHONES_LOOKED_UP,
      userId: req.userId,
      params: analyticsParams,
    },
  };

  return response;
};
