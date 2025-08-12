export interface InsightsDoc {
  emotional_overview: string;
  key_moments: string;
  recurring_themes: string;
  progress_and_growth: string;
}

export const insightsConverter: FirebaseFirestore.FirestoreDataConverter<InsightsDoc> = {
  toFirestore: (i: InsightsDoc) => i,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as InsightsDoc,
};

export const insf = <K extends keyof InsightsDoc>(k: K) => k;
