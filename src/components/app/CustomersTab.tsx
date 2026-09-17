import { CustomerDirectoryCard } from "./CustomerDirectoryCard";
import { LayoutSection, LayoutSections } from "./LayoutSection";

/**
 * Top-level "Customers" tab (Windows).
 *
 * Previously the customer directory lived inside Settings, which is where the
 * original UX plan's "no dedicated top-level Customers tab" gap came from —
 * it also blocked the Customers-specific two-pane view. This is a thin
 * wrapper: `CustomerDirectoryCard` still holds all the actual list/search/
 * add/merge logic, unchanged from when it lived in Settings, other than the
 * desktop two-pane treatment added directly inside it. Wrapped in
 * `LayoutSections` (matching every other tab) so the one section still
 * participates in Settings → Layout & arrangement, even though there's only
 * one section to arrange today.
 */
export function CustomersTab() {
  return (
    <div className="space-y-6">
      <LayoutSections tabId="customers" className="space-y-6">
        <LayoutSection id="customers.directory">
          <CustomerDirectoryCard />
        </LayoutSection>
      </LayoutSections>
    </div>
  );
}
