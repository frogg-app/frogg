import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { DesignSlot } from "@/design/layouts/design-slot";
import { OpenProjectScreen } from "@/screens/open-project-screen";

const EMPTY_SLOT_PROPS = {} as const;

export default function OpenProjectRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <DesignSlot name="home" props={EMPTY_SLOT_PROPS}>
        <OpenProjectScreen />
      </DesignSlot>
    </HostRouteBootstrapBoundary>
  );
}
