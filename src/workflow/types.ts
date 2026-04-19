/**
 * Workflow definition schema.
 *
 * A WorkflowDefinition is a named, reusable automation script with typed
 * parameters and ordered steps.  Steps are engine-agnostic — the workflow
 * engine's router picks the right browser automation engine per step.
 *
 * Parameter substitution: any string value in a step can contain {{param_name}}
 * placeholders which are replaced with the caller-supplied params at runtime.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Step schemas
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Intent contract (deterministic field targeting / sensitivity)
// ---------------------------------------------------------------------------

export const FieldKindSchema = z.enum([
  'freeform',
  'name',
  'address',
  'email',
  'phone',
  'dob',
  'ssn',
  'credentials',
  'credit_card',
]);

export const FieldSensitivitySchema = z.enum([
  'none',
  'pii',
  'spi',
  'credentials',
  'payment',
]);

export const FieldValueSourceSchema = z.enum([
  'params',
  'hitl',
  'derived',
]);

export const FieldIntentSchema = z.object({
  /** Stable identifier used for correlation/indexing. */
  id: z.string(),
  /** Human label used in UI/HITL prompts and memory updates. */
  label: z.string(),
  kind: FieldKindSchema,
  sensitivity: FieldSensitivitySchema.default('none'),
  source: FieldValueSourceSchema.default('params'),
});

export const NavigateStepSchema = z.object({
  type: z.literal('navigate'),
  id: z.string(),
  description: z.string().optional(),
  url: z.string(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
});

export const ClickStepSchema = z.object({
  type: z.literal('click'),
  id: z.string(),
  description: z.string().optional(),
  selector: z.string(),
});

export const TypeStepSchema = z.object({
  type: z.literal('type'),
  id: z.string(),
  description: z.string().optional(),
  selector: z.string(),
  text: z.string(),
  clearFirst: z.boolean().optional(),
  /**
   * Optional intent contract describing which field is being targeted and its
   * sensitivity. The workflow engine uses this for deterministic PII gating
   * and prompt redaction (no regex over prompts/selectors).
   */
  field: FieldIntentSchema.optional(),
});

export const ScreenshotStepSchema = z.object({
  type: z.literal('screenshot'),
  id: z.string(),
  description: z.string().optional(),
  outputKey: z.string().optional(),
});

export const ExtractStepSchema = z.object({
  type: z.literal('extract'),
  id: z.string(),
  description: z.string().optional(),
  /** Natural language hint about what to extract (returned as context in the output) */
  instruction: z.string(),
  /** Key in the workflow result outputs map to store extracted value */
  outputKey: z.string(),
});

export const AgentTaskStepSchema = z.object({
  type: z.literal('agent_task'),
  id: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
  /**
   * 'auto' (default) lets the router pick based on heuristics.
   * Override to force a specific engine.
   */
  engine: z.enum(['auto', 'browser-use', 'stagehand', 'skyvern']).optional(),
  /**
   * Memory section label injected into the MEMORY_UPDATE block.
   * Used by short-term memory to group completed fields by form section.
   * Defaults to the step id slug.
   */
  memorySection: z.string().optional(),
  /**
   * Optional list of fields the agent is expected to interact with in this
   * step. Used to deterministically redact sensitive memory updates without
   * parsing the prompt text.
   */
  targets: z.array(FieldIntentSchema).optional(),
});

export const HumanTakeoverStepSchema = z.object({
  type: z.literal('human_takeover'),
  id: z.string(),
  reason: z.string(),
  instructions: z.string().optional(),
  mode: z.enum(['takeover', 'confirm_completion']).optional(),
  skipIfAuthenticated: z.object({
    urlIncludes: z.array(z.string()).optional(),
    visibleSelectors: z.array(z.string()).optional(),
    textIncludes: z.array(z.string()).optional(),
  }).optional(),
});

export const WorkflowStepSchema = z.discriminatedUnion('type', [
  NavigateStepSchema,
  ClickStepSchema,
  TypeStepSchema,
  ScreenshotStepSchema,
  ExtractStepSchema,
  AgentTaskStepSchema,
  HumanTakeoverStepSchema,
]);

// ---------------------------------------------------------------------------
// Param schema
// ---------------------------------------------------------------------------

export const ParamDefinitionSchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().optional(),
  /** If false, the param is optional (default: true) */
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export const WorkflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  params: z.record(ParamDefinitionSchema).optional().default({}),
  steps: z.array(WorkflowStepSchema),
});

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

export type NavigateStep = z.infer<typeof NavigateStepSchema>;
export type ClickStep = z.infer<typeof ClickStepSchema>;
export type TypeStep = z.infer<typeof TypeStepSchema>;
export type ScreenshotStep = z.infer<typeof ScreenshotStepSchema>;
export type ExtractStep = z.infer<typeof ExtractStepSchema>;
export type AgentTaskStep = z.infer<typeof AgentTaskStepSchema>;
export type HumanTakeoverStep = z.infer<typeof HumanTakeoverStepSchema>;

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type ParamDefinition = z.infer<typeof ParamDefinitionSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ---------------------------------------------------------------------------
// Workflow result
// ---------------------------------------------------------------------------

export interface StepResult {
  stepId: string;
  success: boolean;
  durationMs: number;
  output?: string;
  screenshotPath?: string;
  screenshotBase64?: string;
  error?: string;
}

export interface WorkflowResult {
  workflowId: string;
  success: boolean;
  stepResults: StepResult[];
  /** Named outputs from extract steps, keyed by outputKey */
  outputs: Record<string, string>;
  /** All screenshots taken during the workflow */
  screenshots: Array<{ path: string; base64: string; stepId: string }>;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Built-in workflow templates
// ---------------------------------------------------------------------------

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  // ---------------------------------------------------------------------------
  // DOT Aviation Consumer Complaint — Alaska Airlines AS683 (April 14, 2026)
  // ---------------------------------------------------------------------------
  {
    id: 'dot_complaint_as683',
    name: 'DOT Complaint — Alaska Airlines AS683',
    description: 'File the prepared DOT aviation consumer complaint for flight AS683 (SAN→SEA, Apr 14 2026). Split into 4 focused phases with memory carry-forward between each.',
    params: {},
    steps: [
      // ---- Navigate to the DOT complaint portal ----------------------------
      {
        type: 'navigate',
        id: 'open_dot',
        url: 'https://www.transportation.gov/airconsumer/file-consumer-complaint',
        waitUntil: 'domcontentloaded',
      },

      // ---- PHASE 1: Submission type + contact information ------------------
      {
        type: 'agent_task',
        id: 'phase1_contact',
        engine: 'browser-use',
        memorySection: 'contact',
        prompt: `PHASE 1 of 4 — Submission type and contact information.

You are on the DOT aviation consumer complaint portal at transportation.gov.
Your ONLY goal in this phase is to reach the Flight Information page.

STEP A — Click "File a Consumer Complaint" (or "Begin") button to start the form.

STEP B — On the first question page, select:
  • Submission type: Complaint (not a comment or inquiry)
  Then click Next.

STEP C — Fill in ALL contact fields:
  First Name: Robert
  Last Name: Mosher
  Email: robmosher42@gmail.com
  Phone: (leave blank)
  Preferred contact method: Email
  Street address: 9519 235th St. SW
  City: Edmonds
  State: WA
  Zip: 98020
  Then click Next.

STOP when you reach the Flight Information page (you will see fields for airline, flight number, departure date, airports).
Do NOT fill any flight fields yet — that is Phase 2.

IMPORTANT FORM NOTES:
- This is a Salesforce Experience Cloud form. For each dropdown: click the field first, wait 1 second, then select the value.
- Do not skip any required fields or the Next button will not advance the form.`,
      },

      // ---- PHASE 2: Flight information -------------------------------------
      {
        type: 'agent_task',
        id: 'phase2_flight',
        engine: 'browser-use',
        memorySection: 'flight',
        prompt: `PHASE 2 of 4 — Flight information.

You are on the Flight Information page of the DOT complaint form.
Fill in ALL flight fields using the data below, then click Next.

FLIGHT FIELDS TO FILL:
  US itinerary: Yes
  Were you able to complete booking: Yes
  Complaint subject: Airline
  Purchased directly with airline: Yes
  Confirmation numbers: FGSLNP (enter just the first one if field only accepts one)
  Flight itinerary type: Round Trip

  Bottom section (specific flight):
  Airline: Alaska Airlines  ← type "Alaska" in the combobox and WAIT for "Alaska Airlines (AS)" to appear in the dropdown, then click it
  Flight number: AS683
  Date of departure: April 14, 2026
  Departure airport: type "San Diego" (NOT "SAN") and wait for "San Diego International (SAN)" suggestion, then click it
  Date of arrival: April 14, 2026
  Arrival airport: type "Seattle" (NOT "SEA") and wait for "Seattle/Tacoma International (SEA)" suggestion, then click it

CRITICAL RULES:
1. For every dropdown: click the field → wait 1 second → select value. Never skip the wait.
2. For autocomplete fields (Airline, Departure Airport, Arrival Airport): type the FULL NAME (not IATA codes), wait 2 seconds for suggestions, then click the suggestion.
3. After selecting each value, confirm it shows correctly before moving on.
4. If a field shows "Please select a choice" validation error after you selected it, click the field again and re-select.

STOP after clicking Next and the form advances to the next page (Details/Categories page).`,
      },

      // ---- PHASE 3: Complaint details + description ------------------------
      {
        type: 'agent_task',
        id: 'phase3_details',
        engine: 'browser-use',
        memorySection: 'details',
        prompt: `PHASE 3 of 4 — Complaint categories and description.

You are past the Flight Information page. Complete the Details and Description sections.

STEP A — On the Details/Categories page:
  Check: "Flight Schedule" (or "Flight Delay")
  Check: "Baggage / Luggage"
  For Flight Schedule sub-option: select "The flight was delayed"
  For Baggage sub-option: select the closest option to "late baggage delivery"
  Click Next.

STEP B — On the Description/Narrative page, paste this text exactly into the complaint description field:

Flight AS683 (SAN→SEA, 4/14/26) experienced multiple controllable operational failures causing a 6-hour 23-minute delay:

FAILURE #1 (Mechanical): Generator malfunction at gate; 1h 30m delay while mechanics attempted repair (4:42-5:40 PM)

FAILURE #2 (Failed Repair): Initial repair inadequate; smoke detected during taxi requiring return to gate; 40-50m additional gate repair hold (6:10-7:10 PM)

FAILURE #3 (Operational): Upon landing in Seattle at 10:00 PM, no ground personnel available at gate; 1h 5m tarmac hold awaiting gate assignment (10:00-11:05 PM)

FAILURE #4 (Service): Baggage not delivered within 20-minute promise after 11:05 PM deplane

TOTAL CONTROLLABLE DELAY: approximately 3h 45m (exceeds Alaska Dashboard 3-hour threshold)

PASSENGERS: 5 total (Robert Jr Mosher, Ava Mosher, Audrey Mosher, Leo Mosher, Lauren Betourne) including 2 elite ATMOS loyalty members.

ALASKA'S RESPONSE:
- Phone offer April 15 (rep: Chelsea): 30,000 miles ($300 total for 5 passengers) — refused escalation to supervisor
- Email response April 16 (Nellie T., ref CN00138057): 15,000 points ($150 total) — offer reduced 50% after complaint
- Both offers violate Alaska's own DOT Dashboard commitment for 3+ hour controllable delays

REGULATION: 49 U.S.C. Section 41712. Alaska published compensation commitments on DOT Dashboard for controllable delays exceeding 3 hours. This delay exceeded the threshold; Alaska failed to provide committed compensation and acted in bad faith by reducing offer after escalation.

REQUEST: DOT intervention requiring Alaska to provide $1,250–1,500 in compensation (or equivalent Mileage Plan miles) consistent with their published commitment, plus meal reimbursement.

STEP C — If there is a "Resolution Requested" field, enter:
  Monetary compensation or miles equivalent to $1,250–1,500 for 5 passengers. Meal reimbursement. Compliance with published service standards.

STOP after clicking Next past the description page (you should reach the file upload / attachments page).`,
      },

      // ---- PHASE 4: File uploads -------------------------------------------
      {
        type: 'agent_task',
        id: 'phase4_uploads',
        engine: 'browser-use',
        memorySection: 'attachments',
        prompt: `PHASE 4 of 4 — File attachments.

You are on the file upload / attachments section of the DOT complaint form.
Upload all of the following files. Use the file input field(s) on the page.

FILE LIST (upload ALL of these):
1. /home/spoq/alaskacomplaint/documents/Gmail - Alaska Airlines Customer Care - Case CN00138057.pdf
2. /home/spoq/alaskacomplaint/documents/Gmail - Your confirmation receipt_ FGSLNP for your flight to San Diego, CA on 2026-04-08.pdf
3. /home/spoq/alaskacomplaint/documents/Gmail - Your confirmation receipt_ GNQIMT for your flight to San Diego, CA on 2026-04-08.pdf
4. /home/spoq/alaskacomplaint/documents/Gmail - Your confirmation receipt_ KZHHTA for your flight to San Diego, CA on 2026-04-08.pdf
5. /home/spoq/alaskacomplaint/documents/Alaska_Phone_Call.jpg
6. /home/spoq/alaskacomplaint/documents/Screenshot from 2026-04-16 17-33-54.png
7. /home/spoq/alaskacomplaint/artifacts/Flight_Info.webp

For each file: locate the file upload input (type=file), set its value to the absolute path above using JavaScript if needed, or use the upload button.

After all 7 files are attached, click Next to reach the Review / Summary page.

STOP on the Review/Summary page. DO NOT click Submit. The human operator will review everything and submit.`,
      },

      // ---- HITL: human reviews and submits --------------------------------
      {
        type: 'human_takeover',
        id: 'final_review',
        reason: 'All 4 phases complete. Please review the form and submit.',
        instructions: 'Review all fields carefully. Add your phone number if required. Verify all 7 attachments are listed. When satisfied, click SUBMIT on the DOT form — then click "Return Control to Claude" so Claude can capture the confirmation number.',
      },

      // ---- Capture confirmation --------------------------------------------
      {
        type: 'extract',
        id: 'get_confirmation',
        instruction: 'Extract the complaint confirmation number, case reference number, and any other identifiers shown on the confirmation page',
        outputKey: 'dot_confirmation',
      },
      {
        type: 'screenshot',
        id: 'confirmation_screenshot',
        description: 'Capture the DOT complaint confirmation page',
        outputKey: 'confirmation_screenshot_path',
      },
    ],
  },

  {
    id: 'dispute_charge',
    name: 'Credit Card Charge Dispute',
    description: 'Navigate to a credit card portal, let the user authenticate, then autonomously find and dispute a charge.',
    params: {
      portal_url: { type: 'string', description: 'URL of the credit card portal login page' },
      charge_amount: { type: 'string', description: 'Amount of the charge to dispute (e.g. "$47.99")' },
      charge_date: { type: 'string', description: 'Date of the charge (e.g. "April 10, 2026")', required: false, default: '' },
      dispute_reason: { type: 'string', description: 'Reason for the dispute', required: false, default: 'Unauthorized charge' },
    },
    steps: [
      {
        type: 'navigate',
        id: 'open_portal',
        description: 'Navigate to the credit card portal',
        url: '{{portal_url}}',
        waitUntil: 'domcontentloaded',
      },
      {
        type: 'human_takeover',
        id: 'user_login',
        reason: 'Please log in to your credit card account',
        instructions: 'Once you are logged in and can see your account dashboard, click "Return Control to Claude" below.',
      },
      {
        type: 'agent_task',
        id: 'find_and_dispute',
        description: 'Find the charge and initiate dispute',
        prompt: 'Find the transaction for {{charge_amount}}{{charge_date}} and initiate a dispute. Reason for dispute: {{dispute_reason}}. Complete the dispute form and submit it.',
        engine: 'auto',
      },
      {
        type: 'extract',
        id: 'get_confirmation',
        description: 'Extract dispute confirmation details',
        instruction: 'Extract the dispute case number or confirmation number',
        outputKey: 'confirmation',
      },
      {
        type: 'screenshot',
        id: 'final_screenshot',
        description: 'Capture the dispute confirmation screen',
        outputKey: 'confirmation_screenshot',
      },
    ],
  },

  {
    id: 'authenticated_task',
    name: 'Authenticated Web Task',
    description: 'Generic pattern: navigate to any portal, let the user log in, then run an autonomous task with the authenticated session.',
    params: {
      url: { type: 'string', description: 'URL to navigate to' },
      task: { type: 'string', description: 'What to do after authentication' },
      login_instructions: { type: 'string', description: 'Instructions shown during login', required: false, default: 'Please log in and click Return Control when ready.' },
    },
    steps: [
      {
        type: 'navigate',
        id: 'navigate',
        url: '{{url}}',
        waitUntil: 'domcontentloaded',
      },
      {
        type: 'human_takeover',
        id: 'authenticate',
        reason: 'Authentication required',
        instructions: '{{login_instructions}}',
      },
      {
        type: 'agent_task',
        id: 'run_task',
        prompt: '{{task}}',
        engine: 'auto',
      },
      {
        type: 'screenshot',
        id: 'result_screenshot',
        description: 'Capture the final state',
      },
    ],
  },

  {
    id: 'post_to_x',
    name: 'Post To X',
    description: 'Open X/Twitter, let the user authenticate, draft and publish the post autonomously, then require HITL to confirm the final published state.',
    params: {
      post_text: { type: 'string', description: 'Exact text to publish on X' },
      x_url: {
        type: 'string',
        description: 'Starting URL for X compose flow',
        required: false,
        default: 'https://x.com/compose/post',
      },
      login_instructions: {
        type: 'string',
        description: 'Instructions shown while authenticating to X',
        required: false,
        default: 'Log in to X/Twitter and wait until the compose screen or home timeline is available, then click Return Control.',
      },
    },
    steps: [
      {
        type: 'navigate',
        id: 'open_x',
        description: 'Navigate to the X compose page',
        url: '{{x_url}}',
        waitUntil: 'domcontentloaded',
      },
      {
        type: 'human_takeover',
        id: 'x_login',
        reason: 'Authenticate to X/Twitter',
        instructions: '{{login_instructions}}',
      },
      {
        type: 'agent_task',
        id: 'draft_post',
        description: 'Draft the post but do not publish it yet',
        engine: 'browser-use',
        memorySection: 'x-draft',
        prompt: `You are on X/Twitter.

Your only goal is to prepare a post draft with the exact text below and stop before publishing:

{{post_text}}

Rules:
1. If a compose dialog or post editor is not open, open it.
2. Put the exact post text into the main composer textbox.
3. Verify the visible draft matches exactly.
4. DO NOT click the Post/Tweet button.
5. STOP with the draft visible and ready for the final publish step.`,
      },
      {
        type: 'agent_task',
        id: 'publish_post',
        description: 'Publish the drafted X post and wait for visible published-state evidence',
        engine: 'browser-use',
        memorySection: 'x-publish',
        prompt: `You are on X/Twitter with the exact post draft already visible in the composer.

Your goal is to complete the final publish action yourself and leave clear visible evidence of success.

Rules:
1. Click the Post/Tweet button exactly once.
2. Wait for the compose box to clear or close and for the published post, permalink, or other visible success evidence to appear.
3. If a confirmation toast or published post card is visible, leave it on screen.
4. Do not navigate away from the account timeline after publishing.
5. If the post does not publish successfully, say so clearly.

Return a concise description of what visible evidence confirms the post was published.`,
      },
      {
        type: 'human_takeover',
        id: 'confirm_post_visible',
        mode: 'confirm_completion',
        reason: 'Confirm that the final X post is visibly published',
        instructions: 'Review the visible X page. Confirm only if the agent completed the Post action and the published result is clearly visible.',
      },
      {
        type: 'extract',
        id: 'capture_post_result',
        description: 'Capture the resulting post URL or visible confirmation state',
        instruction: 'Extract the posted tweet URL if visible, plus any confirmation text, timestamp, or account handle shown on screen',
        outputKey: 'x_post_result',
      },
      {
        type: 'screenshot',
        id: 'x_post_screenshot',
        description: 'Capture the published post or confirmation state',
        outputKey: 'x_post_screenshot',
      },
    ],
  },
];
