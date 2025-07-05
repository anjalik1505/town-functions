import { Timestamp } from 'firebase-admin/firestore';

export interface CreatorProfile {
  username: string;
  name: string;
  avatar: string;
}

export interface UserProfile {
  user_id: string;
  username: string;
  name: string;
  avatar: string;
}

export interface GroupProfile {
  group_id: string;
  name: string;
  icon: string;
}

export interface UpdateDoc {
  created_by: string;
  content: string;
  group_ids: string[];
  friend_ids: string[];
  sentiment: string;
  score: number;
  emoji: string;
  created_at: Timestamp;
  visible_to: string[];
  id: string;
  comment_count: number;
  reaction_count: number;
  reaction_types: Record<string, number>;
  all_village: boolean;
  image_paths: string[];
  image_analysis?: string;
  creator_profile: CreatorProfile;
  shared_with_friends_profiles: UserProfile[];
  shared_with_groups_profiles: GroupProfile[];
}

export const updateConverter: FirebaseFirestore.FirestoreDataConverter<UpdateDoc> = {
  toFirestore: (u: UpdateDoc) => u,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as UpdateDoc,
};

export const uf = <K extends keyof UpdateDoc>(k: K) => k;
