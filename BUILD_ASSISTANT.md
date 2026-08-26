# Build Assistant: Conversational Coding Orchestrator

## 1. Your role

You are the lead engineer responsible for building this project.

Inspect the existing repository before changing anything. If the repository is empty, initialize the architecture described below. If it already contains a clean implementation, integrate with it rather than rewriting working code.

Work incrementally. Complete one phase at a time, run its acceptance checks, and leave the repository in a working state after every phase.

Do not:

- Push code
- Merge branches
- Deploy
- Publish packages
- Create paid external resources
- Access production systems
- Access unrelated repositories
- Read the user's home directory
- Read SSH-agent sockets
- read browser profiles, cookies, or password stores
- expose provider credentials to the frontend
- claim that tests passed unless they were actually executed

When information is missing, make the safest reasonable implementation assumption, document it in `docs/assumptions.md`, and continue.

## 2. Product objective

Build a personal conversational assistant that:

1. Accepts text and push-to-talk voice input.
2. Supports Cantonese, English, and Cantonese-English mixed speech.
3. Transcribes speech locally.
4. Streams conversational text responses.
5. Speaks short responses using an installed device voice.
6. Lets the user stop speech immediately.
7. Helps the user brainstorm and define coding tasks.
8. Delegates repository work to OpenCode or Claude Code.
9. Continues chatting while coding jobs run.
10. Shows coding-job status and safe progress events.
11. Requests approval before consequential actions.
12. Runs deterministic verification before reporting success.
13. Stores editable user preferences and project decisions.
14. Keeps raw microphone audio local and does not retain it by default.
15. Minimizes subscription and model costs.

The conversational assistant is not the coding agent.

The conversational assistant must:

- Understand the request
- Help refine the objective
- Build a structured coding brief
- Start an approved coding job
- Monitor the coding backend
- Explain progress
- Present validation evidence and diffs

OpenCode or Claude Code must perform repository exploration, editing, command execution, test execution, and code-agent reasoning.

## 3. Implementation principles

### 3.1 Local-first voice

Keep these local:

- Microphone capture
- Speech segmentation
- Speech-to-text
- Device text-to-speech
- Conversation database
- Job state
- Approval records
- Source-code worktrees
- Safe execution logs

Raw audio must not be retained by default.

### 3.2 Cloud coding is allowed

OpenCode and Claude Code may use their configured providers.

Do not build or host a local coding LLM.

The conversational-model adapter must remain provider-neutral. It may use a configurable low-cost cloud model for conversation, routing, brief creation, and concise job summaries.

### 3.3 Deterministic safety

The language model cannot grant permissions to itself.

All operating-system actions must pass through typed services and deterministic policy checks.

Do not expose unrestricted shell access to the conversational model.

### 3.4 Responsive conversation

The user must be able to:

- Send another chat message while a coding job runs
- Ask for job status
- Stop speech
- Cancel a coding job
- Send an additional instruction to a running job
- Approve or reject a requested action
- Review the final diff and validation evidence

## 4. Initial architecture

Use a TypeScript monorepo.

Preferred structure:

assistant/
  apps/
    web/
      src/
        app/
        components/
        features/
          chat/
          voice/
          jobs/
          approvals/
          memory/
    api/
      src/
        conversations/
        events/
        jobs/
        approvals/
        memory/
        configuration/
  packages/
    shared/
    orchestrator/
    model-router/
    policy-engine/
    privacy-gateway/
    opencode-client/
    claude-code-client/
    speech-client/
    verifier/
  workers/
    coding/
    verifier/
  services/
    speech/
  infrastructure/
    docker/
    postgres/
    redis/
  docs/
  compose.yaml
  package.json
  pnpm-workspace.yaml

Use:

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- Accessible semantic controls
- Server-Sent Events for text and job events
- Web Audio APIs for microphone capture
- Browser SpeechSynthesis as the initial TTS implementation

Backend:
- Node.js
- TypeScript
- Fastify
- Zod
- PostgreSQL
- Redis
- BullMQ

Speech service:
- Python
- FastAPI
- A SenseVoiceSmall adapter
- Push-to-talk audio ingestion
- No permanent raw-audio storage

Coding backends:
- OpenCode TypeScript SDK or local OpenCode server as primary
- Claude Code integration as secondary
- A shared coding-backend interface

Testing:
- Vitest for TypeScript unit tests
- Playwright for essential UI flows
- Pytest for the speech service
- Repository-specific validation for coding jobs

Do not add infrastructure that is not needed by the current implementation phase.

## 5. Required domain types

Define shared Zod schemas and TypeScript types for:

- Conversation
- ConversationMessage
- ConversationSummary
- UserPreference
- Project
- ProjectMemory
- CodingJob
- CodingBrief
- JobEvent
- ApprovalRequest
- ApprovalDecision
- ValidationResult
- CodingBackend
- SpeechTranscript
- AssistantGeneration

### CodingBrief

Include at least:

- jobId
- title
- objective
- projectId
- repositoryPath
- allowedPaths
- forbiddenPaths
- requirements
- acceptanceCriteria
- validationCommands
- forbiddenActions
- privacyLevel
- requestedBackend
- costLimit
- createdAt

### JobEvent

Include:

- id
- jobId
- type
- stage
- safeMessage
- progress, if known
- createdAt
- metadata containing only sanitized information

Do not expose hidden model reasoning or raw chain-of-thought.

### ApprovalRequest

Include:

- id
- jobId
- requestedAction
- reason
- target
- command or operation preview
- data leaving the machine
- potential effects
- expiresAt
- createdAt

## 6. Coding-backend interface

Create one interface implemented by both OpenCode and Claude Code adapters.

Conceptual contract:

```typescript
interface CodingBackend {
  readonly id: "opencode" | "claude-code";

  checkAvailability(): Promise<BackendAvailability>;

  startJob(input: CodingJobInput): Promise<CodingSession>;

  sendInstruction(
    sessionId: string,
    instruction: string
  ): Promise<void>;

  cancelJob(sessionId: string): Promise<void>;

  getStatus(sessionId: string): Promise<CodingBackendStatus>;

  subscribe(
    sessionId: string,
    signal: AbortSignal
  ): AsyncIterable<CodingBackendEvent>;

  dispose(sessionId: string): Promise<void>;
}
