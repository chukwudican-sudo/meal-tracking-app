// Opening the legal pages / support email, with a message instead of a
// silent failure when the phone can't (no mail app set up, say).

import { Linking } from 'react-native';

import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/constants/legal';
import { useToastStore } from '@/store/useToastStore';

async function open(url: string, failMessage: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    useToastStore.getState().showToast(failMessage);
  }
}

export const openTerms = () => open(TERMS_URL, "Couldn't open the Terms. Please try again.");
export const openPrivacy = () => open(PRIVACY_URL, "Couldn't open the Privacy Policy. Please try again.");
export const openSupportEmail = () =>
  open(
    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Macrotri support')}`,
    `No mail app found. Email us at ${SUPPORT_EMAIL}.`,
  );
