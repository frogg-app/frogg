import { useEffect, useRef, type RefObject } from "react";

/**
 * Every open modal, dialog, sheet and popover, oldest first. On web a capture-phase key
 * listener lets the top-most layer own Esc (closes it) and Ctrl/Cmd+A (focuses and selects
 * its text field when focus is not already in a field, never the page behind it), before any page shortcut sees them.
 * Native has no hardware keyboard path here; Android back goes through `onRequestClose`.
 */
interface Layer {
  id: number;
  close: () => void;
  /** Host node of the layer's content; on web this is the DOM element. */
  root?: RefObject<unknown>;
}

const layers: Layer[] = [];
let seq = 0;

/** True while any modal layer is open (page shortcuts stand down). */
export function modalOpen(): boolean {
  return layers.length > 0;
}

/** Registers an overlay as a modal layer while `open`. `root` lets Ctrl/Cmd+A find its field. */
export function useModalLayer(open: boolean, onClose: () => void, root?: RefObject<unknown>) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    seq += 1;
    const layer: Layer = { id: seq, close: () => close.current(), root };
    layers.push(layer);
    install();
    return () => {
      const at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
    };
  }, [open, root]);
}

interface Doc {
  activeElement?: { tagName?: string; isContentEditable?: boolean } | null;
}

const FIELD =
  'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="hidden"])';

function editable(el: Doc["activeElement"]): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!el.isContentEditable;
}

interface FieldEl {
  focus: () => void;
  select?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}
interface QueryEl {
  querySelectorAll?: (sel: string) => ArrayLike<FieldEl>;
}

/** The layer's first enabled text field, or null. */
function primaryField(layer: Layer): FieldEl | null {
  const node = layer.root?.current as QueryEl | null | undefined;
  const all = node?.querySelectorAll?.(FIELD);
  if (!all) return null;
  for (let i = 0; i < all.length; i++) if (!all[i].disabled && !all[i].readOnly) return all[i];
  return null;
}

let installed = false;
let swallowEscUp = false;

function install() {
  const g = globalThis as {
    document?: Doc;
    addEventListener?: (t: string, fn: (e: KeyboardEvent) => void, capture: boolean) => void;
  };
  if (installed || !g.document || !g.addEventListener) return;
  installed = true;
  g.addEventListener(
    "keydown",
    (e) => {
      const top = layers[layers.length - 1];
      if (!top || e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // RN-web's Modal also closes on Esc keyup; one press closes one layer.
        swallowEscUp = true;
        top.close();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
        if (editable(g.document?.activeElement)) return;
        // Never select the page behind the modal; take the modal's field when it has one.
        e.preventDefault();
        const field = primaryField(top);
        field?.focus();
        field?.select?.();
      }
    },
    true,
  );
  g.addEventListener(
    "keyup",
    (e) => {
      if (e.key !== "Escape" || !swallowEscUp) return;
      swallowEscUp = false;
      e.stopPropagation();
    },
    true,
  );
}
