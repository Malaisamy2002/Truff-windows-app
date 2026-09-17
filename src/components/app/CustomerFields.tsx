import { useEffect, useMemo, useRef, useState } from "react";
import { UserPlus, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCustomers, useSaveCustomer, type CustomerRec } from "@/lib/data";
import { nameForPhone, phoneForName } from "@/lib/autofill";

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 10);

function matches(c: CustomerRec, q: string) {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  return (
    (c.name ?? "").toLowerCase().includes(term) ||
    (c.phone ?? "").toLowerCase().includes(term.replace(/\D/g, "") || term)
  );
}

/**
 * Shared customer block: name + phone are single merged combobox inputs — type to
 * search the saved customer directory inline, pick a suggestion to fill both fields.
 */
export function CustomerFields({
  name,
  phone,
  onChange,
  nameLabel = "Customer",
  phoneLabel = "Phone",
  className,
  inputClassName,
  allowQuickAdd = true,
}: {
  name: string;
  phone: string;
  onChange: (next: { name: string; phone: string }) => void;
  nameLabel?: string;
  phoneLabel?: string;
  className?: string;
  inputClassName?: string;
  allowQuickAdd?: boolean;
}) {
  const { data: customers = [] } = useCustomers();
  const saveCustomer = useSaveCustomer();
  const [open, setOpen] = useState<"name" | "phone" | null>(null);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const withPhone = useMemo(
    () => customers.filter((c) => (c.phone ?? "").trim()),
    [customers],
  );

  const suggestions = useMemo(() => {
    const pool = open === "phone" ? withPhone : customers;
    const q = open === "phone" ? phone : name;
    return pool.filter((c) => matches(c, q)).slice(0, 8);
  }, [open, customers, withPhone, name, phone]);

  const pick = (c: CustomerRec) => {
    onChange({ name: (c.name ?? "").trim(), phone: digits(c.phone ?? "") });
    setOpen(null);
    setActive(0);
  };

  const quickAdd = () => {
    if (!name.trim()) {
      toast.error("Enter a name first");
      return;
    }
    saveCustomer.mutate(
      { name: name.trim(), phone: phone || null },
      { onSuccess: () => toast.success("Customer saved") },
    );
  };

  const keyNav = (e: React.KeyboardEvent) => {
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = suggestions[active];
      if (hit) pick(hit);
    } else if (e.key === "Escape") {
      setOpen(null);
    }
  };

  const dropdown = (field: "name" | "phone") =>
    open === field ? (
      <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <Search className="size-3.5" />
          {field === "phone" ? "Saved phone numbers" : "Saved customers"}
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {suggestions.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No match — keep typing to add new.
            </p>
          )}
          {suggestions.map((c, i) => {
            const selected =
              (c.name ?? "").trim().toLowerCase() === name.trim().toLowerCase();
            return (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                  i === active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/60",
                )}
              >
                <span className="truncate font-medium">{c.name}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {c.phone ?? "—"}
                  {selected && <Check className="size-3.5 text-primary" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className={cn("grid gap-3 md:grid-cols-2", className)}>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{nameLabel}</Label>
        <div className="relative">
          <Input
            className={inputClassName}
            value={name}
            placeholder="Search or type name"
            autoComplete="off"
            role="combobox"
            aria-expanded={open === "name"}
            onFocus={() => {
              setOpen("name");
              setActive(0);
            }}
            onKeyDown={keyNav}
            onChange={(e) => {
              const value = e.target.value;
              setOpen("name");
              setActive(0);
              const found = !phone ? phoneForName(customers, value) : "";
              onChange({ name: value, phone: found || phone });
            }}
          />
          {dropdown("name")}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{phoneLabel}</Label>
        <div className="flex gap-1">
          <div className="relative flex-1">
            <Input
              className={inputClassName}
              inputMode="numeric"
              value={phone}
              placeholder="Search or type 10-digit"
              autoComplete="off"
              role="combobox"
              aria-expanded={open === "phone"}
              onFocus={() => {
                setOpen("phone");
                setActive(0);
              }}
              onKeyDown={keyNav}
              onChange={(e) => {
                const value = digits(e.target.value);
                setOpen("phone");
                setActive(0);
                const found = !name ? nameForPhone(customers, value) : "";
                onChange({ name: found || name, phone: value });
              }}
            />
            {dropdown("phone")}
          </div>
          {allowQuickAdd && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="Save this customer"
              title="Save this customer"
              onClick={quickAdd}
              disabled={saveCustomer.isPending}
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
