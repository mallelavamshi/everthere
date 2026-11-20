import { createContext, useContext } from 'react';

/** Provided by the app shell once someone is signed in; TopBar shows the profile avatar when present. */
export interface ProfileTrigger {
  name: string;
  open: () => void;
}

export const ProfileTriggerContext = createContext<ProfileTrigger | null>(null);
export const useProfileTrigger = () => useContext(ProfileTriggerContext);
