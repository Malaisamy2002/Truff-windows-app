import {
  Banknote,
  CalendarPlus,
  Cookie,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { goToTab } from "@/lib/nav";
import { LayoutParts, LayoutPart } from "./LayoutSection";
import { SectionHeading } from "./SectionHeading";

/**
 * The four highest-frequency daily tasks, one tap away from Home — the
 * "Primary actions" zone from the Home redesign. Each button just switches
 * the active tab (via `goToTab`); it does not pre-open a specific form, so
 * the destination tab's own default view (new booking, new bill, etc.)
 * decides what the owner sees next.
 */
const ACTIONS: { id: string; tab: string; label: string; icon: LucideIcon }[] =
  [
    {
      id: "new-booking",
      tab: "turf",
      label: "New booking",
      icon: CalendarPlus,
    },
    { id: "sell-snacks", tab: "snacks", label: "Sell snacks", icon: Cookie },
    {
      id: "collect-payment",
      tab: "dues",
      label: "Collect payment",
      icon: Banknote,
    },
    { id: "add-expense", tab: "money", label: "Add expense", icon: Wallet },
  ];

export function QuickActionsCard() {
  return (
    <section className="space-y-3">
      <LayoutParts sectionId="home.quick-actions" className="space-y-3">
        <LayoutPart id="home.quick-actions.heading">
          <SectionHeading eyebrow="GET STARTED" title="Quick actions" />
        </LayoutPart>
        <LayoutPart id="home.quick-actions.buttons">
          <Card className="frost">
            <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              {ACTIONS.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => goToTab(a.tab)}
                    className="frost-soft lift flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-all hover:border-primary/40"
                  >
                    <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    {a.label}
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </LayoutPart>
      </LayoutParts>
    </section>
  );
}
