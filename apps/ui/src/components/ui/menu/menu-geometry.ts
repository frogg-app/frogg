import { isNative } from "@/constants/platform";

/**
 * Shared geometry for menu rows and controls that align with them.
 *
 * The compact height is keyed to touch, not to width: a tablet running the
 * native app sits at `md` but is still worked with a thumb, so it takes the
 * same row height a phone does. Only pointer-driven surfaces (web, Electron)
 * get the tighter desktop row.
 */
export const MENU_ITEM_HEIGHT = { xs: 40, md: isNative ? 40 : 28 } as const;
