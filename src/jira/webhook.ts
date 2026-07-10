// Jira Cloud webhook → BoardEvent translator + handler.
//
// Jira sends { webhookEvent, issue, changelog?, comment? }. We translate:
//   jira:issue_updated + changelog status item → phase_change
//   jira:issue_updated + changelog duedate item → due_date_changed
//   comment_created → comment_added
//   status name containing "blocked" → blocked / leaving it → unblocked
// boardId = project key, cardId = issue key. Status NAMES are the "columns"
// and flow through the same columnToPhase mapping rules as Trello lists.
//
// Auth: Jira Cloud system webhooks don't sign payloads. We use a
// secret-in-path scheme (/webhooks/jira/{secret}) with a constant-time
// compare. If you register via Jira Automation instead, you can also send
// an X-StatusPass-Secret header; either satisfies the check.

import { timingSafeEqual } from "node:crypto";
import type { BoardEvent, ModelClient, ModelRouting } from "../types.js";
import type { PipelineDeps, PipelineOutcome } from "../pipeline.js";
import { handleBoardEvent } from "../pipeline.js";

export interface JiraWebhookPayload {
  webhookEvent: string;
  issue?: {
    key: string;
    fields?: {
      summary?: string;
      duedate?: string | null;   // "2026-08-01"
      labels?: string[];
      project?: { key: string };
      status?: { name: string };
    };
  };
  changelog?: { items?: Array<{ field: string; fromString?: string | null; toString?: string | null }> };
  comment?: { body?: string };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const isBlockedName = (s: string | null | undefined) => !!s && /blocked/i.test(s);

export function jiraToBoardEvent(p: JiraWebhookPayload): BoardEvent | null {
  const issue = p.issue;
  const projectKey = issue?.fields?.project?.key;
  if (!issue || !projectKey) return null;

  const base = {
    boardId: projectKey,
    cardId: issue.key,
    cardTitle: issue.fields?.summary ?? issue.key,
    labels: issue.fields?.labels,
    explicitDates: [] as string[],
  };
  // A due date on the issue is an authorized date channel, same as Trello.
  if (issue.fields?.duedate && ISO_DATE.test(issue.fields.duedate)) {
    base.explicitDates.push(issue.fields.duedate.slice(0, 10));
  }

  if (p.webhookEvent === "comment_created") {
    return { ...base, type: "comment_added", note: p.comment?.body };
  }

  if (p.webhookEvent === "jira:issue_updated") {
    const items = p.changelog?.items ?? [];
    const status = items.find((i) => i.field.toLowerCase() === "status");
    if (status) {
      // Entering/leaving a "Blocked"-named status maps to blocked/unblocked;
      // any other transition is a phase_change through the mapping rules.
      const type: BoardEvent["type"] = isBlockedName(status.toString)
        ? "blocked"
        : isBlockedName(status.fromString) ? "unblocked" : "phase_change";
      return {
        ...base, type,
        fromColumn: status.fromString ?? undefined,
        toColumn: status.toString ?? undefined,
      };
    }
    const due = items.find((i) => i.field.toLowerCase() === "duedate");
    if (due) {
      if (due.toString && ISO_DATE.test(due.toString)) {
        if (!base.explicitDates.includes(due.toString.slice(0, 10))) {
          base.explicitDates.push(due.toString.slice(0, 10));
        }
      }
      return { ...base, type: "due_date_changed" };
    }
    return null; // description edits, assignee changes, etc.
  }

  return null;
}

function secretMatches(candidate: string | undefined, secret: string): boolean {
  if (!candidate || !secret) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleJiraWebhook(
  req: { method: string; rawBody: string; pathSecret: string | undefined; headerSecret: string | undefined },
  config: { webhookSecret: string },
  deps: PipelineDeps,
  model: { client: ModelClient; routing: ModelRouting },
): Promise<{ status: number; body: string; outcome?: PipelineOutcome }> {
  if (req.method !== "POST") return { status: 405, body: "method not allowed" };
  if (!secretMatches(req.pathSecret, config.webhookSecret) &&
      !secretMatches(req.headerSecret, config.webhookSecret)) {
    return { status: 401, body: "bad secret" };
  }

  let payload: JiraWebhookPayload;
  try {
    payload = JSON.parse(req.rawBody);
  } catch {
    return { status: 400, body: "bad json" };
  }

  const event = jiraToBoardEvent(payload);
  if (!event) return { status: 200, body: "ignored" }; // always 2xx noise

  const outcome = await handleBoardEvent(event, deps, model);
  return { status: 200, body: outcome.action, outcome };
}
