import { File, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { pinTab, useFiles } from "../../daemon/files";
import { getClient } from "../../daemon/store";
import { color, font, motion, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Brackets, BracketScope } from "../Brackets";
import { SkeletonRows } from "../Skeleton";
import { T } from "../Text";
import { DOUBLE_MS } from "./FileViewer";

const LIMIT = 100;
const DEBOUNCE_MS = 120;

interface Hit {
  path: string;
  name: string;
  dir: string;
}

const toHit = (path: string): Hit => {
  const p = path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return { path: p, name: i < 0 ? p : p.slice(i + 1), dir: i < 0 ? "" : p.slice(0, i) };
};

type Client = NonNullable<ReturnType<typeof getClient>>;

async function runSearch(
  c: Client,
  root: string,
  q: string,
): Promise<{ hits: Hit[]; error: string | null }> {
  try {
    const r = await c.getDirectorySuggestions({
      cwd: root,
      query: q,
      includeFiles: true,
      includeDirectories: false,
      limit: LIMIT,
    });
    if (r.error) return { hits: [], error: r.error };
    return { hits: r.entries.map((e) => toHit(e.path)), error: null };
  } catch (e) {
    return { hits: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fuzzy filename search across the checkout (gitignore respected), through the daemon's
 * directory suggestions. The protocol has no content search, so this matches paths only.
 */
function useFileSearch(query: string): { hits: Hit[] | null; error: string | null } {
  const root = useFiles((s) => s.root);
  const [state, setState] = useState<{ hits: Hit[] | null; error: string | null }>({
    hits: null,
    error: null,
  });
  useEffect(() => {
    const c = getClient();
    const q = query.trim();
    if (!c || !root || !q) {
      setState({ hits: null, error: null });
      return;
    }
    let live = true;
    setState((s) => ({ hits: s.hits, error: null }));
    const search = async () => {
      const next = await runSearch(c, root, q);
      if (live) setState(next);
    };
    const timer = setTimeout(() => void search(), DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, root]);
  return state;
}

/** The search field under the Files header. Esc clears, then closes. */
export function FileSearchField({
  query,
  onChange,
  onClose,
}: {
  query: string;
  onChange: (q: string) => void;
  onClose: () => void;
}) {
  const onKey = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (e.nativeEvent.key !== "Escape") return;
      if (query) onChange("");
      else onClose();
    },
    [query, onChange, onClose],
  );
  return (
    <View style={[st.field, motion.enter]}>
      <Search size={13} color={color.faint} />
      <TextInput
        accessibilityLabel="Search files"
        placeholder="Search files by name"
        placeholderTextColor={color.faint}
        value={query}
        onChangeText={onChange}
        onKeyPress={onKey}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        style={st.input}
      />
      <Pressable onPress={onClose} accessibilityLabel="Close search" hitSlop={6}>
        <X size={13} color={color.faint} />
      </Pressable>
    </View>
  );
}

export function FileSearchResults({ query }: { query: string }) {
  const { hits, error } = useFileSearch(query);
  if (error)
    return (
      <T v="mono" style={st.error}>
        {error}
      </T>
    );
  if (!hits) return <SkeletonRows rows={5} indent={6} />;
  if (hits.length === 0) return <T style={st.none}>No file names match “{query.trim()}”.</T>;
  return (
    <ScrollView style={st.flex} contentContainerStyle={st.pad}>
      <T v="label" style={st.count}>
        {hits.length === LIMIT ? `first ${LIMIT} matches` : `${hits.length} matches`} · names only
      </T>
      <BracketScope>
        {hits.map((h) => (
          <HitRow key={h.path} hit={h} />
        ))}
      </BracketScope>
    </ScrollView>
  );
}

function HitRow({ hit }: { hit: Hit }) {
  const on = useUi((s) => s.filePath === hit.path);
  const [last, setLast] = useState(0);
  const press = useCallback(() => {
    const now = Date.now();
    useUi.getState().openFile(hit.path);
    if (now - last < DOUBLE_MS) pinTab(hit.path);
    setLast(now);
  }, [hit.path, last]);
  return (
    <Pressable onPress={press} accessibilityLabel={hit.path}>
      {({ hovered }) => (
        <View style={[st.row, hovered && st.hover, on && st.on]}>
          <Brackets on={on} len={6} />
          <File size={14} color={on ? color.cyan2 : color.muted} strokeWidth={1.6} />
          <View style={st.flex}>
            <T numberOfLines={1} style={[st.name, on && st.nameOn]}>
              {hit.name}
            </T>
            {!!hit.dir && (
              <T v="mono" numberOfLines={1} style={st.dir}>
                {hit.dir}
              </T>
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingBottom: 16 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg,
  },
  input: {
    flex: 1,
    paddingVertical: 8,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  count: { paddingHorizontal: 16, paddingVertical: 6 },
  none: { padding: 16, color: color.faint },
  error: { padding: 16, color: color.coral },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    ...web({ transition: "background-color 120ms ease-out" }),
  },
  hover: { backgroundColor: color.wash },
  on: { backgroundColor: "rgba(127,217,230,0.05)" },
  name: { fontSize: 13, color: color.text },
  nameOn: { color: color.cyan2 },
  dir: { fontSize: 10.5, color: color.faint },
});
