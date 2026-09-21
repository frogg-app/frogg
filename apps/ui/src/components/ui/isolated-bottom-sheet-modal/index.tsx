import {
  BottomSheetModal as GorhomBottomSheetModal,
  type BottomSheetModalProps,
} from "@gorhom/bottom-sheet";
import React from "react";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElementRef, ReactNode } from "react";
import {
  type BottomSheetController,
  createBottomSheetVisibilityTracker,
} from "./visibility-tracker";
import { BottomSheetTextInputScope } from "@/components/ui/text-input/bottom-sheet-scope";
import { useMobileBackOverlay } from "@/navigation/use-mobile-back";

type GorhomBottomSheetModalMethods = ElementRef<typeof GorhomBottomSheetModal>;

/**
 * Re-establishes React context on the far side of the portal.
 *
 * `@gorhom/portal` is not a React portal. It stores the element and a host elsewhere in the tree
 * renders it, so context resolves at the *host's* position: everything provided between
 * `PortalProvider` (see `app/_layout.tsx`) and this sheet is invisible to its content. React
 * cannot copy contexts reflectively, so the only way across is to render the providers again —
 * with values captured out here, where they are still readable.
 *
 * Write it as a closure over what you already have:
 *
 * ```tsx
 * const contextBridge = useCallback<ContextBridge>(
 *   (content) => <ThingContext.Provider value={thing}>{content}</ThingContext.Provider>,
 *   [thing],
 * );
 * ```
 */
export type ContextBridge = (children: ReactNode) => ReactNode;

type IsolatedBottomSheetModalProps = Omit<
  BottomSheetModalProps,
  "enableDismissOnClose" | "stackBehavior" | "children"
> & {
  /**
   * Nodes only. Gorhom also accepts a render function, but nothing here uses it and a bridge
   * would have to reach around it.
   */
  children?: ReactNode;
  presentation?: "push" | "replace";
  /**
   * Required, and `null` is a real answer: a sheet that needs nothing from its call site should
   * have to say so. The failure it prevents is invisible until someone adds a `useContext` deep
   * inside the sheet and it throws on device only.
   */
  contextBridge: ContextBridge | null;
};

export type IsolatedBottomSheetModalRef = GorhomBottomSheetModalMethods;

export const IsolatedBottomSheetModal = forwardRef<
  IsolatedBottomSheetModalRef,
  IsolatedBottomSheetModalProps
>(function IsolatedBottomSheetModal(props, ref) {
  const { children, presentation = "push", contextBridge, ...bottomSheetProps } = props;
  const { onChange, onDismiss } = bottomSheetProps;
  // Gorhom does not listen for Android's Back, so without this a presented sheet
  // lets the press fall through to the app and quit it. Track presentation here,
  // once, rather than at each of the dozens of call sites.
  const instanceRef = useRef<GorhomBottomSheetModalMethods | null>(null);
  const [isPresented, setIsPresented] = useState(false);

  const setRefs = useCallback(
    (instance: GorhomBottomSheetModalMethods | null) => {
      instanceRef.current = instance;
      if (typeof ref === "function") {
        ref(instance);
      } else if (ref) {
        ref.current = instance;
      }
    },
    [ref],
  );

  const handleChange = useCallback<NonNullable<BottomSheetModalProps["onChange"]>>(
    (index, position, type) => {
      setIsPresented(index >= 0);
      onChange?.(index, position, type);
    },
    [onChange],
  );

  const handleDismiss = useCallback(() => {
    setIsPresented(false);
    onDismiss?.();
  }, [onDismiss]);

  useMobileBackOverlay(isPresented, () => {
    instanceRef.current?.dismiss();
    return true;
  });

  const modal = (
    <GorhomBottomSheetModal
      {...bottomSheetProps}
      ref={setRefs}
      onChange={handleChange}
      onDismiss={handleDismiss}
      enableDismissOnClose
      stackBehavior={presentation}
    >
      <BottomSheetTextInputScope>
        {contextBridge ? contextBridge(children) : children}
      </BottomSheetTextInputScope>
    </GorhomBottomSheetModal>
  );

  return modal;
});

export function useIsolatedBottomSheetVisibility({
  visible,
  isEnabled,
  onClose,
}: {
  visible: boolean;
  isEnabled?: boolean;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const tracker = useMemo(
    () => createBottomSheetVisibilityTracker({ onClose: () => onCloseRef.current() }),
    [],
  );

  const setSheetRef = useCallback(
    (instance: IsolatedBottomSheetModalRef | null) => {
      tracker.attachController(instance as BottomSheetController | null);
    },
    [tracker],
  );

  const handleSheetChange = useCallback(
    (index: number) => tracker.handleSheetIndexChange(index),
    [tracker],
  );

  const handleSheetDismiss = useCallback(() => tracker.handleSheetDismiss(), [tracker]);

  useEffect(() => {
    tracker.syncDesired({ visible, isEnabled });
  }, [isEnabled, tracker, visible]);

  return {
    sheetRef: setSheetRef,
    handleSheetChange,
    handleSheetDismiss,
  };
}
