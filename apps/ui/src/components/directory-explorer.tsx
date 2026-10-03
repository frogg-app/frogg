import {
  ArrowUp,
  Eye,
  EyeOff,
  File,
  Folder,
  Pencil,
  RotateCw,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  breadcrumbSegments,
  directoryNavigationTarget,
  isDoubleActivation,
  moveDirectorySelection,
  newDirectoryNameError,
  visibleDirectoryEntries,
  type DirectoryEntry,
} from "@/add-project-flow/directory-browser";
import { shouldFallBackToHomeDirectory } from "@/add-project-flow/model";
import { joinDirectoryPath, parentDirectory } from "@/add-project-flow/options";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import { useIsCompactInteraction } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useFetchQuery } from "@/data/query";
import type { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { shortenPath } from "@/utils/shorten-path";

type ExplorerClient = ReturnType<typeof useHostRuntimeClient>;

export interface DirectoryExplorerKey {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface DirectoryExplorerHandle {
  /** Returns true when the explorer consumed the key. */
  handleKey: (event: DirectoryExplorerKey) => boolean;
  focus: () => void;
}

interface DirectoryExplorerProps {
  hostId: string;
  client: ExplorerClient;
  initialPath: string;
  /** Used once when the untouched initial path cannot be listed. */
  fallbackPath?: string;
  initialShowHidden: boolean;
  mode: "select" | "create";
  busy: boolean;
  error: string | null;
  onSelect?: (path: string) => void;
  onCreate?: (parentPath: string, name: string) => void;
  onDismissError?: () => void;
}

type FocusTarget = "filter" | "path" | "name" | null;

const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));
function ExplorerIcon({
  icon: Icon,
  size,
  color,
}: {
  icon: LucideIcon;
  size: number;
  color?: string;
}) {
  return <Icon size={size} color={color} />;
}
const MutedIcon = withUnistyles(ExplorerIcon, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ForegroundIcon = withUnistyles(ExplorerIcon, (theme: Theme) => ({
  color: theme.colors.foreground,
}));
const ThemedSpinner = withUnistyles(LoadingSpinner, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

function entryTestId(path: string): string {
  return `directory-explorer-entry-${encodeURIComponent(path)}`;
}

function ToolButton({
  icon,
  label,
  onPress,
  disabled,
  active,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  testID: string;
}) {
  const style = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.toolButton,
      (hovered || pressed || active) && styles.toolButtonActive,
      disabled && styles.disabled,
    ],
    [active, disabled],
  );
  const accessibilityState = useMemo(
    () => ({ disabled: disabled === true, checked: active }),
    [active, disabled],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      // Web exposes the label as a hover tooltip.
      {...({ title: label } as object)}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={style}
      testID={testID}
    >
      <MutedIcon icon={icon} size={15} />
    </Pressable>
  );
}

interface EntryRowProps {
  entry: DirectoryEntry;
  path: string;
  highlighted: boolean;
  disabled: boolean;
  compact: boolean;
  onPress: (entry: DirectoryEntry, path: string) => void;
  onLayout: (path: string, event: LayoutChangeEvent) => void;
}

function EntryRow({
  entry,
  path,
  highlighted,
  disabled,
  compact,
  onPress,
  onLayout,
}: EntryRowProps) {
  const { t } = useTranslation();
  const isDirectory = entry.kind === "directory";
  const style = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.entry,
      compact && styles.entryCompact,
      isDirectory && (hovered || pressed) && styles.entryHover,
      highlighted && styles.entryHighlighted,
      !isDirectory && styles.entryFile,
    ],
    [compact, highlighted, isDirectory],
  );
  const handlePress = useCallback(() => onPress(entry, path), [entry, onPress, path]);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onLayout(path, event),
    [onLayout, path],
  );
  const accessibilityState = useMemo(
    () => ({ selected: highlighted, disabled: disabled || !isDirectory }),
    [disabled, highlighted, isDirectory],
  );
  const kindLabel = isDirectory ? t("directoryBrowser.folder") : t("directoryBrowser.file");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${kindLabel}: ${entry.name}`}
      accessibilityState={accessibilityState}
      disabled={disabled || !isDirectory}
      onPress={handlePress}
      onLayout={handleLayout}
      style={style}
      testID={entryTestId(path)}
    >
      {isDirectory ? (
        <ForegroundIcon icon={Folder} size={16} />
      ) : (
        <MutedIcon icon={File} size={16} />
      )}
      <Text style={isDirectory ? styles.entryName : styles.entryNameFile} numberOfLines={1}>
        {entry.name}
      </Text>
    </Pressable>
  );
}

function crumbStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.crumb, hovered && styles.toolButtonActive];
}

function Crumb({
  segment,
  current,
  disabled,
  onNavigate,
}: {
  segment: { label: string; path: string };
  current: boolean;
  disabled: boolean;
  onNavigate: (path: string) => void;
}) {
  const handlePress = useCallback(() => onNavigate(segment.path), [onNavigate, segment.path]);
  return (
    <Pressable
      accessibilityRole="link"
      disabled={disabled || current}
      onPress={handlePress}
      style={crumbStyle}
      testID={`directory-explorer-crumb-${encodeURIComponent(segment.path)}`}
    >
      <Text style={current ? styles.crumbCurrent : styles.crumbText} numberOfLines={1}>
        {segment.label}
      </Text>
    </Pressable>
  );
}

interface PathBarProps {
  path: string;
  disabled: boolean;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  onNavigate: (path: string) => void;
  onFocusChange: (target: FocusTarget) => void;
}

/** Breadcrumbs by default; an editable address field on demand (click, pencil, Mod+L). */
function PathBar({ path, disabled, editing, setEditing, onNavigate, onFocusChange }: PathBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const scrollRef = useRef<ScrollView>(null);
  const segments = useMemo(() => breadcrumbSegments(path), [path]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.replaceText(path);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [editing, path]);

  const submit = useCallback(() => {
    const value = inputRef.current?.getText().trim() ?? "";
    setEditing(false);
    if (value && value !== path) onNavigate(value);
  }, [onNavigate, path, setEditing]);
  const handleFocus = useCallback(() => onFocusChange("path"), [onFocusChange]);
  const handleBlur = useCallback(() => {
    onFocusChange(null);
    setEditing(false);
  }, [onFocusChange, setEditing]);
  const startEditing = useCallback(() => setEditing(true), [setEditing]);
  const scrollToEnd = useCallback(() => scrollRef.current?.scrollToEnd({ animated: false }), []);

  if (editing) {
    return (
      <View style={[styles.pathBar, styles.pathBarEditing]} testID="directory-explorer-path-bar">
        <ThemedTextInput
          ref={inputRef}
          initialValue={path}
          style={styles.pathInput}
          placeholder={t("directoryBrowser.pathPlaceholder")}
          accessibilityLabel={t("directoryBrowser.pathLabel")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSubmitEditing={submit}
          testID="directory-explorer-path-input"
        />
      </View>
    );
  }

  return (
    <View style={styles.pathBar} testID="directory-explorer-path-bar">
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={scrollToEnd}
        style={styles.crumbScroll}
        contentContainerStyle={styles.crumbs}
        accessibilityLabel={t("directoryBrowser.pathLabel")}
      >
        {segments.map((segment, index) => {
          const last = index === segments.length - 1;
          return (
            <View key={segment.path} style={styles.crumbItem}>
              {index > 0 && segments[index - 1]?.label !== "/" ? (
                <Text style={styles.crumbSeparator}>/</Text>
              ) : null}
              <Crumb segment={segment} current={last} disabled={disabled} onNavigate={onNavigate} />
            </View>
          );
        })}
      </ScrollView>
      {/* The blank strip after the crumbs switches to typing, like a file manager's address bar. */}
      <Pressable
        style={styles.crumbFill}
        onPress={startEditing}
        disabled={disabled}
        accessibilityElementsHidden
        importantForAccessibility="no"
        testID="directory-explorer-path-fill"
      />
      <ToolButton
        icon={Pencil}
        label={t("directoryBrowser.editPath")}
        onPress={startEditing}
        disabled={disabled}
        testID="directory-explorer-edit-path"
      />
    </View>
  );
}

/**
 * A file-manager style folder browser over the daemon's `file_explorer` listing:
 * breadcrumbs with an editable address, up/refresh, filter, hidden-item toggle,
 * folders-first entries and one clear primary action. Used for choosing an
 * existing project folder and for choosing where to create a new one.
 */
export const DirectoryExplorer = forwardRef<DirectoryExplorerHandle, DirectoryExplorerProps>(
  // One cohesive keyboard/selection surface; splitting it would scatter shared state.
  // eslint-disable-next-line complexity
  function DirectoryExplorer(props, ref) {
    const {
      hostId,
      client,
      initialPath,
      fallbackPath,
      initialShowHidden,
      mode,
      busy,
      error,
      onSelect,
      onCreate,
      onDismissError,
    } = props;
    const { t } = useTranslation();
    const compact = useIsCompactInteraction();
    const [path, setPath] = useState(initialPath);
    const [filter, setFilter] = useState("");
    const [showHidden, setShowHidden] = useState(initialShowHidden);
    const [highlight, setHighlight] = useState(-1);
    const [editingPath, setEditingPath] = useState(false);
    const [name, setName] = useState("");
    const [nameError, setNameError] = useState<string | null>(null);
    const filterRef = useRef<EditingTextInputHandle>(null);
    const nameRef = useRef<EditingTextInputHandle>(null);
    const listRef = useRef<ScrollView>(null);
    const focusRef = useRef<FocusTarget>(null);
    const lastPressRef = useRef<{ id: string; at: number } | null>(null);
    const rowLayoutsRef = useRef(new Map<string, { y: number; height: number }>());
    const viewportRef = useRef({ offset: 0, height: 0 });

    const listing = useFetchQuery({
      queryKey: ["directory-explorer", hostId, path],
      queryFn: async () => {
        if (!client) throw new Error("unavailable");
        return client.listDirectory(path, ".");
      },
      enabled: Boolean(client),
      dataShape: "value",
      retry: false,
      staleTimeMs: 0,
    });
    const data = listing.data;
    // COMPAT(directoryAbsolutePath): older 0.6 daemons omit the resolved path.
    const currentPath = data?.absolutePath ?? path;
    const parent = parentDirectory(currentPath);
    const loading = listing.isPending && listing.fetchStatus !== "idle";
    const failed = listing.isError && !listing.isFetching;
    const refreshing = Boolean(data) && listing.isFetching;
    const ready = Boolean(data) && !failed;

    const entries = useMemo(
      () => (data ? visibleDirectoryEntries(data.entries, { showHidden, filter }) : []),
      [data, filter, showHidden],
    );
    const directories = useMemo(() => entries.filter((e) => e.kind === "directory"), [entries]);
    const highlighted = directories[highlight] ?? null;
    const typedTarget = directoryNavigationTarget(currentPath, filter);

    // A brand's provisioned root may not exist on this host; land in home instead.
    useEffect(() => {
      if (!fallbackPath) return;
      if (
        !shouldFallBackToHomeDirectory({
          listingFailed: failed,
          browsedDirectory: path,
          brandDirectory: initialPath,
        })
      )
        return;
      setPath(fallbackPath);
    }, [failed, fallbackPath, initialPath, path]);

    const navigate = useCallback(
      (next: string) => {
        setFilter("");
        filterRef.current?.replaceText("");
        setHighlight(-1);
        lastPressRef.current = null;
        rowLayoutsRef.current.clear();
        listRef.current?.scrollTo({ y: 0, animated: false });
        onDismissError?.();
        if (next === path) void listing.refetch();
        else setPath(next);
      },
      [listing, onDismissError, path],
    );
    const goUp = useCallback(() => {
      if (parent) navigate(parent);
    }, [navigate, parent]);
    const openEntry = useCallback(
      (entry: DirectoryEntry) => {
        if (entry.kind === "directory") navigate(joinDirectoryPath(currentPath, entry.name));
      },
      [currentPath, navigate],
    );

    const submitPrimary = useCallback(() => {
      if (busy || !ready) return;
      if (mode === "select") {
        onSelect?.(currentPath);
        return;
      }
      const problem = newDirectoryNameError(name);
      if (problem) {
        setNameError(
          problem === "empty" ? t("directoryBrowser.nameEmpty") : t("directoryBrowser.nameInvalid"),
        );
        nameRef.current?.focus();
        return;
      }
      onCreate?.(currentPath, name.trim());
    }, [busy, currentPath, mode, name, onCreate, onSelect, ready, t]);

    // Keep the highlighted row inside the visible part of the list.
    useEffect(() => {
      if (!highlighted) return;
      const layout = rowLayoutsRef.current.get(joinDirectoryPath(currentPath, highlighted.name));
      if (!layout) return;
      const { offset, height } = viewportRef.current;
      if (layout.y < offset) listRef.current?.scrollTo({ y: layout.y, animated: false });
      else if (layout.y + layout.height > offset + height)
        listRef.current?.scrollTo({ y: layout.y + layout.height - height, animated: false });
    }, [currentPath, highlighted]);

    const handleEntryPress = useCallback(
      (entry: DirectoryEntry, entryPath: string) => {
        if (entry.kind !== "directory") return;
        const now = Date.now();
        // Touch: a tap opens. Pointer: click selects, double-click opens.
        if (compact || isDoubleActivation(lastPressRef.current, entryPath, now)) {
          lastPressRef.current = null;
          openEntry(entry);
          return;
        }
        lastPressRef.current = { id: entryPath, at: now };
        setHighlight(directories.indexOf(entry));
      },
      [compact, directories, openEntry],
    );
    const handleRowLayout = useCallback((rowPath: string, event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      rowLayoutsRef.current.set(rowPath, { y, height });
    }, []);
    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
      viewportRef.current.offset = event.nativeEvent.contentOffset.y;
    }, []);
    const handleListLayout = useCallback((event: LayoutChangeEvent) => {
      viewportRef.current.height = event.nativeEvent.layout.height;
    }, []);

    // Mod chords: edit path, toggle hidden items, primary action.
    const handleChord = useCallback(
      (event: DirectoryExplorerKey): boolean => {
        const key = event.key.toLowerCase();
        if (key === "l") setEditingPath(true);
        else if (event.shiftKey && key === ".") setShowHidden((value) => !value);
        else if (key === "enter") submitPrimary();
        else return false;
        return true;
      },
      [submitPrimary],
    );
    const handleKey = useCallback(
      (event: DirectoryExplorerKey): boolean => {
        const mod = Boolean(event.metaKey || event.ctrlKey);
        const focus = focusRef.current;
        if (busy) return event.key !== "Escape";
        if (focus === "path") {
          if (event.key === "Escape") {
            setEditingPath(false);
            return true;
          }
          return false;
        }
        if (mod) return handleChord(event);
        if (focus === "name") {
          if (event.key === "Enter") {
            submitPrimary();
            return true;
          }
          return false;
        }
        switch (event.key) {
          case "ArrowDown":
          case "ArrowUp":
            if (event.altKey && event.key === "ArrowUp") {
              goUp();
              return true;
            }
            setHighlight((index) =>
              moveDirectorySelection(
                index,
                directories.length,
                event.key === "ArrowDown" ? "next" : "previous",
              ),
            );
            return true;
          case "Enter":
            if (typedTarget) navigate(typedTarget);
            else if (highlighted) openEntry(highlighted);
            return true;
          case "Backspace":
            if (filter) return false;
            goUp();
            return true;
          case "Escape":
            if (!filter) return false;
            navigateFilter("");
            return true;
          default:
            // Type-to-filter after a row click moved focus off the filter field.
            if (focus === null && event.key.length === 1 && !mod && !event.altKey) {
              navigateFilter(filter + event.key);
              setHighlight(0);
              filterRef.current?.focus();
              return true;
            }
            return false;
        }
        function navigateFilter(value: string) {
          setFilter(value);
          filterRef.current?.replaceText(value);
        }
      },
      [
        busy,
        handleChord,
        directories.length,
        filter,
        goUp,
        highlighted,
        navigate,
        openEntry,
        submitPrimary,
        typedTarget,
      ],
    );

    useImperativeHandle(ref, () => ({ handleKey, focus: () => filterRef.current?.focus() }), [
      handleKey,
    ]);

    useEffect(() => {
      const timer = setTimeout(() => filterRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }, []);

    const handleFilterChange = useCallback((value: string) => {
      setFilter(value);
      setHighlight(value.trim() ? 0 : -1);
    }, []);
    const handleNameChange = useCallback(
      (value: string) => {
        setName(value);
        setNameError(null);
        onDismissError?.();
      },
      [onDismissError],
    );
    const setFocus = useCallback((target: FocusTarget) => {
      focusRef.current = target;
    }, []);
    const handleFilterFocus = useCallback(() => setFocus("filter"), [setFocus]);
    const handleNameFocus = useCallback(() => setFocus("name"), [setFocus]);
    const handleBlur = useCallback(() => setFocus(null), [setFocus]);
    // Native hardware keyboards report keys through the focused field.
    const handleNativeKeyPress = useCallback(
      ({ nativeEvent }: { nativeEvent: { key: string } }) => {
        if (["ArrowDown", "ArrowUp", "Backspace", "Escape"].includes(nativeEvent.key))
          handleKey({ key: nativeEvent.key });
      },
      [handleKey],
    );
    const handleFilterSubmit = useCallback(() => handleKey({ key: "Enter" }), [handleKey]);
    const handleNameSubmit = useCallback(() => submitPrimary(), [submitPrimary]);
    const toggleHidden = useCallback(() => setShowHidden((value) => !value), []);
    const refresh = useCallback(() => {
      onDismissError?.();
      void listing.refetch();
    }, [listing, onDismissError]);

    const goToTyped = useCallback(() => {
      if (typedTarget) navigate(typedTarget);
    }, [navigate, typedTarget]);
    const trimmedName = name.trim();
    const preview =
      ready && mode === "create" && trimmedName && !newDirectoryNameError(trimmedName)
        ? joinDirectoryPath(currentPath, trimmedName)
        : null;

    const destinationText = preview
      ? t("directoryBrowser.createPreview", { path: shortenPath(preview) })
      : shortenPath(currentPath);
    const create = mode === "create";
    let primaryLabel = create ? t("directoryBrowser.createHere") : t("directoryBrowser.choose");
    if (busy)
      primaryLabel = create ? t("directoryBrowser.creating") : t("directoryBrowser.opening");

    return (
      <View style={styles.root} testID="directory-explorer">
        <View style={styles.toolbar}>
          <ToolButton
            icon={ArrowUp}
            label={t("directoryBrowser.up")}
            onPress={goUp}
            disabled={!parent || busy}
            testID="directory-explorer-up"
          />
          <PathBar
            path={currentPath}
            disabled={busy}
            editing={editingPath}
            setEditing={setEditingPath}
            onNavigate={navigate}
            onFocusChange={setFocus}
          />
          <ToolButton
            icon={RotateCw}
            label={t("directoryBrowser.refresh")}
            onPress={refresh}
            disabled={busy || listing.isFetching}
            testID="directory-explorer-refresh"
          />
        </View>
        <View style={styles.filterRow}>
          <View style={styles.filterField}>
            <MutedIcon icon={Search} size={14} />
            <ThemedTextInput
              ref={filterRef}
              initialValue=""
              onChangeText={handleFilterChange}
              onFocus={handleFilterFocus}
              onBlur={handleBlur}
              // Web keys arrive through the flow's overlay handler instead.
              onKeyPress={isWeb ? undefined : handleNativeKeyPress}
              onSubmitEditing={isWeb ? undefined : handleFilterSubmit}
              placeholder={t("directoryBrowser.filterPlaceholder")}
              accessibilityLabel={t("directoryBrowser.filterPlaceholder")}
              style={styles.filterInput}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              returnKeyType="go"
              blurOnSubmit={false}
              testID="directory-explorer-filter"
            />
            {refreshing ? <ThemedSpinner size="small" /> : null}
          </View>
          <ToolButton
            icon={showHidden ? Eye : EyeOff}
            label={showHidden ? t("directoryBrowser.hideHidden") : t("directoryBrowser.showHidden")}
            onPress={toggleHidden}
            active={showHidden}
            testID="directory-explorer-toggle-hidden"
          />
        </View>
        <ScrollView
          ref={listRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="always"
          onScroll={handleScroll}
          scrollEventThrottle={32}
          onLayout={handleListLayout}
          testID="directory-explorer-list"
        >
          {typedTarget ? (
            <Pressable style={styles.goToRow} onPress={goToTyped} testID="directory-explorer-go-to">
              <MutedIcon icon={Folder} size={16} />
              <Text style={styles.entryName} numberOfLines={1}>
                {t("directoryBrowser.goTo", { path: filter.trim() })}
              </Text>
            </Pressable>
          ) : null}
          {loading ? (
            <View style={styles.state} testID="directory-explorer-loading">
              <ThemedSpinner size="small" />
              <Text style={styles.stateText}>{t("common.loading")}</Text>
            </View>
          ) : null}
          {failed ? (
            <View style={styles.state} testID="directory-explorer-error">
              <Text style={styles.errorText}>
                {t("directoryBrowser.failed")}
                {listing.error instanceof Error && listing.error.message !== "unavailable"
                  ? `: ${listing.error.message}`
                  : ""}
              </Text>
              <Button
                size="sm"
                variant="outline"
                onPress={refresh}
                testID="directory-explorer-retry"
              >
                {t("common.actions.retry")}
              </Button>
            </View>
          ) : null}
          {ready && entries.length === 0 && !typedTarget ? (
            <Text style={styles.stateText} testID="directory-explorer-empty">
              {filter.trim()
                ? t("directoryBrowser.noMatches", { filter: filter.trim() })
                : t("directoryBrowser.empty")}
            </Text>
          ) : null}
          {ready
            ? entries.map((entry) => {
                const entryPath = joinDirectoryPath(currentPath, entry.name);
                return (
                  <EntryRow
                    key={entryPath}
                    entry={entry}
                    path={entryPath}
                    highlighted={entry === highlighted}
                    disabled={busy}
                    compact={compact}
                    onPress={handleEntryPress}
                    onLayout={handleRowLayout}
                  />
                );
              })
            : null}
        </ScrollView>
        <View style={styles.actionBar}>
          {error ? (
            <Text style={styles.errorText} testID="directory-explorer-action-error">
              {error}
            </Text>
          ) : null}
          {mode === "create" ? (
            <View style={styles.nameBlock}>
              <View style={[styles.nameField, nameError ? styles.nameFieldError : null]}>
                <ThemedTextInput
                  ref={nameRef}
                  initialValue=""
                  onChangeText={handleNameChange}
                  onFocus={handleNameFocus}
                  onBlur={handleBlur}
                  onSubmitEditing={isWeb ? undefined : handleNameSubmit}
                  placeholder={t("directoryBrowser.namePlaceholder")}
                  accessibilityLabel={t("directoryBrowser.nameLabel")}
                  style={styles.nameInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  returnKeyType="done"
                  testID="directory-explorer-name"
                />
              </View>
              {nameError ? (
                <Text style={styles.errorText} testID="directory-explorer-name-error">
                  {nameError}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={[styles.primaryRow, compact && styles.primaryRowCompact]}>
            <Text
              style={styles.destination}
              numberOfLines={1}
              testID="directory-explorer-destination"
            >
              {destinationText}
            </Text>
            <Button
              variant="default"
              size="sm"
              onPress={submitPrimary}
              disabled={!ready || busy}
              loading={busy}
              testID="directory-explorer-primary"
            >
              {primaryLabel}
            </Button>
          </View>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  root: { flexShrink: 1, minHeight: 0 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
  toolButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  toolButtonActive: { backgroundColor: theme.colors.surface2 },
  disabled: { opacity: theme.opacity[50] },
  pathBar: {
    flex: 1,
    minWidth: 0,
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  pathBarEditing: { borderColor: theme.colors.accent, paddingHorizontal: theme.spacing[2] },
  pathInput: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    outlineStyle: "none",
  } as object,
  crumbScroll: { flexGrow: 0, flexShrink: 1 },
  crumbs: { alignItems: "center" },
  crumbItem: { flexDirection: "row", alignItems: "center" },
  crumb: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  crumbText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  crumbCurrent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  crumbSeparator: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  crumbFill: { flex: 1, alignSelf: "stretch", minWidth: theme.spacing[4] },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  filterField: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  filterInput: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[1],
    outlineStyle: "none",
  } as object,
  list: { flexGrow: 0, flexShrink: 1, minHeight: 160 },
  listContent: { paddingVertical: theme.spacing[1] },
  goToRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: 6,
  },
  entryCompact: { minHeight: 44 },
  entryHover: { backgroundColor: theme.colors.surface1 },
  entryHighlighted: { backgroundColor: theme.colors.surface2 },
  entryFile: { opacity: 0.7 },
  entryName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  entryNameFile: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  state: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  errorText: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  actionBar: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  nameBlock: { gap: theme.spacing[1] },
  nameField: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[2],
  },
  nameFieldError: { borderColor: theme.colors.destructive },
  nameInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[2],
    outlineStyle: "none",
  } as object,
  primaryRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[3] },
  primaryRowCompact: { flexDirection: "column", alignItems: "stretch" },
  destination: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
