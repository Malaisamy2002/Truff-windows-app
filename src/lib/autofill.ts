import type { CustomerRec } from "./data";

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Finds the saved name for a phone number (10-digit match). */
export function nameForPhone(customers: CustomerRec[], phone: string) {
  const p = digits(phone);
  if (p.length < 10) return "";
  const hit = customers.find((c) => digits(c.phone).endsWith(p.slice(-10)));
  return hit?.name?.trim() ?? "";
}

/** Finds the saved phone number for a customer name (case-insensitive exact match). */
export function phoneForName(customers: CustomerRec[], name: string) {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return "";
  const hit = customers.find(
    (c) => (c.name ?? "").trim().toLowerCase() === n && digits(c.phone),
  );
  return hit ? digits(hit.phone).slice(-10) : "";
}
