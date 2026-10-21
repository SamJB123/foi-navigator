/**
 * Charges under the Freedom of Information (Charges) Regulations 2019, as a
 * preliminary assessment for a s 29(1) notice.
 *
 * Rates (Sch 1): search and retrieval $15/hour (Pt 1 item 1); decision-making
 * $20/hour after the first 5 hours (Pt 1 item 4); transcripts $4.40/page (Pt 1 item 3,
 * Pt 2 item 8); copies $4.40/page, photocopies $0.10/page (Pt 2 item 3); supervised
 * inspection $6.25 per 30 minutes or part (Pt 2 items 1–2); computer production,
 * electronic copies, postage and other arrangements at actual cost.
 * Part hours are pro-rated ([4.26]). Deposits: up to $20 where the charge is over $25
 * and up to $100; up to 25% above $100 (reg 12(2)). No GST ([4.50]).
 *
 * Guards: no charge where the documents contain the applicant's personal information
 * (reg 7(1)), or where the decision is or will be late (reg 7(2)–(3)).
 */

export type ChargesInput = {
  search_hours?: number;
  decision_hours?: number;
  transcript_pages?: number;
  copy_pages?: number;
  photocopy_pages?: number;
  supervision_minutes?: number;
  actual_costs?: number;
  actual_costs_description?: string;
  documents_contain_applicants_personal_information?: boolean;
  decision_late?: boolean;
};

export type ChargeLine = { item: string; provision: string; quantity: string; rate: string; amount: number };

export type ChargesResult = {
  chargeable: boolean;
  lines: ChargeLine[];
  total: number;
  free_decision_hours: number;
  deposit_maximum: number;
  deposit_rule: string;
  barred_by?: string;
  notes: string[];
  waiver_considerations: string[];
};

const money = (n: number) => Math.round(n * 100) / 100;
export const aud = (n: number) => `$${n.toFixed(2)}`;

export function estimateCharges(input: ChargesInput): ChargesResult {
  const notes: string[] = [];
  const lines: ChargeLine[] = [];
  const search = Math.max(0, input.search_hours ?? 0);
  const decision = Math.max(0, input.decision_hours ?? 0);

  if (search) lines.push({ item: "Search and retrieval", provision: "Sch 1 Pt 1 item 1", quantity: `${search} h`, rate: "$15.00/h", amount: money(search * 15) });
  const free = Math.min(5, decision);
  const billableDecision = Math.max(0, decision - 5);
  if (decision)
    lines.push({
      item: `Decision-making (first 5 hours free; ${billableDecision} h charged)`,
      provision: "Sch 1 Pt 1 item 4",
      quantity: `${decision} h`,
      rate: "$20.00/h after 5 h",
      amount: money(billableDecision * 20),
    });
  if (input.transcript_pages)
    lines.push({ item: "Transcript", provision: "Sch 1 Pt 1 item 3 / Pt 2 item 8", quantity: `${input.transcript_pages} pages`, rate: "$4.40/page", amount: money(input.transcript_pages * 4.4) });
  if (input.copy_pages)
    lines.push({ item: "Copies (other than photocopies)", provision: "Sch 1 Pt 2 item 3(a)", quantity: `${input.copy_pages} pages`, rate: "$4.40/page", amount: money(input.copy_pages * 4.4) });
  if (input.photocopy_pages)
    lines.push({ item: "Photocopies", provision: "Sch 1 Pt 2 item 3(b)", quantity: `${input.photocopy_pages} pages`, rate: "$0.10/page", amount: money(input.photocopy_pages * 0.1) });
  if (input.supervision_minutes) {
    const blocks = Math.ceil(input.supervision_minutes / 30);
    lines.push({ item: "Supervised inspection", provision: "Sch 1 Pt 2 items 1–2", quantity: `${input.supervision_minutes} min (${blocks} × 30 min)`, rate: "$6.25 per 30 min or part", amount: money(blocks * 6.25) });
  }
  if (input.actual_costs)
    lines.push({
      item: `Actual costs${input.actual_costs_description ? `: ${input.actual_costs_description}` : ""}`,
      provision: "Sch 1 Pt 1 item 2; Pt 2 items 4–7, 9",
      quantity: "—",
      rate: "actual cost, not exceeding",
      amount: money(input.actual_costs),
    });

  const total = money(lines.reduce((s, l) => s + l.amount, 0));
  let barred: string | undefined;
  if (input.documents_contain_applicants_personal_information)
    barred =
      "No charge: the documents contain the applicant's personal information (Charges Regs s 7(1), [4.42]–[4.45]). Where the personal information is a small part of large documents, consider consulting the applicant about narrowing scope before charging for the rest ([4.45]).";
  else if (input.decision_late)
    barred = "No charge: the decision is not notified within the processing period as extended (Charges Regs s 7(2)–(3), [4.46]–[4.48]); refund any deposit (Charges Regs s 12(3)(b)).";

  const deposit = barred ? 0 : total > 100 ? money(total * 0.25) : total > 25 ? 20 : 0;
  const depositRule =
    total > 100 ? "up to 25% of the charge (reg 12(2)(b))" : total > 25 ? "up to $20 (reg 12(2)(a))" : "no deposit: the charge does not exceed $25 (reg 12(1)(b))";

  notes.push(
    "Charge search time only on the basis that documents are where the filing system says (or ought to say) they are — time lost to poor record-keeping is not chargeable (reg 5(2), [4.28]–[4.29]).",
    "Decision-making time is the decision-maker's time (including preparing a schedule); not other officers discussing search results ([4.30]–[4.33]).",
    "Part hours are pro-rated ([4.26]). No GST is payable on FOI charges ([4.50]).",
    "Charges are discretionary: consider the 'lowest reasonable cost' object (s 3(4)) and whether collecting the charge would cost more than it raises ([4.3]–[4.6], [4.114]).",
    "An estimate must be fair and accurate, and not set so high it deters the applicant ([4.68]); base it on experience or a sample of the documents ([4.70]).",
    "The applicant must pay before access is given (reg 11), and may contest the charge even after paying ([4.57], [4.63]).",
  );
  if (total > 0 && total < 50 && !barred)
    notes.push(`At ${aud(total)}, consider whether the cost of notifying and collecting the charge exceeds it — a common reason not to charge ([4.4]).`);

  return {
    chargeable: !barred && total > 0,
    lines,
    total: barred ? 0 : total,
    free_decision_hours: free,
    deposit_maximum: deposit,
    deposit_rule: barred ? "no deposit" : depositRule,
    barred_by: barred,
    notes,
    waiver_considerations: [
      "Financial hardship to the applicant or the person on whose behalf they applied — must be considered (s 29(5)(a)); ordinarily needs some evidence, without intrusive inquiry ([4.101]–[4.104]).",
      "Whether giving access is in the general public interest or the interest of a substantial section of the public — must be considered (s 29(5)(b)); a different test from s 11A(5) ([4.105]–[4.113]).",
      "Any other relevant matter: e.g. collection costs exceed the charge, documents needed for a hearing, research with no commercial benefit, the applicant narrowed the request ([4.114]–[4.115]).",
      "Matters that may support charging: commercial benefit to the applicant; documents of interest only to the applicant; material already published; very large volume ([4.99]).",
      "Not relevant: that the applicant would not meet the full cost, or that the documents might be misinterpreted in public debate ([4.113]). Do not adopt a fixed rule that fetters the discretion ([4.96]).",
    ],
  };
}
