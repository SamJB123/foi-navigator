import { describe, expect, it } from "vitest";
import type { CaseFile } from "../src/domain/case-file.ts";
import { addWorkingDays, computeTimeline, rollWeekend } from "../src/domain/deadlines.ts";

const cf = (over: Partial<CaseFile> = {}): CaseFile => ({ received_date: "2026-11-02", events: [], ...over }); // a Monday
const date = (tl: ReturnType<typeof computeTimeline>, id: string) => tl.key_dates.find((k) => k.id === id)?.date;

describe("processing period", () => {
  it("counts 30 calendar days from the day after receipt", () => {
    const tl = computeTimeline(cf(), "2026-11-03");
    expect(tl.processing.base_due).toBe("2026-12-02");
    expect(tl.processing.effective_due).toBe("2026-12-02");
    expect(date(tl, "acknowledge_by")).toBe("2026-11-16");
    expect(tl.status).toBe("open");
    expect(tl.processing.days_remaining).toBe(29);
  });

  it("moves a weekend due date to the next business day ([3.247])", () => {
    // Received Thu 5 Nov 2026 → day 30 is Sat 5 Dec → Mon 7 Dec.
    const tl = computeTimeline(cf({ received_date: "2026-11-05" }), "2026-11-06");
    expect(tl.processing.statutory_due).toBe("2026-12-05");
    expect(tl.processing.effective_due).toBe("2026-12-07");
    expect(tl.processing.rolled_from_weekend).toBe(true);
  });

  it("adds 30 days once for third-party consultation (s 15(6))", () => {
    const tl = computeTimeline(
      cf({ events: [{ type: "extension_s15_6", date: "2026-11-10" }, { type: "extension_s15_6", date: "2026-11-12" }] }),
      "2026-11-12",
    );
    expect(tl.processing.extension_days).toBe(30);
    expect(tl.processing.statutory_due).toBe("2027-01-01");
    expect(tl.processing.effective_due).toBe("2027-01-01"); // a Friday: holidays are not checked, only weekends
    expect(tl.adjustments.filter((a) => a.applied)).toHaveLength(1);
  });

  it("caps s 15AA extensions at 30 days in total ([3.257])", () => {
    const tl = computeTimeline(
      cf({
        events: [
          { type: "extension_s15AA", date: "2026-11-20", days: 20 },
          { type: "extension_s15AA", date: "2026-11-25", days: 20 },
        ],
      }),
      "2026-11-25",
    );
    expect(tl.processing.extension_days).toBe(30);
    expect(tl.adjustments[1].note).toMatch(/Only 10 more days/);
  });

  it("refuses an s 15AA extension agreed after the period expired ([3.258])", () => {
    const tl = computeTimeline(cf({ events: [{ type: "extension_s15AA", date: "2026-12-10", days: 14 }] }), "2026-12-10");
    expect(tl.processing.extension_days).toBe(0);
    expect(tl.status).toBe("deemed_refusal");
    expect(tl.adjustments[0].applied).toBe(false);
  });

  it("disregards the request consultation period inclusively (s 24AB(8))", () => {
    const tl = computeTimeline(
      cf({
        events: [
          { type: "s24AB_notice", date: "2026-11-09" },
          { type: "s24AB_outcome", date: "2026-11-18", outcome: "revised" },
        ],
      }),
      "2026-11-20",
    );
    expect(tl.processing.disregarded_days).toBe(10); // 9th to 18th inclusive
    expect(tl.processing.statutory_due).toBe("2026-12-12");
    expect(tl.processing.effective_due).toBe("2026-12-14"); // Sat → Mon
  });

  it("is paused while a request consultation is open", () => {
    const tl = computeTimeline(cf({ events: [{ type: "s24AB_notice", date: "2026-11-09" }] }), "2026-11-12");
    expect(tl.status).toBe("paused");
    expect(tl.processing.effective_due).toBeNull();
    expect(date(tl, "s24AB_consultation_ends")).toBe("2026-11-23");
  });

  it("treats a lapsed consultation as withdrawn when recorded", () => {
    const tl = computeTimeline(
      cf({ events: [{ type: "s24AB_notice", date: "2026-11-09" }, { type: "s24AB_outcome", date: "2026-11-23", outcome: "withdrawn" }] }),
      "2026-11-24",
    );
    expect(tl.status).toBe("withdrawn");
  });

  it("disregards days a charge is unpaid (s 31(2))", () => {
    const tl = computeTimeline(
      cf({ events: [{ type: "charge_notice", date: "2026-11-16" }, { type: "charge_resolved", date: "2026-11-20", outcome: "paid" }] }),
      "2026-11-21",
    );
    expect(tl.processing.disregarded_days).toBe(5);
    expect(tl.processing.effective_due).toBe("2026-12-07");
  });

  it("does not stop the clock for a charge on the applicant's own personal information", () => {
    const tl = computeTimeline(cf({ own_personal_information: true, events: [{ type: "charge_notice", date: "2026-11-16" }] }), "2026-11-17");
    expect(tl.status).toBe("open");
    expect(tl.warnings.join(" ")).toMatch(/Charges Regs s 7\(1\)/);
  });

  it("does not stop the clock for a charge notified after the period expired", () => {
    const tl = computeTimeline(cf({ events: [{ type: "charge_notice", date: "2026-12-05" }] }), "2026-12-06");
    expect(tl.status).toBe("deemed_refusal");
    expect(tl.warnings.join(" ")).toMatch(/s 7\(2\)/);
  });

  it("records a deemed refusal on the last day of the period (s 15AC(3))", () => {
    const tl = computeTimeline(cf(), "2026-12-03");
    expect(tl.status).toBe("deemed_refusal");
    expect(date(tl, "deemed_refusal")).toBe("2026-12-02");
  });

  it("sets review windows and the disclosure log date after decision and access", () => {
    const tl = computeTimeline(
      cf({
        third_parties: ["business"],
        events: [
          { type: "decision_notified", date: "2026-11-30" },
          { type: "access_given", date: "2026-12-18" }, // Fri
        ],
      }),
      "2026-12-18",
    );
    expect(tl.status).toBe("decided");
    expect(date(tl, "internal_review_window")).toBe("2026-12-30");
    expect(date(tl, "ic_review_window")).toBe("2027-01-29");
    expect(date(tl, "third_party_review_window")).toBe("2026-12-30");
    expect(date(tl, "disclosure_log_by")).toBe("2027-01-01"); // 10 working days, weekends skipped
    expect(tl.key_dates.find((k) => k.id === "decision_due")?.status).toBe("met");
  });

  it("dates an internal review decision 30 days from the application", () => {
    const tl = computeTimeline(
      cf({ events: [{ type: "decision_notified", date: "2026-11-30" }, { type: "internal_review_received", date: "2026-12-10" }] }),
      "2026-12-11",
    );
    expect(date(tl, "internal_review_due")).toBe("2027-01-11"); // 9 Jan is Sat → Mon 11 Jan
  });
});

describe("stage 2 and 3 events", () => {
  it("extends the request consultation period by agreement (s 24AB(5))", () => {
    const tl = computeTimeline(
      cf({ events: [{ type: "s24AB_notice", date: "2026-11-09" }, { type: "s24AB_period_extended", date: "2026-11-20", days: 7 }] }),
      "2026-11-26",
    );
    expect(date(tl, "s24AB_consultation_ends")).toBe("2026-11-30");
    expect(tl.warnings.join(" ")).not.toMatch(/consultation period ended/);
  });

  it("dates a charges contention decision 30 days out (s 29(6)) and drops the withdrawal window", () => {
    const tl = computeTimeline(
      cf({ events: [{ type: "charge_notice", date: "2026-11-10" }, { type: "charge_contention_received", date: "2026-11-20" }] }),
      "2026-11-21",
    );
    expect(date(tl, "charge_contention_decision_due")).toBe("2026-12-20");
    expect(date(tl, "charge_response_due")).toBeUndefined();
    expect(tl.status).toBe("paused");
  });

  it("gives the earliest release date after notifying an objecting third party", () => {
    const tl = computeTimeline(
      cf({
        third_parties: ["business"],
        events: [
          { type: "decision_notified", date: "2026-11-30" },
          { type: "third_party_decision_notice", date: "2026-11-30" },
        ],
      }),
      "2026-12-01",
    );
    expect(date(tl, "third_party_release_from")).toBe("2026-12-31");
    expect(date(tl, "third_party_review_window")).toBeUndefined();
  });
});

describe("date helpers", () => {
  it("rolls weekends and counts working days", () => {
    expect(rollWeekend("2026-11-07")).toBe("2026-11-09");
    expect(rollWeekend("2026-11-09")).toBe("2026-11-09");
    expect(addWorkingDays("2026-11-06", 1)).toBe("2026-11-09");
    expect(addWorkingDays("2026-11-02", 10)).toBe("2026-11-16");
  });
});
