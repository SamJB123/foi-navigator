/**
 * The public interest test for conditionally exempt documents (ss 11A(5), 11B), as a
 * worksheet: the statutory and Guidelines factors, a check of the user's own factors
 * against the four irrelevant factors in s 11B(4), and the weighing steps.
 *
 * The check is a tripwire, not a judgment: it flags wording that commonly signals an
 * irrelevant factor so the decision-maker can look again.
 */

export const STATUTORY_FOR = [
  { id: "s11B(3)(a)", text: "promote the objects of the FOI Act (including all the matters in ss 3 and 3A)" },
  { id: "s11B(3)(b)", text: "inform debate on a matter of public importance" },
  { id: "s11B(3)(c)", text: "promote effective oversight of public expenditure" },
  { id: "s11B(3)(d)", text: "allow a person to access their own personal information" },
];

/** Short labels for the Guidelines' non-exhaustive lists; full text is in [6.231] and [6.233]. */
export const GUIDELINES_FOR = [
  "reveal the reasons for a government decision and its background or context",
  "enhance scrutiny of government decision making",
  "allow inquiry into possible deficiencies in the conduct or administration of an agency or official",
  "reveal or substantiate misconduct or negligent, improper or unlawful conduct",
  "contribute to the administration of justice, including procedural fairness",
  "advance the fair treatment of individuals in their dealings with agencies",
  "reveal environmental or health risks, or contribute to protecting the environment",
  "contribute to innovation and the facilitation of research",
];

export const GUIDELINES_AGAINST = [
  "prejudice an individual's right to privacy",
  "prejudice the fair treatment of individuals where information is about unsubstantiated allegations",
  "prejudice security, law enforcement, public health or public safety",
  "impede the administration of justice, generally or for an individual",
  "impede the flow of information to police or a law enforcement or regulatory agency",
  "prejudice an agency's ability to obtain confidential information, or similar information in future",
  "prejudice the competitive commercial activities of an agency",
  "harm the interests of an individual or group",
  "prejudice investigations, audits or reviews by the Ombudsman or Auditor-General",
  "prejudice an agency's management function, or the effectiveness of testing or auditing procedures",
];

export const IRRELEVANT = [
  {
    id: "s11B(4)(a)",
    text: "access could result in embarrassment to the Commonwealth Government, or cause a loss of confidence in it",
    pattern: /embarrass|loss of (public )?confidence|reputation(al)?|adverse (media|publicity)|media (attention|interest|scrutiny|coverage)|negative (press|publicity|coverage)|public criticism|criticis(e|m)|bad look|political(ly)? (sensitive|damag)/i,
  },
  {
    id: "s11B(4)(b)",
    text: "access could result in any person misinterpreting or misunderstanding the document",
    pattern: /misinterpret|misunderst|misconstru|out of context|misleading impression|misread|wrong impression|lack(s)? context/i,
  },
  {
    id: "s11B(4)(c)",
    text: "the author of the document was (or is) of high seniority in the agency",
    pattern: /high seniority|seniority of|senior (officer|official|executive|author)|written by (the )?(secretary|deputy secretary|ses)|\bSES (author|officer)/i,
  },
  {
    id: "s11B(4)(d)",
    text: "access could result in confusion or unnecessary debate",
    pattern: /confusion|confus(e|ing) the public|unnecessary (public )?debate|public debate|controvers|speculation|alarm/i,
  },
] as const;

const FRANKNESS = /frank(ness)?|candou?r|chilling|deter (officers|staff|advisers)|future advice|inhibit/i;

export type FactorCheck = { factor: string; side: "for" | "against"; flags: { id: string; text: string }[]; frankness: boolean };

export function checkFactors(factorsFor: string[], factorsAgainst: string[]): FactorCheck[] {
  const check = (factor: string, side: "for" | "against"): FactorCheck => ({
    factor,
    side,
    flags: side === "against" ? IRRELEVANT.filter((i) => i.pattern.test(factor)).map(({ id, text }) => ({ id, text })) : [],
    frankness: side === "against" && FRANKNESS.test(factor),
  });
  return [...factorsFor.map((f) => check(f, "for")), ...factorsAgainst.map((f) => check(f, "against"))];
}

export const WEIGHING_STEPS = [
  "Confirm the document is conditionally exempt first — the statutory criteria of the conditional exemption must be established before the public interest test ([6.7]–[6.11]).",
  "Identify the factors favouring access, starting with the four in s 11B(3); it is rare that disclosure would not promote the objects of the Act ([6.229]–[6.230]).",
  "Identify any factors against access from the facts of this document — the Act lists none; the Guidelines' list is a guide, not a checklist ([6.232]–[6.233]).",
  "Remove any irrelevant factor in s 11B(4) ([6.234]–[6.235]).",
  "Weigh: explain the relevance and weight of each factor, at the time of the decision, and say where the balance lies. Listing is not weighing ([6.236]–[6.238]).",
  "The question is whether access would, on balance, be contrary to the public interest — not whether it is positively in the public interest ([6.239]).",
  "Record the factors and their weight in the statement of reasons (s 26(1)(aa), [3.295]).",
];
