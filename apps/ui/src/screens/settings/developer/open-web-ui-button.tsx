import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/utils/open-external-url";

/** Opens a sibling daemon's web UI in the browser. */
export function OpenWebUiButton({ url, testID }: { url: string; testID: string }) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => void openExternalUrl(url), [url]);
  return (
    <Button variant="ghost" size="sm" onPress={handlePress} testID={testID}>
      {t("settings.developer.daemonControl.openWebUi")}
    </Button>
  );
}
