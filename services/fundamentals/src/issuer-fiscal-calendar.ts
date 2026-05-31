import { normalizeCik } from "../../shared/src/identifiers.ts";
import {
  APPLE_FISCAL_CALENDAR,
  CALENDAR_YEAR_FISCAL,
  MICROSOFT_FISCAL_CALENDAR,
  type FiscalCalendar,
} from "./fiscal-calendar.ts";

export type IssuerFiscalCalendarIdentity = {
  cik?: string;
};

const KNOWN_FISCAL_CALENDAR_BY_CIK: Readonly<Record<string, FiscalCalendar>> = Object.freeze({
  "320193": APPLE_FISCAL_CALENDAR,
  "789019": MICROSOFT_FISCAL_CALENDAR,
});

export function fiscalCalendarForIssuerProfile(record: IssuerFiscalCalendarIdentity): FiscalCalendar {
  const cik = normalizedProfileCik(record.cik);
  if (cik === null) return CALENDAR_YEAR_FISCAL;
  return KNOWN_FISCAL_CALENDAR_BY_CIK[cik] ?? CALENDAR_YEAR_FISCAL;
}

function normalizedProfileCik(cik: string | undefined): string | null {
  const trimmed = cik?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  return normalizeCik(trimmed);
}
