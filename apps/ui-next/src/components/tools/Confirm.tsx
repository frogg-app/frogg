import { useCallback, useState } from "react";
import { Button } from "../Button";
import { T } from "../Text";
import { Dialog } from "./Dialog";

export interface ConfirmSpec {
  eyebrow?: string;
  title: string;
  body: string;
  action: string;
  danger?: boolean;
  run: () => void | Promise<string | null | void>;
}

/** A yes/no dialog driven by a spec; `ask(spec)` opens it, the action runs `spec.run`. */
export function useConfirm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const ask = useCallback((next: ConfirmSpec) => {
    setError(null);
    setSpec(next);
  }, []);
  const close = useCallback(() => {
    if (!busy) setSpec(null);
  }, [busy]);
  const go = useCallback(async () => {
    if (!spec || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await spec.run();
      if (result) setError(result);
      else setSpec(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [spec, busy]);
  const dialog = (
    <Dialog
      open={!!spec}
      onClose={close}
      eyebrow={spec?.eyebrow}
      title={spec?.title ?? ""}
      footer={
        <>
          <Button label="Cancel" onPress={close} />
          <Button
            label={spec?.action ?? "OK"}
            kind={spec?.danger ? "danger" : "primary"}
            onPress={go}
            disabled={busy}
          />
        </>
      }
    >
      <T>{spec?.body}</T>
      {error && <T>{error}</T>}
    </Dialog>
  );
  return { ask, dialog };
}
