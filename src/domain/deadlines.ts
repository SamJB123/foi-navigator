/**
 * Statutory dates for a Commonwealth FOI request, from the case file's events.
 *
 * Rules (FOI Act; FOI Guidelines Part 3):
 * - Day 1 of the processing period is the day after a valid request is received
 *   ([3.244]–[3.245]); periods are calendar days, public holidays included ([3.247]).
 * - Acknowledge within 14 days (s 15(5)(a)); decide within 30 (s 15(5)(b)).
 * - Extensions: +30 for consultation under ss 26A/27/27A (s 15(6)), +30 for a foreign
 *   entity (s 15(8)), up to 30 in total by written agreement (s 15AA, before expiry,
 *   never after a deemed refusal [3.256]–[3.258]), or as the IC allows (s 15AB).
 * - Disregarded days, counted from the start day to the end day inclusive: the request
 *   consultation period (s 24AB(8)) and the time a charge is unpaid (s 31(2)).
 * - A last day on a Saturday, Sunday or public holiday expires on the next business day
 *   ([3.247]). This engine rolls weekends only: it does not know public holidays, and
 *   says so in its warnings.
 */
import { type CaseEvent, type CaseFile, EVENT_LABELS } from "./case-file.ts";

const DAY = 86_400_000;

export function parseDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
export const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fmt(parseDate(iso) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((parseDate(to) - parseDate(from)) / DAY);
const weekday = (iso: string) => new Date(parseDate(iso)).getUTCDay(); // 0 Sun … 6 Sat
export const isWeekend = (iso: string) => [0, 6].includes(weekday(iso));

export function longDate(iso: string): string {
  return new Date(parseDate(iso)).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The next business day on or after `iso`, ignoring public holidays. */
export function rollWeekend(iso: string): string {
  let d = iso;
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** `n` working days after `iso` (weekends skipped; public holidays not known). */
export function addWorkingDays(iso: string, n: number): string {
  let d = iso;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (!isWeekend(d)) left--;
  }
  return d;
}

/** Today in Canberra, as YYYY-MM-DD. */
export function todayInCanberra(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(now);
}

export type KeyDate = {
  id: string;
  label: string;
  date: string;
  provision: string;
  kind: "event" | "deadline" | "window";
  status?: "met" | "missed" | "upcoming" | "due_today" | "overdue" | "info";
  days_remaining?: number;
};

export type Adjustment = {
  label: string;
  provision: string;
  days: number;
  kind: "extension" | "pause";
  applied: boolean;
  note?: string;
};

export type Timeline = {
  reference?: string;
  received_date: string;
  as_of: string;
  status: "open" | "paused" | "decided" | "deemed_refusal" | "withdrawn";
  status_label: string;
  processing: {
    base_due: string;
    extension_days: number;
    disregarded_days: number;
    statutory_due: string | null;
    effective_due: string | null;
    rolled_from_weekend: boolean;
    days_remaining: number | null;
    paused_since: string | null;
  };
  key_dates: KeyDate[];
  adjustments: Adjustment[];
  warnings: string[];
  next_actions: string[];
};

const byDate = (a: CaseEvent, b: CaseEvent) => a.date.localeCompare(b.date);

function deadlineStatus(due: string, asOf: string, metOn?: string): Pick<KeyDate, "status" | "days_remaining"> {
  if (metOn) return { status: metOn <= due ? "met" : "missed" };
  const left = daysBetween(asOf, due);
  if (left < 0) return { status: "overdue", days_remaining: left };
  if (left === 0) return { status: "due_today", days_remaining: 0 };
  return { status: "upcoming", days_remaining: left };
}

export function computeTimeline(cf: CaseFile, asOf: string = todayInCanberra()): Timeline {
  const received = cf.received_date;
  const events = [...(cf.events ?? [])].sort(byDate);
  const first = (type: CaseEvent["type"]) => events.find((e) => e.type === type);
  const warnings: string[] = [];
  const next: string[] = [];
  const adjustments: Adjustment[] = [];
  const keyDates: KeyDate[] = [];

  keyDates.push({
    id: "received",
    label: "Valid request received (day 0)",
    date: received,
    provision: "s 15(2), [3.243]",
    kind: "event",
    status: "info",
  });
  if (first("transferred_in")) {
    warnings.push(
      "Transferred request: the processing period runs from when the first agency received it (s 16(5)(b)). Make sure received_date is that date, not the transfer date.",
    );
  }

  // Acknowledgement: 14 days, rolled forward if it lands on a weekend (AIA s 36(2)).
  const ackDue = rollWeekend(addDays(received, 14));
  const ack = first("acknowledged");
  keyDates.push({
    id: "acknowledge_by",
    label: "Acknowledge the request by",
    date: ackDue,
    provision: "s 15(5)(a), [3.244]",
    kind: "deadline",
    ...deadlineStatus(ackDue, asOf, ack?.date),
  });
  if (!ack && asOf <= ackDue) next.push(`Send the acknowledgement by ${longDate(ackDue)} (template: acknowledgement).`);
  if (!ack && asOf > ackDue) warnings.push("No acknowledgement is recorded and the 14-day period has passed. Send one now and record it.");

  // Walk events in date order, moving the due date as extensions and pauses apply.
  const baseDue = addDays(received, 30);
  let due = baseDue;
  let extensionDays = 0;
  let disregarded = 0;
  let pausedSince: string | null = null;
  let pauseKind: "s24AB" | "charge" | null = null;
  let withdrawn: string | null = null;
  let s15_6 = false;
  let s15_8 = false;
  let s15AA = 0;
  let s24ABUsed = false;
  let s24ABEnds: string | null = null;
  let decided: string | null = null;
  const expired = (date: string) => !pausedSince && date > rollWeekend(due);

  for (const e of events) {
    switch (e.type) {
      case "extension_s15_6":
      case "extension_s15_8": {
        const isLocal = e.type === "extension_s15_6";
        const label = EVENT_LABELS[e.type];
        if ((isLocal && s15_6) || (!isLocal && s15_8)) {
          adjustments.push({ label, provision: isLocal ? "s 15(6)" : "s 15(8)", days: 0, kind: "extension", applied: false, note: "Already applied once; the extension is 30 days however many third parties are consulted." });
          break;
        }
        const late = expired(e.date);
        adjustments.push({
          label,
          provision: isLocal ? "s 15(6)" : "s 15(8)",
          days: late ? 0 : 30,
          kind: "extension",
          applied: !late,
          note: late ? `Recorded on ${longDate(e.date)}, after the processing period ended — it cannot revive an expired period.` : undefined,
        });
        if (!late) {
          due = addDays(due, 30);
          extensionDays += 30;
          if (isLocal) s15_6 = true;
          else s15_8 = true;
        }
        break;
      }
      case "extension_s15AA": {
        const asked = e.days ?? 0;
        const room = 30 - s15AA;
        const late = expired(e.date);
        const days = late ? 0 : Math.min(asked, room);
        let note: string | undefined;
        if (!asked) note = "No number of days given; record the agreed extension in days.";
        else if (late) note = "Agreed after the processing period ended. A s 15AA agreement cannot be made once a request is a deemed refusal ([3.258]).";
        else if (asked > room) note = `Only ${room} more days are available: s 15AA extensions are capped at 30 days in total ([3.257]).`;
        adjustments.push({ label: EVENT_LABELS[e.type], provision: "s 15AA", days, kind: "extension", applied: days > 0, note });
        if (days > 0) {
          due = addDays(due, days);
          extensionDays += days;
          s15AA += days;
          warnings.push("s 15AA: the extension is valid only with the applicant's written agreement and written notice to the Information Commissioner as soon as practicable ([3.255]–[3.256]).");
        }
        break;
      }
      case "extension_s15AB": {
        const days = e.days ?? 0;
        adjustments.push({
          label: EVENT_LABELS[e.type],
          provision: "s 15AB",
          days,
          kind: "extension",
          applied: days > 0,
          note: days
            ? "Valid if the application to the IC was made before the processing period expired ([3.262]), even if granted later."
            : "Record the number of days the IC allowed.",
        });
        if (days > 0) {
          due = addDays(due, days);
          extensionDays += days;
        }
        break;
      }
      case "s24AB_notice": {
        if (s24ABUsed) {
          warnings.push("Only one request consultation process is required for a request (s 24AB(9)); a second notice does not stop the clock again.");
          break;
        }
        if (expired(e.date)) {
          warnings.push(`The s 24AB notice on ${longDate(e.date)} came after the processing period ended, so its consultation period cannot be disregarded ([3.229]).`);
          break;
        }
        s24ABUsed = true;
        pausedSince = e.date;
        pauseKind = "s24AB";
        const consultEnds = addDays(e.date, 14);
        s24ABEnds = consultEnds;
        keyDates.push({
          id: "s24AB_consultation_ends",
          label: "Request consultation period ends (unless extended in writing, s 24AB(5))",
          date: consultEnds,
          provision: "s 24AB(2)(e)",
          kind: "window",
          status: "info",
        });
        break;
      }
      case "s24AB_period_extended": {
        const k = keyDates.find((x) => x.id === "s24AB_consultation_ends");
        if (pauseKind !== "s24AB" || !s24ABEnds || !k) {
          warnings.push("A s24AB_period_extended is recorded without an open s24AB_notice before it.");
          break;
        }
        if (!e.days) {
          warnings.push("Record the number of days the consultation period was extended by (s 24AB(5)).");
          break;
        }
        s24ABEnds = addDays(s24ABEnds, e.days);
        k.date = s24ABEnds;
        k.label = `Request consultation period ends (extended by agreement, s 24AB(5))`;
        break;
      }
      case "s24AB_outcome": {
        if (pauseKind !== "s24AB" || !pausedSince) {
          warnings.push("A s24AB_outcome is recorded without an open s24AB_notice before it.");
          break;
        }
        if (e.outcome === "withdrawn") {
          withdrawn = e.date;
          pausedSince = null;
          pauseKind = null;
          break;
        }
        const days = daysBetween(pausedSince, e.date) + 1;
        adjustments.push({
          label: `Request consultation period disregarded (${longDate(pausedSince)} – ${longDate(e.date)})`,
          provision: "s 24AB(8)",
          days,
          kind: "pause",
          applied: true,
          note: e.outcome === "revised" ? "Process the revised request." : e.outcome === "declined_to_revise" ? "Decide whether to refuse under s 24." : undefined,
        });
        due = addDays(due, days);
        disregarded += days;
        pausedSince = null;
        pauseKind = null;
        break;
      }
      case "charge_notice": {
        if (cf.own_personal_information) {
          warnings.push("No charge may be imposed for access to the applicant's own personal information (Charges Regs s 7(1)). The charge notice does not stop the clock.");
          break;
        }
        if (expired(e.date)) {
          warnings.push(`The charge notice on ${longDate(e.date)} came after the processing period ended: no charge can be imposed (Charges Regs s 7(2)), and the clock does not stop (s 31(1)(b)).`);
          break;
        }
        if (pausedSince) {
          warnings.push("A charge notice is recorded while the clock is already stopped; the overlap is not double-counted.");
          break;
        }
        pausedSince = e.date;
        pauseKind = "charge";
        const respondBy = addDays(e.date, 30);
        keyDates.push({
          id: "charge_response_due",
          label: "Applicant must respond to the charge notice (or the request is taken to be withdrawn, s 29(2))",
          date: respondBy,
          provision: "s 29(1)(f)",
          kind: "window",
          status: "info",
        });
        break;
      }
      case "charge_contention_received": {
        const decideBy = addDays(e.date, 30);
        const resolved = events.find((x) => x.type === "charge_resolved" && x.date >= e.date);
        keyDates.push({
          id: "charge_contention_decision_due",
          label: "Decide the charges contention and notify the applicant (else the preliminary assessment is taken to be confirmed, s 29(7))",
          date: decideBy,
          provision: "s 29(6), [4.57]",
          kind: "deadline",
          ...deadlineStatus(decideBy, asOf, resolved?.date),
        });
        // The applicant has responded within s 29(1)(f), so the withdrawal window is moot.
        const window = keyDates.findIndex((k) => k.id === "charge_response_due");
        if (window >= 0) keyDates.splice(window, 1);
        break;
      }
      case "charge_resolved": {
        if (pauseKind !== "charge" || !pausedSince) {
          warnings.push("A charge_resolved is recorded without an open charge_notice before it.");
          break;
        }
        const days = daysBetween(pausedSince, e.date) + 1;
        adjustments.push({
          label: `Days a charge was unpaid, disregarded (${longDate(pausedSince)} – ${longDate(e.date)})`,
          provision: "s 31(2)",
          days,
          kind: "pause",
          applied: true,
        });
        due = addDays(due, days);
        disregarded += days;
        pausedSince = null;
        pauseKind = null;
        // The applicant has responded, so the s 29(2) response window no longer matters.
        const window = keyDates.findIndex((k) => k.id === "charge_response_due");
        if (window >= 0) keyDates.splice(window, 1);
        break;
      }
      case "decision_notified":
        decided ??= e.date;
        break;
      case "withdrawn":
        withdrawn ??= e.date;
        break;
      default:
        break;
    }
  }

  // An open request consultation lapses into withdrawal if the applicant does nothing (s 24AB(7)).
  if (pauseKind === "s24AB" && s24ABEnds && asOf > s24ABEnds) {
    warnings.push(
      `The request consultation period ended on ${longDate(s24ABEnds)}. If the applicant did not consult the contact person or respond in writing, the request is taken to be withdrawn (s 24AB(7)) — record an s24AB_outcome of "withdrawn". But if the applicant tried to consult and the agency did not respond, it is not withdrawn ([3.233]). If the period was extended in writing, record s24AB_period_extended.`,
    );
  }
  if (pauseKind === "charge" && pausedSince && !events.some((x) => x.type === "charge_contention_received") && asOf > addDays(pausedSince, 30)) {
    warnings.push(
      `More than 30 days have passed since the charge notice (${longDate(pausedSince)}). If the applicant has not paid, contended or withdrawn, the request is taken to be withdrawn (s 29(2)).`,
    );
  }

  const statutoryDue = pausedSince ? null : due;
  const effectiveDue = statutoryDue ? rollWeekend(statutoryDue) : null;
  const rolled = !!statutoryDue && effectiveDue !== statutoryDue;

  if (effectiveDue) {
    keyDates.push({
      id: "decision_due",
      label: rolled ? `Notify the decision by (rolled forward from ${longDate(statutoryDue!)}, a weekend)` : "Notify the decision by",
      date: effectiveDue,
      provision: "s 15(5)(b), [3.247]",
      kind: "deadline",
      ...deadlineStatus(effectiveDue, asOf, decided ?? undefined),
    });
  }

  let status: Timeline["status"] = "open";
  if (withdrawn) status = "withdrawn";
  else if (decided) status = "decided";
  else if (pausedSince) status = "paused";
  else if (effectiveDue && asOf > effectiveDue) status = "deemed_refusal";

  if (status === "deemed_refusal" && effectiveDue) {
    // s 15AC(3): refusal is taken to be decided, and notified, on the last day of the period.
    keyDates.push({
      id: "deemed_refusal",
      label: "Deemed refusal: decision taken to be made and notified on this day (s 15AC(3))",
      date: effectiveDue,
      provision: "s 15AC(3), [3.265]",
      kind: "event",
      status: "info",
    });
    warnings.push(
      "The processing period has expired: the request is a deemed refusal (s 15AC). The agency should still make a decision ([3.229], [3.265]–[3.271]); no charge can now be imposed (Charges Regs s 7(2)); s 15AA extensions are no longer available ([3.258]). The IC may allow further time under s 15AC(4)–(5); a decision within that time means the deemed refusal never applied (s 15AC(7)).",
    );
    next.push("Decide as soon as possible and consider applying in writing to the Information Commissioner for further time under s 15AC(4).");
    next.push(`The applicant may seek IC review of the deemed refusal within 60 days (by ${longDate(addDays(effectiveDue, 60))}, s 54S(1)). Internal review is not available for a deemed decision.`);
  }

  if (decided) {
    const irBy = addDays(decided, 30);
    const icBy = addDays(decided, 60);
    keyDates.push(
      { id: "internal_review_window", label: "Applicant may apply for internal review until", date: irBy, provision: "s 54B(1)", kind: "window", status: "info" },
      { id: "ic_review_window", label: "Applicant may apply for IC review until", date: icBy, provision: "s 54S(1)", kind: "window", status: "info" },
    );
    const tpNotice = first("third_party_decision_notice");
    if (tpNotice) {
      const releaseFrom = addDays(tpNotice.date, 31);
      keyDates.push({
        id: "third_party_release_from",
        label:
          "Earliest release to the applicant if the objecting third party has not sought review (their 30 days for internal and IC review have run out, s 4(1) 'run out'). Check with them first — about 3 working days' notice ([3.316])",
        date: releaseFrom,
        provision: "ss 27(7), 27A(6), 26A(4); [3.315]",
        kind: "window",
        status: asOf >= releaseFrom ? "met" : "info",
      });
    } else if (cf.third_parties?.length) {
      keyDates.push({
        id: "third_party_review_window",
        label: "A third party who objected may seek internal or IC review until (do not release before this, ss 27(7), 27A(6))",
        date: addDays(decided, 30),
        provision: "ss 54A, 54S(2), [3.311]–[3.316]",
        kind: "window",
        status: "info",
      });
    }
  }

  const access = first("access_given");
  if (access) {
    const logBy = addWorkingDays(access.date, 10);
    keyDates.push({
      id: "disclosure_log_by",
      label: "Publish on the disclosure log by (10 working days, weekends skipped)",
      date: logBy,
      provision: "s 11C(6)",
      kind: "deadline",
      ...deadlineStatus(logBy, asOf),
    });
  } else if (decided) {
    next.push("When access is given, record access_given: the disclosure log entry is due 10 working days later (s 11C(6)), unless an exception in s 11C(1) applies.");
  }

  const irIn = first("internal_review_received");
  if (irIn) {
    const irDue = rollWeekend(addDays(irIn.date, 30));
    const irDone = first("internal_review_decided");
    keyDates.push({
      id: "internal_review_due",
      label: "Decide the internal review by (otherwise taken to affirm the original decision)",
      date: irDue,
      provision: "ss 54C(3), 54D(2)",
      kind: "deadline",
      ...deadlineStatus(irDue, asOf, irDone?.date),
    });
  }

  if (status === "open" && effectiveDue) {
    const left = daysBetween(asOf, effectiveDue);
    if (left <= 10 && left >= 0) {
      next.push(
        `${left === 0 ? "The decision is due today" : `${left} days remain`}. If more time is genuinely needed: s 15(6) if consulting a third party under ss 26A/27/27A; ask the applicant to agree under s 15AA (before ${longDate(effectiveDue)}); or apply to the IC under s 15AB before the period expires.`,
      );
    }
  }
  if (status === "paused") {
    next.push(
      pauseKind === "s24AB"
        ? "The clock is stopped for request consultation. Record s24AB_outcome when the applicant revises, declines to revise or withdraws."
        : "The clock is stopped while a charge is unpaid. Record charge_resolved when the charge or deposit is paid, or when a decision not to impose it is notified.",
    );
  }

  warnings.push(
    "Public holidays are not checked. If a deadline falls on a public holiday where your agency is, it moves to the next business day ([3.247]). Cross-check with the OAIC processing period calculator.",
  );

  const labels: Record<Timeline["status"], string> = {
    open: "In progress",
    paused: pauseKind === "s24AB" ? "Clock stopped: request consultation (s 24AB)" : "Clock stopped: charge unpaid (s 31)",
    decided: "Decision notified",
    deemed_refusal: "Deemed refusal — processing period expired",
    withdrawn: "Withdrawn",
  };

  keyDates.sort((a, b) => a.date.localeCompare(b.date));
  return {
    reference: cf.reference,
    received_date: received,
    as_of: asOf,
    status,
    status_label: labels[status],
    processing: {
      base_due: baseDue,
      extension_days: extensionDays,
      disregarded_days: disregarded,
      statutory_due: statutoryDue,
      effective_due: effectiveDue,
      rolled_from_weekend: rolled,
      days_remaining: effectiveDue && status === "open" ? daysBetween(asOf, effectiveDue) : null,
      paused_since: pausedSince,
    },
    key_dates: keyDates,
    adjustments,
    warnings,
    next_actions: next,
  };
}
