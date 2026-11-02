import { create } from "zustand";

/** What the sign-in dialog signs in: an account on a host, or a provider's account by name. */
export interface SignInTarget {
  hostId: string | null;
  provider: string;
  /** Exact account; else matched by `accountName`, else the provider's default account. */
  accountId?: string | null;
  accountName?: string | null;
}

export const useSignIn = create<{ target: SignInTarget | null }>(() => ({ target: null }));

export const openSignIn = (target: SignInTarget) => useSignIn.setState({ target });
export const closeSignIn = () => useSignIn.setState({ target: null });
