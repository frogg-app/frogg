import { useCallback, useMemo, useState, type ReactElement } from "react";
import type { ProviderAccountCapability } from "@frogg/protocol/provider-accounts";
import { CreateProviderAccountModal } from "./create-account-modal";
import { selectProviderAccounts, type ProviderAccountCreateInput } from "./model";
import { useProviderAccounts } from "./use-provider-accounts";

export interface CreateAccountFlow {
  /** Null when the daemon does not accept accounts for this provider. */
  capability: ProviderAccountCapability | null;
  open: () => void;
  /** Render once; null while the modal is closed. */
  modal: ReactElement | null;
}

/**
 * The "add account" modal and its create mutation, shared by every surface that
 * offers to add a provider account so they all behave the same.
 */
export function useCreateAccountFlow(serverId: string, providerId: string): CreateAccountFlow {
  const accounts = useProviderAccounts(serverId);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  const capability = useMemo(() => {
    const match = (accounts.payload?.capabilities ?? []).find(
      (candidate) => candidate.provider === providerId,
    );
    return match?.enabled ? match : null;
  }, [accounts.payload, providerId]);

  const existingNames = useMemo(
    () =>
      selectProviderAccounts(accounts.payload?.accounts ?? [], providerId).map(
        (account) => account.name,
      ),
    [accounts.payload, providerId],
  );

  const open = useCallback(() => setVisible(true), []);

  const close = useCallback(() => {
    setVisible(false);
    setError(null);
    setWarnings([]);
  }, []);

  const createMutate = accounts.create.mutateAsync;
  const submit = useCallback(
    (input: ProviderAccountCreateInput) => {
      setError(null);
      setWarnings([]);
      void (async () => {
        try {
          const payload = await createMutate(input);
          setWarnings(payload.warnings ?? []);
          if (payload.error) {
            setError(payload.error);
            return;
          }
          setVisible(false);
        } catch (cause: unknown) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    },
    [createMutate],
  );

  const modal =
    visible && capability ? (
      <CreateProviderAccountModal
        visible
        capability={capability}
        existingNames={existingNames}
        isSubmitting={accounts.create.isPending}
        error={error}
        warnings={warnings}
        onClose={close}
        onSubmit={submit}
      />
    ) : null;

  return { capability, open, modal };
}
