import { useCallback, useRef } from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from "react-native";

/** Within this many px of the end counts as "at the bottom" (follows new content). */
const SLACK = 24;

/**
 * Keeps a top-down timeline anchored to its bottom edge, like a messaging app.
 *
 * When the viewport shrinks (keyboard up via adjustResize / visualViewport, composer growing)
 * a ScrollView keeps its top offset, so whatever sat just above the composer slides under it.
 * This keeps the distance from the content end constant instead: at the bottom it stays
 * pinned to the end; scrolled up, the same content stays put relative to the bottom edge.
 * It runs on every layout pass, so it tracks an animated resize frame by frame.
 */
export function useBottomAnchor() {
  const ref = useRef<ScrollView>(null);
  const m = useRef({ y: 0, h: 0, content: 0 });
  const fromEnd = () => Math.max(0, m.current.content - m.current.h - m.current.y);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = e.nativeEvent;
    m.current = {
      y: n.contentOffset.y,
      // Height is owned by onLayout: a scroll event fired by the resize itself would report
      // the new height before onLayout sees the change, and the shrink would go uncompensated.
      h: m.current.h || n.layoutMeasurement.height,
      content: n.contentSize.height,
    };
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    const prev = m.current;
    if (!prev.h || h === prev.h) {
      m.current = { ...prev, h };
      return;
    }
    const gap = fromEnd();
    const y = gap <= SLACK ? Math.max(0, prev.content - h) : Math.max(0, prev.content - h - gap);
    m.current = { ...prev, h, y };
    ref.current?.scrollTo({ y, animated: false });
  }, []);

  const onContentSizeChange = useCallback((_w: number, content: number) => {
    const follow = fromEnd() <= SLACK || !m.current.content;
    m.current = { ...m.current, content };
    if (follow) {
      m.current.y = Math.max(0, content - m.current.h);
      ref.current?.scrollToEnd({ animated: false });
    }
  }, []);

  return { ref, onScroll, onLayout, onContentSizeChange, scrollEventThrottle: 16 };
}
