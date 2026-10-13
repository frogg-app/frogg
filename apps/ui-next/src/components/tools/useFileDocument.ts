import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { readDoc, saveText, useFiles, type FileDoc } from "../../daemon/files";
import { onHostSwitch } from "../../daemon/store";

interface Draft {
  doc: FileDoc;
  text: string;
}
const useDrafts = create<{ drafts: Record<string, Draft> }>(() => ({ drafts: {} }));
onHostSwitch(() => useDrafts.setState({ drafts: {} }));
const keyOf = (root: string | null, path: string) => `${root}\0${path}`;
export function hasFileDraft(path: string): boolean {
  return !!useDrafts.getState().drafts[keyOf(useFiles.getState().root, path)];
}
export function useFileDocument(path: string) {
  const root = useFiles((s) => s.root);
  const key = keyOf(root, path);
  const draft = useDrafts((s) => s.drafts[key]);
  const [doc, setDoc] = useState<FileDoc | { error: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    setDoc(null);
    setSaveError(null);
    const cached = useDrafts.getState().drafts[key];
    if (cached) setDoc(cached.doc);
    else
      void readDoc(path).then(
        (value) => {
          if (active) setDoc(value);
          return undefined;
        },
        (e: unknown) => {
          if (active) setDoc({ error: String(e) });
        },
      );
    return () => {
      active = false;
    };
  }, [path, key, generation]);
  const revert = useCallback(() => {
    useDrafts.setState((s) => {
      const drafts = { ...s.drafts };
      delete drafts[key];
      return { drafts };
    });
  }, [key]);
  const edit = useCallback(
    (text: string) => {
      if (!doc || !("text" in doc)) return;
      if (text === doc.text) {
        revert();
        return;
      }
      useDrafts.setState((s) => ({ drafts: { ...s.drafts, [key]: { doc, text } } }));
    },
    [doc, key, revert],
  );
  const save = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveText(path, draft.text, draft.doc);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setDoc(result.doc);
      // Preserve any newer typing while the write was in flight.
      useDrafts.setState((s) => {
        const drafts = { ...s.drafts };
        if (drafts[key]?.text === draft.text) delete drafts[key];
        else if (drafts[key]) drafts[key] = { ...drafts[key], doc: result.doc };
        return { drafts };
      });
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [draft, saving, path, key]);
  return {
    doc,
    draft: draft?.text ?? null,
    dirty: !!draft,
    edit,
    revert,
    save,
    saving,
    saveError,
    reload,
  };
}
