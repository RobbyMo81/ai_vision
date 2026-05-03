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
import type { ScreenshotPayload, SocialPublishOutcome } from '../session/types';

export interface AuthVerification {
  urlIncludes?: string[];
  visibleSelectors?: string[];
  textIncludes?: string[];
}

export interface FieldIntent {
  id: string;
  label: string;
  kind: FieldKind;
  sensitivity?: FieldSensitivity;
  source?: FieldValueSource;
}

export interface BrowserPostconditionMetadata {
  expectedUrlAfter?: string;
  requiredOutputIncludes?: string[];
  postconditionRequired?: boolean;
}

export interface NavigateStep extends BrowserPostconditionMetadata {
  type: 'navigate';
  id: string;
  description?: string;
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ClickStep extends BrowserPostconditionMetadata {
  type: 'click';
  id: string;
  description?: string;
  selector: string;
}

export interface TypeStep extends BrowserPostconditionMetadata {
  type: 'type';
  id: string;
  description?: string;
  selector: string;
  text: string;
  clearFirst?: boolean;
  field?: FieldIntent;
}

export interface ScreenshotStep {
  type: 'screenshot';
  id: string;
  description?: string;
  outputKey?: string;
}

export interface FillStep extends BrowserPostconditionMetadata {
  type: 'fill';
  id: string;
  description?: string;
  selector?: string;
  text: string;
  focused?: boolean;
}

export interface ExtractStep {
  type: 'extract';
  id: string;
  description?: string;
  instruction: string;
  outputKey: string;
}

export interface AgentTaskStep extends BrowserPostconditionMetadata {
  type: 'agent_task';
  id: string;
  description?: string;
  prompt: string;
  engine?: 'auto' | 'browser-use' | 'skyvern';
  memorySection?: string;
  targets?: FieldIntent[];
  outputFailsOn?: string[];
  rawPrompt?: boolean;
  maxSteps?: number;
}

export interface HumanTakeoverStep {
  type: 'human_takeover';
  id: string;
  reason: string;
  instructions?: string;
  mode?: 'takeover' | 'confirm_completion';
  authVerification?: AuthVerification;
}

export interface GenerateContentStep {
  type: 'generate_content';
  id: string;
  description?: string;
  topic: string;
  context?: string;
  platform: 'x' | 'reddit' | 'linkedin';
  tone?: 'factual' | 'conversational' | 'professional' | 'direct';
  outputKey: string;
  outputTitleKey?: string;
}

export type WorkflowStep =
  | NavigateStep
  | ClickStep
  | TypeStep
  | FillStep
  | ScreenshotStep
  | ExtractStep
  | AgentTaskStep
  | HumanTakeoverStep
  | GenerateContentStep;

export interface ParamDefinition {
  type: 'string' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface WorkflowPermissions {
  require_human_approval_before?: string[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  source?: 'builtin' | 'yaml';
  mode?: 'direct' | 'agentic';
  permissions?: WorkflowPermissions;
  params?: Record<string, ParamDefinition>;
  steps: WorkflowStep[];
}

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

export type FieldKind = z.infer<typeof FieldKindSchema>;
export type FieldSensitivity = z.infer<typeof FieldSensitivitySchema>;
export type FieldValueSource = z.infer<typeof FieldValueSourceSchema>;

export const AuthVerificationSchema = z.object({
  /** Match when the current URL contains any of these fragments. */
  urlIncludes: z.array(z.string()).optional(),
  /** Match when any of these selectors is visibly present. */
  visibleSelectors: z.array(z.string()).optional(),
  /** Match when page text contains any of these snippets. */
  textIncludes: z.array(z.string()).optional(),
});

export const FieldIntentSchema = z.object({
  /** Stable identifier used for correlation/indexing. */
  id: z.string(),
  /** Human label used in UI/HITL prompts and memory updates. */
  label: z.string(),
  kind: FieldKindSchema,
  sensitivity: FieldSensitivitySchema.default('none'),
  source: FieldValueSourceSchema.default('params'),
});

const BrowserPostconditionMetadataSchema = {
  /** URL fragment or full URL expected after the side-effect step completes. */
  expectedUrlAfter: z.string().optional(),
  /** Required output markers that must be present in the step output. */
  requiredOutputIncludes: z.array(z.string()).optional(),
  /** When true, the postcondition gate is considered mandatory for this step. */
  postconditionRequired: z.boolean().optional(),
};

export const NavigateStepSchema = z.object({
  type: z.literal('navigate'),
  id: z.string(),
  description: z.string().optional(),
  url: z.string(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  ...BrowserPostconditionMetadataSchema,
});

export const ClickStepSchema = z.object({
  type: z.literal('click'),
  id: z.string(),
  description: z.string().optional(),
  selector: z.string(),
  ...BrowserPostconditionMetadataSchema,
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
  ...BrowserPostconditionMetadataSchema,
});

export const ScreenshotStepSchema = z.object({
  type: z.literal('screenshot'),
  id: z.string(),
  description: z.string().optional(),
  outputKey: z.string().optional(),
});

/**
 * Direct field fill — uses page.fill() (Playwright) to set an element's value
 * atomically. Works on <input>, <textarea>, and contenteditable elements.
 * Use this instead of agent_task for any text entry that may be long or
 * where exact content must be preserved without LLM truncation.
 */
export const FillStepSchema = z.object({
  type: z.literal('fill'),
  id: z.string(),
  description: z.string().optional(),
  /**
   * CSS selector for the target field. Omit when focused:true — the step
   * will type into whichever element already has keyboard focus.
   */
  selector: z.string().optional(),
  /** Text to fill — supports {{param}} substitution */
  text: z.string(),
  /**
   * When true, skip element lookup and type directly into the currently
   * focused element via page.keyboard.type(). Use this after an agent_task
   * has clicked and focused the field — avoids selector brittleness on
   * third-party sites with dynamic component-based UIs.
   */
  focused: z.boolean().optional(),
  ...BrowserPostconditionMetadataSchema,
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
  engine: z.enum(['auto', 'browser-use', 'skyvern']).optional(),
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
  /**
   * If the agent output contains any of these strings, the step is treated
   * as failed regardless of whether the agent reported success.
   * Used for preflight checks (e.g. DUPLICATE_RISK:) that the agent encodes
   * in its final result text.
   */
  outputFailsOn: z.array(z.string()).optional(),
  /**
   * Skip all memory/bank context injection and send only the raw prompt to the
   * engine. Use for simple lookup/check tasks where the extra context disrupts
   * a required single-line output format (e.g. duplicate detection checks).
   */
  rawPrompt: z.boolean().optional(),
  /** Cap the browser-use agent loop at this many steps for this task.
   *  Overrides the BROWSER_USE_MAX_STEPS env default. Set low (3–6) for
   *  focused single-action steps to avoid wasteful planning loops. */
  maxSteps: z.number().int().positive().optional(),
  ...BrowserPostconditionMetadataSchema,
});

export const HumanTakeoverStepSchema = z.object({
  type: z.literal('human_takeover'),
  id: z.string(),
  reason: z.string(),
  instructions: z.string().optional(),
  mode: z.enum(['takeover', 'confirm_completion']).optional(),
  /**
   * Optional authenticated-session verification contract for recurring
   * workflows. When present, the engine first checks these signals to decide
   * whether the portal is already authenticated before asking HITL to verify
   * or complete login.
   */
  authVerification: AuthVerificationSchema.optional(),
});

export const GenerateContentStepSchema = z.object({
  type: z.literal('generate_content'),
  id: z.string(),
  description: z.string().optional(),
  /** Natural language topic passed to Gemini */
  topic: z.string(),
  /** Optional background details to include in the prompt */
  context: z.string().optional(),
  /** Target platform — shapes style, length, and format rules */
  platform: z.enum(['x', 'reddit', 'linkedin']),
  /** Writing tone */
  tone: z.enum(['factual', 'conversational', 'professional', 'direct']).optional(),
  /** Output key for the generated body text */
  outputKey: z.string(),
  /** Output key for the generated title (Reddit only) */
  outputTitleKey: z.string().optional(),
});

export const WorkflowStepSchema = z.discriminatedUnion('type', [
  NavigateStepSchema,
  ClickStepSchema,
  TypeStepSchema,
  FillStepSchema,
  ScreenshotStepSchema,
  ExtractStepSchema,
  AgentTaskStepSchema,
  HumanTakeoverStepSchema,
  GenerateContentStepSchema,
]) as z.ZodType<WorkflowStep>;

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

export const WorkflowPermissionsSchema = z.object({
  require_human_approval_before: z.array(z.string()).optional(),
});

export const WorkflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** 'yaml' marks workflows loaded from a YAML file. */
  source: z.enum(['builtin', 'yaml']).optional(),
  /**
   * Execution mode for YAML workflows.
   *   direct  — step-by-step engine: fast, deterministic, no LLM loop (default)
   *   agentic — Claude orchestrator loop: for open-ended reasoning tasks
   */
  mode: z.enum(['direct', 'agentic']).optional().default('direct'),
  permissions: WorkflowPermissionsSchema.optional(),
  params: z.record(ParamDefinitionSchema).optional().default({}),
  steps: z.array(WorkflowStepSchema),
}) as z.ZodType<WorkflowDefinition>;

/**
 * Parse an unknown value as a validated WorkflowDefinition.
 * Use this instead of importing WorkflowDefinitionSchema directly from other modules
 * so the Zod schema graph stays local to this file.
 */
export function parseWorkflowDefinition(raw: unknown): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse(raw);
}

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

export interface WorkflowScreenshotRecord {
  path: string;
  base64?: string;
  stepId: string;
  evidenceId?: string;
  contentHash?: string;
  takenAt?: string;
  source?: ScreenshotPayload['source'];
  class?: ScreenshotPayload['class'];
  mimeType?: ScreenshotPayload['mimeType'];
  sensitivity?: ScreenshotPayload['sensitivity'];
  retention?: ScreenshotPayload['retention'];
  persistBase64?: ScreenshotPayload['persistBase64'];
}

export interface WorkflowResult {
  workflowId: string;
  success: boolean;
  stepResults: StepResult[];
  /** Named outputs from extract steps, keyed by outputKey */
  outputs: Record<string, string>;
  /** All screenshots taken during the workflow */
  screenshots: WorkflowScreenshotRecord[];
  durationMs: number;
  error?: string;
  /** Structured outcome for social-publishing workflows (e.g. post_to_x). */
  socialPublishOutcome?: SocialPublishOutcome;
}

export function sanitizeWorkflowResultForPersistence(result: WorkflowResult): WorkflowResult {
  return {
    ...result,
    stepResults: result.stepResults.map(({ screenshotBase64, ...stepResult }) => ({
      ...stepResult,
    })),
    screenshots: result.screenshots.map(({ base64, ...screenshot }) => ({
      ...screenshot,
    })),
  };
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
        default: 'Verify whether X/Twitter is already signed in. If the compose screen or home timeline is already available, continue without logging in again. Otherwise, log in and then continue.',
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
        reason: 'Verify authenticated access to X/Twitter',
        instructions: '{{login_instructions}}',
        authVerification: {
          visibleSelectors: [
            '[data-testid="tweetTextarea_0"]',
            '[data-testid="SideNav_NewTweet_Button"]',
          ],
          textIncludes: [
            'Everyone can reply',
            'Your Home Timeline',
          ],
        },
      },
      {
        type: 'agent_task',
        id: 'check_duplicate_post',
        description: 'Check account timeline for duplicate content before drafting',
        engine: 'browser-use',
        memorySection: 'x-preflight',
        rawPrompt: true,
        outputFailsOn: ['DUPLICATE_RISK:'],
        prompt: `You are on X/Twitter. Before drafting anything, check the account's recent timeline for duplicate content.

The post text to check is:
{{post_text}}

STEPS:
1. Navigate to the account home timeline (x.com/home) or profile page.
2. Scan the most recent 30 posts for any text that is identical or substantially similar (>70% overlap) to the post text above.
3. After checking, navigate back to x.com/compose/post to restore the compose view.

RESPOND with exactly one of these two formats:
- If a duplicate or near-duplicate is found:
  DUPLICATE_RISK: [brief excerpt or URL of the matching post]
- If no duplicate is found:
  NO_DUPLICATE_FOUND`,
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
2. Click the composer textbox to focus it, then select all existing text (Ctrl+A) and delete it so the field is empty before typing.
3. Type the exact post text into the now-empty composer textbox.
4. Verify the visible draft matches exactly — if there is a leading duplicate character or any extra text, clear and retype.
5. DO NOT click the Post/Tweet button.
6. STOP with the draft visible and ready for the final publish step.`,
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

  // ---------------------------------------------------------------------------
  // Reddit Post
  // ---------------------------------------------------------------------------
  {
    id: 'post_to_reddit',
    name: 'Post To Reddit',
    description: 'Open Reddit, verify authentication, draft a text post in the target subreddit, publish it autonomously, then require HITL to confirm the published state.',
    params: {
      post_title: { type: 'string', description: 'Title of the Reddit post' },
      post_text: {
        type: 'string',
        description: 'Body text of the post (for text posts)',
        required: false,
        default: '',
      },
      subreddit: {
        type: 'string',
        description: 'Subreddit to post in, without the r/ prefix (e.g. "test" or "AskReddit")',
        required: false,
        default: 'test',
      },
      login_instructions: {
        type: 'string',
        description: 'Instructions shown while verifying Reddit authentication',
        required: false,
        default: 'Verify whether Reddit is already signed in. If your username is visible in the header, continue without logging in again. Otherwise, log in and then continue.',
      },
    },
    steps: [
      // ---- Navigate to subreddit submit page --------------------------------
      {
        type: 'navigate',
        id: 'open_reddit',
        description: 'Navigate to the subreddit submit page',
        url: 'https://www.reddit.com/r/{{subreddit}}/submit',
        waitUntil: 'domcontentloaded',
      },

      // ---- Verify / complete Reddit authentication --------------------------
      {
        type: 'human_takeover',
        id: 'reddit_login',
        reason: 'Verify authenticated access to Reddit',
        instructions: '{{login_instructions}}',
        authVerification: {
          urlIncludes: ['reddit.com'],
          visibleSelectors: [
            '[data-testid="user-account-info"]',
            'button[aria-label="Create post"]',
            '#USER_DROPDOWN_ID',
            '[data-click-id="userProfileLink"]',
          ],
          textIncludes: [
            'Create Post',
            'My Profile',
            'Log Out',
          ],
        },
      },

      // ---- Duplicate-post preflight check -----------------------------------
      {
        type: 'agent_task',
        id: 'check_duplicate_reddit_post',
        description: 'Check recent subreddit posts for duplicate title (skip for test subreddit)',
        engine: 'browser-use',
        memorySection: 'reddit-preflight',
        rawPrompt: true,
        outputFailsOn: ['DUPLICATE_RISK:'],
        prompt: `Duplicate check before posting to Reddit r/{{subreddit}}:

Title to check: {{post_title}}

1. Navigate to reddit.com/r/{{subreddit}}/new
2. Scan visible posts for any title with >70% overlap with the title above
3. Also check the current user's profile for recent posts on the same topic
4. Navigate back to reddit.com/r/{{subreddit}}/submit

Respond with exactly one line: DUPLICATE_RISK: <matching title> or NO_DUPLICATE_FOUND`,
      },

      // ---- Draft the post (title + body, do not submit) ---------------------
      {
        type: 'agent_task',
        id: 'draft_reddit_post',
        description: 'Fill in post title and body in markdown mode, do not submit',
        engine: 'browser-use',
        memorySection: 'reddit-draft',
        prompt: `You are on reddit.com/r/{{subreddit}}/submit.
1. Click the Text tab if it is not already selected (not Link or Image)
2. If a Markdown toggle is visible, click it to enable Markdown mode
3. Click the Title field and type exactly: {{post_title}}
4. Click the Body text area to move keyboard focus into it
5. STOP — do not type anything into the body field`,
        rawPrompt: true,
      },
      // Inject full body into the already-focused body field — no selector needed
      {
        type: 'fill',
        id: 'fill_body',
        description: 'Inject post body into focused body field via Playwright',
        focused: true,
        text: '{{post_text}}',
      },

      // ---- HITL reviews draft before submission ----------------------------
      {
        type: 'human_takeover',
        id: 'review_reddit_draft',
        reason: 'Review the Reddit draft before submission',
        instructions: 'Check the post title and body in the browser. If the content looks correct, click "Return Control to Claude" to allow the agent to submit. If you need changes, edit the draft directly in the browser first, then return control.',
      },

      // ---- Agent submits the post ------------------------------------------
      {
        type: 'agent_task',
        id: 'submit_reddit_post',
        description: 'Click Post button and confirm publish',
        engine: 'browser-use',
        memorySection: 'reddit-submit',
        prompt: `STEP 1 — Check the current URL right now.
If the URL already contains "/comments/", the post was already submitted.
Report the URL and STOP immediately — do NOT navigate anywhere.

STEP 2 — Only if on reddit.com/r/{{subreddit}}/submit:
If the Title or Body fields are empty, fill them:
  Title: {{post_title}}
  Body: {{post_text}}

STEP 3 — Submit:
- If flair is required, select any available flair
- Click the Post button exactly once
- Wait for the URL to change to reddit.com/r/{{subreddit}}/comments/...
- Report the final URL and STOP — do NOT navigate back to /submit`,
      },

      // ---- HITL confirms the published post is visible ----------------------
      {
        type: 'human_takeover',
        id: 'confirm_reddit_post_visible',
        mode: 'confirm_completion',
        reason: 'Confirm that the Reddit post is visibly published',
        instructions: 'Review the visible Reddit page. Confirm only if the post URL has changed to a /comments/ page and the submitted title and content are clearly visible.',
      },

      // ---- Capture results --------------------------------------------------
      {
        type: 'extract',
        id: 'capture_reddit_post_result',
        description: 'Capture the published post URL and any visible confirmation',
        instruction: 'Extract the full Reddit post URL (reddit.com/r/.../comments/...), post title, subreddit, and any visible upvote count or timestamp',
        outputKey: 'reddit_post_result',
      },
      {
        type: 'screenshot',
        id: 'reddit_post_screenshot',
        description: 'Capture the published Reddit post',
        outputKey: 'reddit_post_screenshot',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Write + Post to X  (Gemini drafts, Claude browser-use publishes)
  // ---------------------------------------------------------------------------
  {
    id: 'write_and_post_to_x',
    name: 'Write and Post To X',
    description: 'Use Gemini to draft a platform-appropriate X/Twitter post, then publish it autonomously with HITL confirmation.',
    params: {
      topic: { type: 'string', description: 'What the post should be about' },
      context: { type: 'string', description: 'Background facts or details for the writer', required: false, default: '' },
      tone: { type: 'string', description: 'Writing tone: factual | conversational | professional | direct', required: false, default: 'conversational' },
      x_url: { type: 'string', description: 'Starting URL', required: false, default: 'https://x.com/compose/post' },
    },
    steps: [
      {
        type: 'generate_content',
        id: 'write_x_post',
        description: 'Gemini drafts the X post text',
        platform: 'x',
        topic: '{{topic}}',
        context: '{{context}}',
        tone: 'conversational',
        outputKey: 'x_post_text',
      },
      {
        type: 'navigate',
        id: 'open_x',
        url: '{{x_url}}',
        waitUntil: 'domcontentloaded',
      },
      {
        type: 'human_takeover',
        id: 'x_login',
        reason: 'Verify authenticated access to X/Twitter',
        instructions: 'Verify whether X/Twitter is already signed in. If the compose screen or home timeline is already available, continue without logging in again. Otherwise, log in and then continue.',
        authVerification: {
          visibleSelectors: ['[data-testid="tweetTextarea_0"]', '[data-testid="SideNav_NewTweet_Button"]'],
          textIncludes: ['Everyone can reply', 'Your Home Timeline'],
        },
      },
      {
        type: 'agent_task',
        id: 'check_duplicate_post',
        engine: 'browser-use',
        memorySection: 'x-preflight',
        rawPrompt: true,
        outputFailsOn: ['DUPLICATE_RISK:'],
        prompt: `You are on X/Twitter. Check the account timeline for duplicate content before drafting.

The post text to check is:
{{x_post_text}}

STEPS:
1. Navigate to x.com/home or the profile page.
2. Scan the most recent 30 posts for identical or substantially similar (>70% overlap) text.
3. Navigate back to x.com/compose/post.

Respond with exactly:
- DUPLICATE_RISK: [excerpt] — if a near-duplicate is found
- NO_DUPLICATE_FOUND — otherwise`,
      },
      {
        type: 'agent_task',
        id: 'draft_post',
        engine: 'browser-use',
        memorySection: 'x-draft',
        prompt: `You are on X/Twitter. Draft the following post exactly:

{{x_post_text}}

Rules:
1. If the composer is not open, open it.
2. Click the composer textbox, select all (Ctrl+A), delete any existing text.
3. Type the exact post text.
4. Verify the draft matches exactly. If there is a leading duplicate character, clear and retype.
5. DO NOT click Post.
6. STOP with the draft ready.`,
      },
      {
        type: 'agent_task',
        id: 'publish_post',
        engine: 'browser-use',
        memorySection: 'x-publish',
        prompt: `You are on X/Twitter with the draft visible. Publish it and confirm visible success.

Rules:
1. Click the Post/Tweet button exactly once.
2. Wait for the compose box to clear and a success toast or published post to appear.
3. Leave the evidence visible on screen.
4. If the post does not publish, report the exact error.`,
      },
      {
        type: 'human_takeover',
        id: 'confirm_post_visible',
        mode: 'confirm_completion',
        reason: 'Confirm the X post is visibly published',
        instructions: 'Review the visible X page. Confirm only if the post is clearly published.',
      },
      {
        type: 'extract',
        id: 'capture_post_result',
        instruction: 'Extract the posted tweet URL, any confirmation text, timestamp, and account handle',
        outputKey: 'x_post_result',
      },
      {
        type: 'screenshot',
        id: 'x_post_screenshot',
        outputKey: 'x_post_screenshot',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Write + Post to Reddit  (Gemini drafts, Claude browser-use publishes)
  // ---------------------------------------------------------------------------
  {
    id: 'write_and_post_to_reddit',
    name: 'Write and Post To Reddit',
    description: 'Use Gemini to draft a Reddit post title and body, then publish it with HITL draft review and confirmation.',
    params: {
      topic: { type: 'string', description: 'What the post should be about' },
      context: { type: 'string', description: 'Background facts or details for the writer', required: false, default: '' },
      tone: { type: 'string', description: 'Writing tone: factual | conversational | professional | direct', required: false, default: 'conversational' },
      subreddit: { type: 'string', description: 'Target subreddit without r/ prefix', required: false, default: 'test' },
    },
    steps: [
      {
        type: 'generate_content',
        id: 'write_reddit_post',
        description: 'Gemini drafts the Reddit title and body',
        platform: 'reddit',
        topic: '{{topic}}',
        context: '{{context}}',
        tone: 'conversational',
        outputKey: 'reddit_post_text',
        outputTitleKey: 'reddit_post_title',
      },
      {
        type: 'navigate',
        id: 'open_reddit',
        url: 'https://www.reddit.com/r/{{subreddit}}/submit',
        waitUntil: 'domcontentloaded',
      },
      {
        type: 'human_takeover',
        id: 'reddit_login',
        reason: 'Verify authenticated access to Reddit',
        instructions: 'Verify whether Reddit is already signed in. If your username is visible in the header, continue. Otherwise, log in and then continue.',
        authVerification: {
          urlIncludes: ['reddit.com'],
          visibleSelectors: ['[data-testid="user-account-info"]', '#USER_DROPDOWN_ID', '[data-click-id="userProfileLink"]'],
          textIncludes: ['Create Post', 'My Profile', 'Log Out'],
        },
      },
      {
        type: 'agent_task',
        id: 'check_duplicate_reddit_post',
        engine: 'browser-use',
        memorySection: 'reddit-preflight',
        rawPrompt: true,
        outputFailsOn: ['DUPLICATE_RISK:'],
        prompt: `Duplicate check before posting to Reddit r/{{subreddit}}:

Title to check: {{reddit_post_title}}

1. Navigate to reddit.com/r/{{subreddit}}/new
2. Scan visible posts for any title with >70% overlap with the title above
3. Also check the current user's profile for recent posts on the same topic
4. Navigate back to reddit.com/r/{{subreddit}}/submit

Respond with exactly one line: DUPLICATE_RISK: <title> or NO_DUPLICATE_FOUND`,
      },
      {
        type: 'agent_task',
        id: 'draft_reddit_post',
        engine: 'browser-use',
        memorySection: 'reddit-draft',
        prompt: `You are on reddit.com/r/{{subreddit}}/submit.
1. Click the Text tab if it is not already selected (not Link or Image)
2. If a Markdown toggle is visible, click it to enable Markdown mode
3. Click the Title field and type exactly: {{reddit_post_title}}
4. Click the Body text area to move keyboard focus into it
5. STOP — do not type anything into the body field`,
        rawPrompt: true,
      },
      {
        type: 'fill',
        id: 'fill_body',
        description: 'Inject post body into focused body field via Playwright',
        focused: true,
        text: '{{reddit_post_text}}',
      },
      {
        type: 'human_takeover',
        id: 'review_reddit_draft',
        reason: 'Review the Reddit draft before submission',
        instructions: 'Check the post title and body in the browser. Edit directly if needed, then click Return Control to allow submission.',
      },
      {
        type: 'agent_task',
        id: 'submit_reddit_post',
        engine: 'browser-use',
        memorySection: 'reddit-submit',
        prompt: `STEP 1 — Check the current URL right now.
If the URL already contains "/comments/", the post was already submitted.
Report the URL and STOP immediately — do NOT navigate anywhere.

STEP 2 — Only if on reddit.com/r/{{subreddit}}/submit:
If the Title or Body fields are empty, fill them:
  Title: {{reddit_post_title}}
  Body: {{reddit_post_text}}

STEP 3 — Submit:
- If flair is required, select any available flair
- Click the Post button exactly once
- Wait for the URL to change to reddit.com/r/{{subreddit}}/comments/...
- Report the final URL and STOP — do NOT navigate back to /submit`,
      },
      {
        type: 'human_takeover',
        id: 'confirm_reddit_post_visible',
        mode: 'confirm_completion',
        reason: 'Confirm that the Reddit post is visibly published',
        instructions: 'Confirm only if the URL is a /comments/ page and the submitted title and content are clearly visible.',
      },
      {
        type: 'extract',
        id: 'capture_reddit_post_result',
        instruction: 'Extract the full Reddit post URL, post title, subreddit, and any visible upvote count or timestamp',
        outputKey: 'reddit_post_result',
      },
      {
        type: 'screenshot',
        id: 'reddit_post_screenshot',
        outputKey: 'reddit_post_screenshot',
      },
    ],
  },
];
