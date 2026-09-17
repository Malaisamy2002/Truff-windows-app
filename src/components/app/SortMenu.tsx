import { ArrowDownAZ, ArrowUpAZ, CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDMY } from "@/lib/biz";
import { dateKeyFromDate, type SortDir, type SortOption } from "@/lib/sort";

type SortMenuProps<T extends string> = {
  options: SortOption<T>[];
  field: T;
  dir: SortDir;
  onFieldChange: (field: T) => void;
  onToggleDir: () => void;
  className?: string;
  /**
   * Which field value counts as "the date field" — pass e.g. "date" here to
   * show a calendar-popup button next to the sort control whenever that
   * field is the active sort. Picking a day in the popup narrows the list
   * to just that one day (via onSelectDate); omit these three props to keep
   * a plain sort menu with no date popup.
   */
  dateField?: T;
  selectedDate?: string | undefined;
  onSelectDate?: (date: string | undefined) => void;
};

/**
 * One consistent "Sort by [field] [asc/desc]" control for card headers.
 * Pairs with the useSortState hook in src/lib/sort.ts.
 */
export function SortMenu<T extends string>({
  options,
  field,
  dir,
  onFieldChange,
  onToggleDir,
  className,
  dateField,
  selectedDate,
  onSelectDate,
}: SortMenuProps<T>) {
  const showDatePopup =
    dateField !== undefined && field === dateField && !!onSelectDate;
  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <Select value={field} onValueChange={(v) => onFieldChange(v as T)}>
        <SelectTrigger className="h-8 w-[9.5rem]" aria-label="Sort by">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="icon"
        variant="outline"
        className="h-8 w-8 shrink-0"
        onClick={onToggleDir}
        aria-label={dir === "asc" ? "Sort ascending" : "Sort descending"}
        title={dir === "asc" ? "Ascending" : "Descending"}
      >
        {dir === "asc" ? (
          <ArrowUpAZ className="h-4 w-4" />
        ) : (
          <ArrowDownAZ className="h-4 w-4" />
        )}
      </Button>
      {showDatePopup && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant={selectedDate ? "default" : "outline"}
              className="h-8 w-8 shrink-0"
              aria-label="Pick a date"
              title={
                selectedDate
                  ? `Showing ${formatDMY(selectedDate)}`
                  : "Pick a date"
              }
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={
                selectedDate ? new Date(`${selectedDate}T00:00:00`) : undefined
              }
              onSelect={(d) =>
                onSelectDate?.(d ? dateKeyFromDate(d) : undefined)
              }
              autoFocus
            />
            {selectedDate && (
              <div className="border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => onSelectDate?.(undefined)}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Clear date
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
