/**
 * Bundled plain-text fallbacks for /legal/[slug]. Firestore `contentPages/{slug}`
 * wins when available; these constants keep the pages readable offline or when
 * the Admin SDK is not configured. Nothing here is legal advice.
 */

export interface LegalPageContent {
  title: string;
  summary: string;
  body: string;
}

/** The nine public legal routes, plus an optional FAQ content page. */
export const LEGAL_SLUGS = [
  'about',
  'privacy',
  'terms',
  'registrant-notice',
  'refunds',
  'acceptable-use',
  'cookies',
  'contact',
  'help',
] as const;

/** Statements that must appear on every legal page. Kept identical on purpose. */
const COMMON = `[LEGAL REVIEW NEEDED] This is a Phase 1 draft. Have qualified counsel review it before publication. Replace [YOUR NAME], [SUPPORT EMAIL] and [DOMAIN] with the approved legal entity, support address and production domain.
Yivents is software. Yivents does not hold, process, receive or transmit payments. Money moves directly between the organiser and the registrant through the payment method the organiser publishes.
Organisers are responsible for their events, for refunds and for honouring tickets. Yivents does not promise that an event will take place or that a refund will be paid.
Organisers control registrant data. Yivents processes that data only on the organiser's behalf, to provide registration, ticketing, check-in and support.
Yivents does not sell personal data.
Admin access is limited to staff acting for support, abuse or legal reasons, and is logged.
Retention and archiving are described in section 4.12 of the organiser terms. The default is archiving 14 days after an event and retention for 12 months, and these values can be configured in settings.
Terms are accepted at sign-up and the accepted version is stored with the account.
This notice is framed with reference to the Ghana Data Protection Act 2012 (Act 843). [LEGAL REVIEW NEEDED] Confirm the applicable jurisdiction and any further notices with counsel.
Questions can be sent to [SUPPORT EMAIL]. The operator is [YOUR NAME] and the service is [DOMAIN].`;

export const LEGAL_PAGES: Record<string, LegalPageContent> = {
  about: {
    title: 'About Yivents',
    summary: 'Yivents is registration, payment-tracking and ticketing software for event organisers. We are not the event organiser and we do not handle payments.',
    body: `Yivents helps organisers publish an event, collect registrations, track MoMo or bank payment details supplied by registrants, issue tickets and check people in at the door.
An organiser decides the event details, ticket prices, questions, deadlines and whether to approve registrations. A registrant deals with that organiser for the event itself.
[LEGAL REVIEW NEEDED] Insert the approved company description and registration details for [YOUR NAME].

${COMMON}`,
  },
  privacy: {
    title: 'Privacy notice',
    summary: 'Organisers decide what registrant data is collected. Yivents processes it on their behalf, does not sell it and limits staff access to support, abuse and legal work.',
    body: `For organisers we store account details, event content and settings. For registrants we store the answers and contact details the organiser asks for, the ticket code, the status of the registration and the payment reference the registrant provides.
The organiser is the controller of registrant data. Yivents acts as processor and uses the data only to deliver the service and to respond to support or abuse reports.
[LEGAL REVIEW NEEDED] Confirm the lawful basis, retention schedule and any cross-border transfer statement with counsel before publication.

${COMMON}`,
  },
  terms: {
    title: 'Terms of service',
    summary: 'Plain-English terms for organisers: you run your event, handle payments and refunds, honour tickets and follow the acceptable-use rules.',
    body: `By creating an account you accept these terms. The version accepted at sign-up is stored with your account so both sides can see which version applied.
You must publish accurate event information, set your own prices and deadlines, verify payments yourself, issue refunds where required and honour valid tickets. You must not collect sensitive questions that Yivents blocks or flags.
[LEGAL REVIEW NEEDED] Section 4.12 covers archiving and retention; confirm the final numbering and wording with counsel.

${COMMON}`,
  },
  'registrant-notice': {
    title: 'Notice for registrants',
    summary: 'If you register for an event, the organiser receives your details and manages your ticket. Yivents only runs the software.',
    body: `When you register, the details you enter go to the organiser of that event. They decide how to use them, whether to approve your registration and how to contact you about the event.
Your ticket code is what you present at the door. Keep it private. Yivents does not take payment and cannot refund a payment on the organiser's behalf; contact the organiser using the details they publish.
[LEGAL REVIEW NEEDED] Confirm what must be disclosed at the point of registration, not only on this page.

${COMMON}`,
  },
  refunds: {
    title: 'Refunds and payments',
    summary: 'Yivents never holds your money. The organiser sets refund rules, checks payment proofs and handles any refund request.',
    body: `Payment details shown in Yivents are records entered by organisers or registrants. Yivents does not receive, hold or move funds, and cannot reverse a Mobile Money or bank transfer.
Ask the organiser for their refund policy before you pay. If an event is cancelled or changed, contact the organiser. Yivents supports the organiser by keeping registration and ticket records accurate.
[LEGAL REVIEW NEEDED] Confirm the wording against Ghanaian consumer law and the organiser's own policy.

${COMMON}`,
  },
  'acceptable-use': {
    title: 'Acceptable use',
    summary: 'Do not abuse the service, submit false registrations, harvest data, evade blocks or upload unlawful content. Abuse can lead to suspension.',
    body: `You must not use Yivents to send misleading event information, create duplicate or fake registrations, scrape listings, upload content you do not have rights to, or attempt to bypass rate limits, CAPTCHA or blocklist entries.
Suspensions and removals are applied by administrators with an audited action. A suspension reason is shown to the affected organiser and can be restored after review.
[LEGAL REVIEW NEEDED] Add the final enforcement and appeal process approved by counsel.

${COMMON}`,
  },
  cookies: {
    title: 'Cookies and local storage',
    summary: 'Yivents uses essential browser storage to keep you signed in and remember preferences. We do not sell data collected through it.',
    body: `Sign-in state and admin session safety rely on essential storage set by Firebase Authentication and the browser. Saved form preferences may also be kept locally on your device.
[LEGAL REVIEW NEEDED] Verify the final list of cookies, storage keys and third parties with counsel and analytics configuration before publication. Do not add advertising or tracking claims that are not true.

${COMMON}`,
  },
  contact: {
    title: 'Contact',
    summary: 'For support, privacy or abuse reports, use the support address below. Event-specific questions go to the organiser.',
    body: `Support and privacy questions: [SUPPORT EMAIL]. Service domain: [DOMAIN]. Operator: [YOUR NAME].
For a question about a registration, refund or ticket, contact the organiser of that event first. Yivents staff can help with account access, abuse reports and technical faults.
[LEGAL REVIEW NEEDED] Confirm monitoring hours and the abuse-report escalation path.

${COMMON}`,
  },
  help: {
    title: 'Help centre',
    summary: 'Start here for common tasks: registering, finding a ticket, organiser approvals, scanner access and account security.',
    body: `Registrants: check your ticket in the ticket lookup, keep the ticket code private, and contact the organiser about approvals, refunds and event changes.
Organisers: publish an event, review pending registrations, generate scanner credentials, and export registrations from your event dashboard. Enable two-factor authentication on any admin account.
[LEGAL REVIEW NEEDED] Link this page to the approved help articles and support process.

${COMMON}`,
  },
  faq: {
    title: 'Frequently asked questions',
    summary: 'Short answers about payments, tickets, data and who is responsible for an event.',
    body: `Who runs the event? The organiser. Yivents provides the software.
Who handles my payment? The organiser, through the payment method they publish. Yivents does not hold funds.
Who sees my registration details? The organiser of that event. Yivents processes them on the organiser's behalf and does not sell them.
Who do I ask about a refund? The organiser.

${COMMON}`,
  },
};
