export interface SimpleProfile {
  username: string;
  name: string;
  avatar: string;
}

export interface UserProfile extends SimpleProfile {
  user_id: string;
}

export interface GroupProfile {
  group_id: string;
  name: string;
  icon: string;
}
