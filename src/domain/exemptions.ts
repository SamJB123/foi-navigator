/**
 * The exemptions in Part IV of the FOI Act, as a decision-maker's checklist: the
 * elements to make findings on, carve-outs, consultation duties, where the
 * Guidelines discuss each, common errors, and plain-English questions for the line
 * area that holds the evidence.
 *
 * Guidelines ranges are the paragraphs under each exemption's heading in Parts 5 and
 * 6; test/content.test.ts checks that every cited passage exists.
 */
import { FRANKNESS_GUIDANCE } from "./public-interest.ts";

export type Exemption = {
  provision: string; // "47F"
  name: string;
  kind: "exempt" | "conditional";
  summary: string;
  elements: string[];
  carve_outs?: string[];
  harm_test?: string;
  ncnd?: boolean;
  consultation?: string;
  guidelines: { from: string; to: string; part: 5 | 6 };
  key_paragraphs: string[];
  pitfalls: string[];
  line_area_questions: string[];
  information_types: string[];
};

export const EXEMPTIONS: Exemption[] = [
  {
    provision: "33",
    name: "National security, defence or international relations",
    kind: "exempt",
    summary: "Disclosure would, or could reasonably be expected to, damage security, defence or international relations; or would divulge information communicated in confidence by a foreign government or international organisation.",
    elements: [
      "s 33(a): disclosure would, or could reasonably be expected to, cause damage to (i) the security of the Commonwealth, (ii) the defence of the Commonwealth, or (iii) the international relations of the Commonwealth; or",
      "s 33(b): disclosure would divulge information or matter communicated in confidence by or on behalf of a foreign government, an authority of a foreign government or an international organisation to the Government of the Commonwealth, an authority of the Commonwealth or a person receiving the communication on behalf of the Commonwealth.",
    ],
    harm_test: "Damage must be reasonably expected, not merely possible; a security classification is not conclusive ([5.23]–[5.24]).",
    ncnd: true,
    consultation: "Foreign governments or entities may be consulted; for s 33(a)(iii) or (b), a written determination under s 15(7)–(8) extends the period by 30 days.",
    guidelines: { from: "gl:5.21", to: "gl:5.62", part: 5 },
    key_paragraphs: ["gl:5.24", "gl:5.38", "gl:5.45", "gl:5.51", "gl:5.55"],
    pitfalls: ["Relying on the classification marking alone.", "Assuming any mention of a foreign government is 'international relations' damage."],
    line_area_questions: [
      "What specific damage to security, defence or a foreign relationship would release cause, and how likely is it?",
      "Was the information given to us by a foreign government or international organisation, and was it given in confidence? Is there a written understanding?",
      "Is any of this already public, or officially acknowledged?",
    ],
    information_types: ["security", "defence", "foreign government", "international relations", "intelligence"],
  },
  {
    provision: "34",
    name: "Cabinet documents",
    kind: "exempt",
    summary: "Documents created for the dominant purpose of submission to Cabinet, official Cabinet records, Cabinet briefings, drafts and copies, and documents revealing a Cabinet deliberation or decision.",
    elements: [
      "s 34(1)(a): the document has been, or is proposed by a minister to be, submitted for Cabinet's consideration, and was brought into existence for the dominant purpose of submission; or",
      "s 34(1)(b): it is an official record of the Cabinet; or",
      "s 34(1)(c): it was brought into existence for the dominant purpose of briefing a minister on a document in (a); or",
      "s 34(1)(d): it is a draft of a document in (a), (b) or (c); or",
      "s 34(2): it is a copy of, or part of, or contains an extract from, such a document; or",
      "s 34(3): disclosure would reveal a Cabinet deliberation or decision whose existence has not been officially disclosed.",
    ],
    carve_outs: [
      "Purely factual material is not exempt unless its disclosure would reveal a Cabinet deliberation or decision whose existence has not been officially disclosed (s 34(6)).",
      "A document is not exempt only because it is attached to a Cabinet document (s 34(4)); a document officially publishing a Cabinet decision is not exempt (s 34(5)).",
    ],
    guidelines: { from: "gl:5.63", to: "gl:5.94", part: 5 },
    key_paragraphs: ["gl:5.72", "gl:5.83", "gl:5.88", "gl:5.92"],
    pitfalls: ["Treating a document as exempt under s 34(1)(a) because it was later used in a submission ([5.72]–[5.77]).", "Withholding purely factual material."],
    line_area_questions: [
      "Was this document created for the dominant purpose of going to Cabinet, or for another purpose and later used?",
      "Has the Cabinet decision or deliberation been officially announced?",
      "Which parts are purely factual?",
    ],
    information_types: ["cabinet", "cabinet submission", "cabinet minute", "cabinet briefing"],
  },
  {
    provision: "37",
    name: "Law enforcement and public safety",
    kind: "exempt",
    summary: "Disclosure would, or could reasonably be expected to, prejudice an investigation, reveal a confidential source, endanger life or safety, prejudice a fair trial, prejudice lawful methods for dealing with breaches of the law, or prejudice systems for public safety.",
    elements: [
      "s 37(1)(a): prejudice the conduct of an investigation of a breach, or possible breach, of the law, or a failure to comply with a law relating to taxation, or the enforcement or proper administration of the law in a particular instance; or",
      "s 37(1)(b): disclose, or enable a person to ascertain, the existence or identity of a confidential source of information in relation to the enforcement or administration of the law; or",
      "s 37(1)(c): endanger the life or physical safety of any person; or",
      "s 37(2)(a): prejudice the fair trial of a person or the impartial adjudication of a particular case; or",
      "s 37(2)(b): disclose lawful methods or procedures for preventing, detecting, investigating or dealing with breaches of the law, where disclosure would, or would be reasonably likely to, prejudice their effectiveness; or",
      "s 37(2)(c): prejudice the maintenance or enforcement of lawful methods for the protection of public safety.",
    ],
    harm_test: "'Would or could reasonably be expected to': more than a mere risk or possibility, on evidence ([5.101]); for s 37(1)(c) the risk need not be substantial ([5.121]).",
    ncnd: true,
    guidelines: { from: "gl:5.95", to: "gl:5.133", part: 5 },
    key_paragraphs: ["gl:5.101", "gl:5.102", "gl:5.104", "gl:5.107", "gl:5.121", "gl:5.124"],
    pitfalls: ["Claiming prejudice to an investigation that has concluded, without evidence it may revive ([5.104]).", "Treating routine compliance methods that are publicly known as protected methods."],
    line_area_questions: [
      "Is there a current or reasonably anticipated investigation? What stage is it at?",
      "How exactly would release prejudice it — tipping off, evidence destruction, witness interference?",
      "Would release identify someone who gave information in confidence, or put anyone's safety at risk?",
      "Are the methods described already public?",
    ],
    information_types: ["investigation", "enforcement", "compliance", "informant", "confidential source", "safety", "prosecution"],
  },
  {
    provision: "38",
    name: "Secrecy provisions",
    kind: "exempt",
    summary: "Disclosure is prohibited by a secrecy provision listed in Schedule 3, or one that expressly applies s 38.",
    elements: [
      "s 38(1)(b)(i): disclosure is prohibited under a provision of an enactment listed in Schedule 3; or",
      "s 38(1)(b)(ii): the provision expressly applies s 38 to the document or information; and",
      "the information falls within the precise terms of the secrecy provision.",
    ],
    carve_outs: [
      "Access is not affected if the secrecy provision does not prohibit disclosure to this particular person (s 38(1A)).",
      "Does not apply to the applicant's own personal information (s 38(2)), except under the Migration Act and embryo research provisions in s 38(3)–(3A).",
    ],
    guidelines: { from: "gl:5.134", to: "gl:5.143", part: 5 },
    key_paragraphs: ["gl:5.134"],
    pitfalls: ["Citing a secrecy provision that is not in Schedule 3 and does not expressly apply s 38.", "Not checking whether the provision permits disclosure to this applicant."],
    line_area_questions: ["Which Act and section do you say prohibits disclosure, and does it cover this exact information?"],
    information_types: ["secrecy provision", "tax", "statutory secrecy", "protected information"],
  },
  {
    provision: "42",
    name: "Legal professional privilege",
    kind: "exempt",
    summary: "The document would be privileged from production in legal proceedings on the ground of legal professional privilege, and privilege has not been waived.",
    elements: [
      "a legal adviser–client relationship existed (including in-house lawyers with sufficient independence, [5.153]–[5.159]);",
      "the communication was for the dominant purpose of giving or receiving legal advice, or for use in actual or reasonably anticipated litigation;",
      "the communication was confidential;",
      "privilege has not been waived — expressly, or by conduct inconsistent with maintaining confidentiality (s 42(2)).",
    ],
    carve_outs: ["Not exempt by reason only that the document contains operational information of the agency (s 42(3))."],
    guidelines: { from: "gl:5.144", to: "gl:5.182", part: 5 },
    key_paragraphs: ["gl:5.147", "gl:5.153", "gl:5.160", "gl:5.168", "gl:5.177", "gl:5.181"],
    pitfalls: ["Not addressing waiver — e.g. advice summarised in a public statement or shared outside the agency.", "Claiming privilege over policy discussion that merely mentions legal advice.", "Ignoring the OAIC's view on the 'real harm' consideration ([5.177]–[5.179])."],
    line_area_questions: [
      "Who gave the advice, in what capacity, and was it for the dominant purpose of legal advice or litigation?",
      "Has the advice, or its substance, been shared outside the agency or referred to publicly?",
    ],
    information_types: ["legal advice", "lawyer", "litigation", "privilege", "AGS", "counsel"],
  },
  {
    provision: "45",
    name: "Material obtained in confidence",
    kind: "exempt",
    summary: "Disclosure would found an action for breach of confidence by a person other than an agency or the Commonwealth (s 45(1)).",
    elements: [
      "the confider is a person other than an agency or the Commonwealth;",
      "the information is specifically identified;",
      "it has the necessary quality of confidentiality (not public or trivial);",
      "it was communicated and received on the basis of a mutual understanding of confidence;",
      "disclosure would be unauthorised, or there is threatened disclosure;",
      "disclosure would cause detriment to the confider (see [5.201]–[5.202]).",
    ],
    carve_outs: ["Does not apply to deliberative documents prepared by ministers, their staff or agency officers in the course of their duties, unless disclosure would breach a confidence owed to someone outside government (s 45(2))."],
    guidelines: { from: "gl:5.183", to: "gl:5.202", part: 5 },
    key_paragraphs: ["gl:5.186", "gl:5.192", "gl:5.194", "gl:5.198", "gl:5.201"],
    pitfalls: ["Relying on a confidentiality marking or contract clause alone.", "Using s 45 where no person outside government could bring an action for breach of confidence (s 45(1)–(2))."],
    line_area_questions: [
      "Who supplied the information, and on what understanding of confidentiality? Is that understanding documented?",
      "Is the information still confidential, or now public or widely known?",
    ],
    information_types: ["confidential", "in confidence", "supplied by third party", "whistleblower"],
  },
  {
    provision: "45A",
    name: "Parliamentary Budget Office documents",
    kind: "exempt",
    summary: "Documents relating to requests to the Parliamentary Budget Office covered by s 45A.",
    elements: ["The document is of a kind described in s 45A (PBO confidential requests and related documents held by agencies)."],
    ncnd: true,
    guidelines: { from: "gl:5.203", to: "gl:5.210", part: 5 },
    key_paragraphs: ["gl:5.204", "gl:5.208"],
    pitfalls: ["Applying s 45A beyond the classes of document it lists."],
    line_area_questions: ["Did the document come from, or was it prepared for, a confidential request to the PBO?"],
    information_types: ["parliamentary budget office", "PBO", "costing"],
  },
  {
    provision: "46",
    name: "Contempt of Parliament or contempt of court",
    kind: "exempt",
    summary: "Public disclosure would be in contempt of court, contrary to an order or direction of a Royal Commission or tribunal, or would infringe the privileges of Parliament.",
    elements: [
      "s 46(a): public disclosure would, apart from the FOI Act, be in contempt of court; or",
      "s 46(b): would be contrary to an order or direction by a Royal Commission or a body with power to take evidence on oath; or",
      "s 46(c): would infringe the privileges of the Parliament of the Commonwealth, a State or a Territory.",
    ],
    guidelines: { from: "gl:5.211", to: "gl:5.225", part: 5 },
    key_paragraphs: ["gl:5.214", "gl:5.217", "gl:5.218"],
    pitfalls: ["Assuming every document provided to a parliamentary committee is privileged."],
    line_area_questions: ["Is there a court order, suppression order or committee direction covering this document?"],
    information_types: ["court order", "suppression order", "parliamentary committee", "royal commission"],
  },
  {
    provision: "47",
    name: "Trade secrets or commercially valuable information",
    kind: "exempt",
    summary: "Disclosure would disclose trade secrets, or information having a commercial value that would be, or could reasonably be expected to be, destroyed or diminished by disclosure.",
    elements: [
      "s 47(1)(a): the information is a trade secret; or",
      "s 47(1)(b): the information has a commercial value, and that value would be, or could reasonably be expected to be, destroyed or diminished if disclosed.",
    ],
    consultation: "Consult the business under s 27 where it might reasonably wish to contend s 47 or s 47G applies and consultation is reasonably practicable (+30 days, s 15(6)).",
    guidelines: { from: "gl:5.226", to: "gl:5.238", part: 5 },
    key_paragraphs: ["gl:5.229", "gl:5.234", "gl:5.238"],
    pitfalls: ["Treating all commercial information as commercially valuable without showing how disclosure diminishes value."],
    line_area_questions: ["What gives this information commercial value, to whom, and how would disclosure reduce it? Is it still current?"],
    information_types: ["trade secret", "commercial", "pricing", "intellectual property", "tender"],
  },
  {
    provision: "47A",
    name: "Electoral rolls and related documents",
    kind: "exempt",
    summary: "Electoral rolls, prints, habitation indexes and related documents, other than the applicant's own electoral particulars.",
    elements: ["The document is an electoral roll, a print or copy of one, a habitation index, or a related document of a kind in s 47A."],
    carve_outs: ["The applicant's own electoral particulars are not exempt (s 47A(3)–(5))."],
    guidelines: { from: "gl:5.239", to: "gl:5.241", part: 5 },
    key_paragraphs: ["gl:5.239", "gl:5.241"],
    pitfalls: [],
    line_area_questions: [],
    information_types: ["electoral roll", "AEC", "elector"],
  },
  {
    provision: "47B",
    name: "Commonwealth–State relations",
    kind: "conditional",
    summary: "Disclosure would, or could reasonably be expected to, damage Commonwealth–State relations, or would divulge information communicated in confidence by a State.",
    elements: [
      "s 47B(a): disclosure would, or could reasonably be expected to, cause damage to relations between the Commonwealth and a State; or",
      "s 47B(b): would divulge information or matter communicated in confidence by or on behalf of the Government of a State or an authority of a State to the Commonwealth or a Commonwealth authority; or",
      "s 47B(d), (f): the equivalents for information communicated in confidence by or to a Norfolk Island authority.",
    ],
    consultation: "Consult the State under s 26A where it may reasonably wish to contend s 47B applies (+30 days, s 15(6)); its views must be considered but are not decisive ([6.40]–[6.45]).",
    guidelines: { from: "gl:6.22", to: "gl:6.45", part: 6 },
    key_paragraphs: ["gl:6.25", "gl:6.32", "gl:6.34", "gl:6.40", "gl:6.240"],
    pitfalls: ["Assuming that any State involvement means damage to relations.", "Treating the State's objection as decisive."],
    line_area_questions: [
      "How would release damage the working relationship with the State — e.g. an ongoing negotiation or a confidential intergovernmental process?",
      "Did the State give us the information in confidence?",
    ],
    information_types: ["state government", "intergovernmental", "national cabinet", "federation"],
  },
  {
    provision: "47C",
    name: "Deliberative processes",
    kind: "conditional",
    summary: "The document would disclose deliberative matter — opinion, advice, recommendation, consultation or deliberation — in the course of, or for the purposes of, the agency's or minister's deliberative processes.",
    elements: [
      "the document contains opinion, advice or recommendation obtained, prepared or recorded, or a consultation or deliberation that has taken place;",
      "in the course of, or for the purposes of, the deliberative processes involved in the functions of an agency, a minister or the Government;",
      "the material is not excluded by s 47C(2)–(3).",
    ],
    carve_outs: [
      "Operational information (s 8A) — s 47C(2)(a).",
      "Purely factual material — s 47C(2)(b) ([6.67]–[6.72]).",
      "Reports of scientific or technical experts, reports of prescribed bodies, and records of or formal statements of reasons for final decisions — s 47C(3) ([6.73]–[6.75]).",
    ],
    harm_test: `No harm element: harm is considered in the public interest test. ${FRANKNESS_GUIDANCE}`,
    guidelines: { from: "gl:6.46", to: "gl:6.78", part: 6 },
    key_paragraphs: ["gl:6.54", "gl:6.59", "gl:6.67", "gl:6.73", "gl:6.245"],
    pitfalls: [
      "Applying s 47C to whole documents without separating purely factual material that can be released (s 22, [6.70]–[6.72]).",
      "Treating a document as deliberative because of its format (a brief, a submission, a draft) rather than its content ([6.61]).",
    ],
    line_area_questions: [
      "Which parts are opinion, advice or recommendation, and which are facts or background?",
      "Is the deliberation still live? Has a final decision been made and announced?",
      "If you say release would harm future advice, what specific evidence supports that for this document?",
    ],
    information_types: ["advice", "recommendation", "opinion", "options", "policy development", "deliberation", "consultation"],
  },
  {
    provision: "47D",
    name: "Financial or property interests of the Commonwealth",
    kind: "conditional",
    summary: "Disclosure would have a substantial adverse effect on the financial or property interests of the Commonwealth or an agency.",
    elements: ["the Commonwealth or an agency has a financial or property interest;", "disclosure would have a substantial adverse effect on that interest."],
    harm_test: "'Substantial adverse effect' — a serious or significant effect, not trivial ([6.81]–[6.83]).",
    guidelines: { from: "gl:6.79", to: "gl:6.83", part: 6 },
    key_paragraphs: ["gl:6.80", "gl:6.81"],
    pitfalls: ["Asserting financial harm without quantifying or explaining it."],
    line_area_questions: ["What financial or property interest is at stake (e.g. a current sale, negotiation, or litigation exposure), and what is the likely size of the effect?"],
    information_types: ["financial interests", "property", "negotiation", "commonwealth assets", "procurement strategy"],
  },
  {
    provision: "47E",
    name: "Certain operations of agencies",
    kind: "conditional",
    summary: "Disclosure would, or could reasonably be expected to, prejudice tests, examinations or audits, or have a substantial adverse effect on personnel management or on the proper and efficient conduct of the agency's operations.",
    elements: [
      "s 47E(a): prejudice the effectiveness of procedures or methods for the conduct of tests, examinations or audits; or",
      "s 47E(b): prejudice the attainment of the objects of particular tests, examinations or audits; or",
      "s 47E(c): have a substantial adverse effect on the management or assessment of personnel; or",
      "s 47E(d): have a substantial adverse effect on the proper and efficient conduct of the operations of an agency.",
    ],
    harm_test: "Paragraphs (c) and (d) require a substantial adverse effect; the predicted effect must be explained, not assumed ([6.88]–[6.92]).",
    guidelines: { from: "gl:6.84", to: "gl:6.118", part: 6 },
    key_paragraphs: ["gl:6.88", "gl:6.90", "gl:6.92", "gl:6.102", "gl:6.112"],
    pitfalls: [
      "Using s 47E(d) to protect staff names, email addresses or phone numbers without evidence of an effect on operations.",
      "Claiming that the FOI process itself, or the time spent processing, is the adverse effect.",
    ],
    line_area_questions: [
      "What exactly would release do to the agency's operations, and how substantial would that be?",
      "Would it undermine a test, audit or examination method that is not already public?",
      "For staff matters: how would release affect managing or assessing staff?",
    ],
    information_types: ["operations", "audit", "personnel management", "systems", "internal procedures", "security procedures"],
  },
  {
    provision: "47F",
    name: "Personal privacy",
    kind: "conditional",
    summary: "Disclosure would involve the unreasonable disclosure of personal information about any person, including a deceased person.",
    elements: [
      "the document contains personal information about a person — information or an opinion about an identified or reasonably identifiable individual ([6.122]–[6.132]);",
      "disclosure would be unreasonable, having regard to (s 47F(2)): (a) how well known the information is; (b) whether the person is known to be associated with the matters; (c) availability from public sources; (d) any other relevant matters ([6.133]–[6.142]).",
    ],
    carve_outs: [
      "Not conditionally exempt merely because it is the applicant's own personal information (s 47F(3)).",
      "Where information about the applicant was provided by a qualified person and access might be detrimental to their health or wellbeing, access may be given through a qualified person (s 47F(4)–(5), [6.171]–[6.176]).",
    ],
    consultation: "Consult the person under s 27A where they might reasonably wish to contend the information is conditionally exempt (+30 days, s 15(6), [6.156]–[6.170]).",
    guidelines: { from: "gl:6.119", to: "gl:6.176", part: 6 },
    key_paragraphs: ["gl:6.122", "gl:6.133", "gl:6.146", "gl:6.153", "gl:6.156"],
    pitfalls: [
      "Redacting all public servants' names and work details by default, instead of applying the s 47F(2) factors to each in context ([6.149]–[6.152]).",
      "Forgetting the public interest test after finding information conditionally exempt.",
    ],
    line_area_questions: [
      "Whose personal information is it, and what is their connection to the matter?",
      "Is it already known or public? Would release be unreasonable — e.g. health, family, complaints, or allegations?",
      "Is there a specific risk (e.g. harassment) to a staff member if their name is released? What is the evidence?",
    ],
    information_types: ["personal information", "names", "health", "complaint", "allegation", "staff names", "contact details", "privacy"],
  },
  {
    provision: "47G",
    name: "Business information",
    kind: "conditional",
    summary: "Disclosure of information about a person's business, commercial or financial affairs would, or could reasonably be expected to, unreasonably affect them adversely, or prejudice the future supply of information to the Commonwealth.",
    elements: [
      "the information concerns a person's or organisation's business, commercial, financial or professional affairs ([6.191]–[6.195]);",
      "s 47G(1)(a): disclosure would, or could reasonably be expected to, unreasonably affect that person adversely in their lawful business, commercial or financial affairs; or",
      "s 47G(1)(b): could reasonably be expected to prejudice the future supply of information to the Commonwealth or an agency for the administration of a law or of matters administered by an agency.",
    ],
    carve_outs: ["Does not apply to trade secrets or commercially valuable information covered by s 47 (s 47G(2)); and does not cover the applicant's own business information (s 47G(3))."],
    consultation: "Consult the business under s 27 where it might reasonably wish to contend s 47G applies and consultation is reasonably practicable (+30 days, s 15(6), [6.201]–[6.212]).",
    guidelines: { from: "gl:6.177", to: "gl:6.212", part: 6 },
    key_paragraphs: ["gl:6.181", "gl:6.184", "gl:6.196", "gl:6.201"],
    pitfalls: ["Accepting a business's objection without testing whether the adverse effect is unreasonable.", "Claiming prejudice to future supply where suppliers are legally obliged to provide the information."],
    line_area_questions: [
      "What adverse effect on the business would release cause, and why would that be unreasonable?",
      "Do businesses give us this information voluntarily? Would release make them stop?",
    ],
    information_types: ["business information", "contract", "supplier", "grant applicant", "commercial", "financial affairs"],
  },
  {
    provision: "47H",
    name: "Research",
    kind: "conditional",
    summary: "Information about research by an officer of CSIRO or ANU, where premature disclosure would be likely unreasonably to expose the agency or officer to disadvantage.",
    elements: ["the agency is CSIRO or ANU (Schedule 4);", "the information relates to research being, or to be, undertaken by an officer;", "disclosure before completion would be likely unreasonably to expose the agency or officer to disadvantage."],
    guidelines: { from: "gl:6.213", to: "gl:6.214", part: 6 },
    key_paragraphs: ["gl:6.213"],
    pitfalls: ["Applying s 47H in an agency not listed in Schedule 4."],
    line_area_questions: ["Is the research incomplete, and what disadvantage would premature release cause?"],
    information_types: ["research", "CSIRO", "ANU"],
  },
  {
    provision: "47J",
    name: "The economy",
    kind: "conditional",
    summary: "Disclosure would, or could reasonably be expected to, have a substantial adverse effect on Australia's economy by influencing decisions of businesses or people, or by giving an undue benefit or detriment through premature disclosure.",
    elements: [
      "disclosure would, or could reasonably be expected to, have a substantial adverse effect on Australia's economy — which includes a particular sector or region (s 47J(2));",
      "by (a) influencing a decision or action of a person or entity, or (b) giving a person or class an undue benefit or detriment in their business through premature knowledge of proposed or possible action (s 47J(1)).",
      "s 47J(3) lists examples: currency, interest rates, taxes, financial regulation, expenditure proposals, foreign investment, government borrowing.",
    ],
    guidelines: { from: "gl:6.215", to: "gl:6.221", part: 6 },
    key_paragraphs: ["gl:6.215"],
    pitfalls: ["Claiming economy-wide effects for information of narrow significance."],
    line_area_questions: ["What market or economic effect would premature release have, and how substantial is it?"],
    information_types: ["economy", "market sensitive", "interest rates", "budget", "economic forecast"],
  },
];

export const EXEMPTION_BY_PROVISION = new Map(EXEMPTIONS.map((e) => [e.provision, e]));

/** "s 47F", "47f", "47F(1)", "section 47F" → "47F" */
export function normaliseProvision(input: string): string {
  return input.replace(/^(s(ection)?\.?\s*)/i, "").replace(/\(.*$/, "").trim().toUpperCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exemptions whose listed information types appear as whole words in `text`, best first. */
export function suggestExemptions(text: string): Exemption[] {
  return EXEMPTIONS.map((e) => ({
    e,
    score: e.information_types.filter((t) => new RegExp(`\\b${escapeRe(t)}\\b`, "i").test(text)).length,
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}
