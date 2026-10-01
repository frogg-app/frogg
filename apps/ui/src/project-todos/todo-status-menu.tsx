import { useCallback } from "react";
import { Text } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ThemedChevron = withUnistyles(ChevronDown, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export interface StatusMenuOption<T extends string> {
  value: T;
  label: string;
}

/** A compact pick-one dropdown, used for the list filter and for setting an item's status. */
export function TodoStatusMenu<T extends string>({
  value,
  options,
  onChange,
  title,
  disabled,
  testID,
}: {
  value: T;
  options: readonly StatusMenuOption<T>[];
  onChange: (value: T) => void;
  title: string;
  disabled?: boolean;
  testID: string;
}) {
  const current = options.find((option) => option.value === value)?.label ?? value;
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        style={styles.trigger}
        disabled={disabled}
        accessibilityLabel={`${title}: ${current}`}
        testID={testID}
      >
        <Text style={styles.triggerText}>{current}</Text>
        <ThemedChevron size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={200} sheetTitle={title}>
        {options.map((option) => (
          <StatusMenuItem
            key={option.value}
            option={option}
            selected={option.value === value}
            onChange={onChange}
            testID={`${testID}-${option.value}`}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusMenuItem<T extends string>({
  option,
  selected,
  onChange,
  testID,
}: {
  option: StatusMenuOption<T>;
  selected: boolean;
  onChange: (value: T) => void;
  testID: string;
}) {
  const handleSelect = useCallback(() => onChange(option.value), [onChange, option.value]);
  return (
    <DropdownMenuItem selected={selected} showSelectedCheck onSelect={handleSelect} testID={testID}>
      {option.label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  triggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
