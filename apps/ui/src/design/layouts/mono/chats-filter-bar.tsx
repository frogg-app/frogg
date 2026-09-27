import { ChevronDown, GitBranch, Search } from "lucide-react-native";
import { useCallback, useMemo, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuItem, MenuRoot, MenuSurface, MenuTrigger } from "@/components/ui/menu";
import type { MenuTriggerState } from "@/components/ui/menu/menu-root";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { MonoChatRow } from "./mono-data";
import { MONO_STATUS_LABEL, MONO_STATUS_ORDER, MonoText, StatusDot } from "./mono-parts";
import { useMonoScope } from "./mono-scope";

// The filter row above Mono's chats table, after Vercel's deployments filters: a search box,
// then Status, Project and Branch pickers. Options and counts come from the rows themselves.

const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedTextInput = withUnistyles(TextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const ThemedSearch = withUnistyles(Search);
const ThemedChevron = withUnistyles(ChevronDown);
const ThemedBranch = withUnistyles(GitBranch);
const SEARCH_ICON = <ThemedSearch size={14} uniProps={mutedIcon} />;
const CHEVRON = <ThemedChevron size={14} uniProps={mutedIcon} />;
const BRANCH_ICON = <ThemedBranch size={13} uniProps={mutedIcon} />;

// preview copy
const COPY = {
  search: "Find chats…",
  allStatuses: "Status",
  allProjects: "All projects",
  allBranches: "All branches",
  noProject: "No project",
};

export function ChatsFilterBar({
  rows,
  compact,
}: {
  rows: readonly MonoChatRow[];
  compact: boolean;
}) {
  const query = useMonoScope((state) => state.query);
  const setQuery = useMonoScope((state) => state.setQuery);
  // The field is uncontrolled; "Clear filters" bumps the token to remount it empty.
  const resetToken = useMonoScope((state) => state.resetToken);
  const pickers = (
    <>
      <StatusPicker rows={rows} />
      <ProjectPicker rows={rows} />
      <BranchPicker rows={rows} />
    </>
  );
  return (
    <View style={styles.bar}>
      <View style={compact ? styles.search : styles.searchWide}>
        {SEARCH_ICON}
        <ThemedTextInput
          key={resetToken}
          initialValue={query}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder={COPY.search}
          accessibilityLabel={COPY.search}
          style={styles.searchInput}
          testID="mono-chats-search"
        />
      </View>
      {compact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pickerScroll}
          contentContainerStyle={styles.pickers}
        >
          {pickers}
        </ScrollView>
      ) : (
        pickers
      )}
    </View>
  );
}

function triggerStyle({ hovered, open }: MenuTriggerState) {
  return [styles.picker, (hovered || open) && styles.pickerHovered];
}

function Picker({
  label,
  leading,
  testID,
  children,
}: {
  label: string;
  leading?: ReactNode;
  testID: string;
  children: ReactNode;
}) {
  return (
    <MenuRoot compactMode="sheet">
      <MenuTrigger style={triggerStyle} testID={testID} accessibilityLabel={label}>
        {leading}
        <Text style={styles.pickerText} numberOfLines={1}>
          {label}
        </Text>
        {CHEVRON}
      </MenuTrigger>
      <MenuSurface side="bottom" align="start" width={240} sheetTitle={label} scrollable>
        {children}
      </MenuSurface>
    </MenuRoot>
  );
}

function StatusPicker({ rows }: { rows: readonly MonoChatRow[] }) {
  const status = useMonoScope((state) => state.status);
  const setStatus = useMonoScope((state) => state.setStatus);
  const counts = useMemo(() => {
    const byBucket = new Map<SidebarStateBucket, number>();
    for (const row of rows) byBucket.set(row.bucket, (byBucket.get(row.bucket) ?? 0) + 1);
    return byBucket;
  }, [rows]);
  const leading = useMemo(
    () =>
      status ? (
        <StatusDot bucket={status} />
      ) : (
        <View style={styles.dotStack}>
          {MONO_STATUS_ORDER.slice(0, 4).map((bucket) => (
            <StatusDot key={bucket} bucket={bucket} />
          ))}
        </View>
      ),
    [status],
  );
  const clear = useCallback(() => setStatus(null), [setStatus]);
  return (
    <Picker
      label={status ? MONO_STATUS_LABEL[status] : COPY.allStatuses}
      leading={leading}
      testID="mono-filter-status"
    >
      <MenuItem selected={status === null} showSelectedCheck onSelect={clear}>
        {COPY.allStatuses}
      </MenuItem>
      {MONO_STATUS_ORDER.map((bucket) => (
        <StatusOption
          key={bucket}
          bucket={bucket}
          count={counts.get(bucket) ?? 0}
          selected={status === bucket}
          onSelect={setStatus}
        />
      ))}
    </Picker>
  );
}

function StatusOption({
  bucket,
  count,
  selected,
  onSelect,
}: {
  bucket: SidebarStateBucket;
  count: number;
  selected: boolean;
  onSelect: (bucket: SidebarStateBucket) => void;
}) {
  const handle = useCallback(() => onSelect(bucket), [bucket, onSelect]);
  const leading = useMemo(() => <StatusDot bucket={bucket} />, [bucket]);
  const trailing = useMemo(() => <MonoText tone="faint">{count}</MonoText>, [count]);
  return (
    <MenuItem
      selected={selected}
      showSelectedCheck
      leading={leading}
      trailing={trailing}
      onSelect={handle}
    >
      {MONO_STATUS_LABEL[bucket]}
    </MenuItem>
  );
}

function ValueOption({
  value,
  label,
  selected,
  onSelect,
}: {
  value: string | null;
  label: string;
  selected: boolean;
  onSelect: (value: string | null) => void;
}) {
  const handle = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <MenuItem selected={selected} showSelectedCheck onSelect={handle}>
      {label}
    </MenuItem>
  );
}

function distinct(values: Iterable<string | null>): string[] {
  const set = new Set<string>();
  for (const value of values) if (value) set.add(value);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function ProjectPicker({ rows }: { rows: readonly MonoChatRow[] }) {
  const projectName = useMonoScope((state) => state.projectName);
  const setProjectName = useMonoScope((state) => state.setProjectName);
  const names = useMemo(() => distinct(rows.map((row) => row.projectName)), [rows]);
  return (
    <Picker label={projectName ?? COPY.allProjects} testID="mono-filter-project">
      <ValueOption
        value={null}
        label={COPY.allProjects}
        selected={projectName === null}
        onSelect={setProjectName}
      />
      {names.map((name) => (
        <ValueOption
          key={name}
          value={name}
          label={name}
          selected={projectName === name}
          onSelect={setProjectName}
        />
      ))}
    </Picker>
  );
}

function BranchPicker({ rows }: { rows: readonly MonoChatRow[] }) {
  const branch = useMonoScope((state) => state.branch);
  const setBranch = useMonoScope((state) => state.setBranch);
  const branches = useMemo(() => distinct(rows.map((row) => row.branch)), [rows]);
  return (
    <Picker label={branch ?? COPY.allBranches} leading={BRANCH_ICON} testID="mono-filter-branch">
      <ValueOption
        value={null}
        label={COPY.allBranches}
        selected={branch === null}
        onSelect={setBranch}
      />
      {branches.map((name) => (
        <ValueOption
          key={name}
          value={name}
          label={name}
          selected={branch === name}
          onSelect={setBranch}
        />
      ))}
    </Picker>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: { xs: "column", md: "row" },
    alignItems: { xs: "stretch", md: "center" },
    gap: 8,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  searchWide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  pickerScroll: {
    flexGrow: 0,
  },
  searchInput: {
    flex: 1,
    height: 34,
    fontSize: 13,
    color: theme.colors.foreground,
    outlineWidth: 0,
  },
  pickers: {
    flexDirection: "row",
    gap: 8,
  },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 10,
    minWidth: 140,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  pickerHovered: {
    backgroundColor: theme.colors.surface1,
  },
  pickerText: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.foreground,
  },
  dotStack: {
    flexDirection: "row",
    gap: 2,
  },
}));
