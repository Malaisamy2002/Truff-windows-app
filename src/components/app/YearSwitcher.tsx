import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currentYear, useAvailableYears, useSelectedYear } from "@/lib/years";

/**
 * Chooses which year the screens show. Defaults to the calendar year, so a new
 * year becomes active automatically on 1 January.
 */
export function YearSwitcher() {
  const [year, setYear] = useSelectedYear();
  const years = useAvailableYears();
  const options = years.includes(year)
    ? years
    : [year, ...years].sort((a, b) => b - a);

  return (
    <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
      <SelectTrigger
        aria-label="Year"
        className="h-8 w-[92px] border-white/25 bg-white/10 text-primary-foreground"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
            {y === currentYear() ? " ·" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
