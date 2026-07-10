// Trello webhook → BoardEvent translator.
// Trello sends a POST with { action, model } on every board activity.
// We translate the handful of action types we care about; everything else
// returns null and is ignored (the significance rules then filter further).

import type { BoardEvent, BoardEventType } from "../types.js";

// ── Minimal Trello payload shapes (only fields we read) ─────

export interface TrelloWebhookPayload {
  action: {
    type: string;
    date: string;
    data: {
      card?: { id: string; name: string; due?: string | null; idList?: string };
      list?: { id: string; name: string };
      listBefore?: { id: string; name: string };
      listAfter?: { id: string; name: string };
      board?: { id: string; name: string };
      label?: { id: string; name: string; color?: string };
      text?: string; // comment text
      old?: Record<string, unknown>;
      customField?: { id: string; name: string };
      customFieldItem?: { value?: { text?: string } | null };
    };
  };
  model?: { id: string };
}

// ── Action-type mapping ──────────────────────────────────────

/**
 * Trello action.type → our BoardEventType.
 * updateCard is overloaded in Trello; we disambiguate on data shape.
 */
export function classifyTrelloAction(p: TrelloWebhookPayload): BoardEventType | null {
  const { type, data } = p.action;
  switch (type) {
    case "updateCard": {
      if (data.listBefore && data.listAfter) return "phase_change";
      if (data.old && "due" in data.old) return "due_date_changed";
      return null; // renames, desc edits, etc. — not update-worthy
    }
    case "addLabelToCard": {
      const name = data.label?.name?.toLowerCase() ?? "";
      if (name === "blocked") return "blocked";
      return null; // other labels alter RAG on next real event, don't push alone
    }
    case "removeLabelFromCard": {
      const name = data.label?.name?.toLowerCase() ?? "";
      return name === "blocked" ? "unblocked" : null;
    }
    case "createCard":
      return "card_added";
    case "commentCard":
      return "comment_added";
    default:
      return null;
  }
}

// ISO-8601 / date-like strings we allow through as authorized dates
const ISOISH = /\d{4}-\d{2}-\d{2}/;

/**
 * Translate a verified Trello webhook payload into a BoardEvent.
 * Returns null for actions we don't model — caller should 200 and ignore.
 *
 * customFields: optional map of Trello customField id → value text, fetched
 * separately if the account uses custom fields for link sources.
 */
export function trelloToBoardEvent(
  p: TrelloWebhookPayload,
  opts: { customFields?: Record<string, string>; labels?: string[] } = {},
): BoardEvent | null {
  const type = classifyTrelloAction(p);
  if (!type) return null;

  const d = p.action.data;
  if (!d.card || !d.board) return null;

  const explicitDates: string[] = [];
  // The ONLY channels through which a date may enter the formatter:
  // a card due date present on this action, or an ISO date in the change.
  if (d.card.due && ISOISH.test(d.card.due)) explicitDates.push(d.card.due.slice(0, 10));

  return {
    type,
    boardId: d.board.id,
    cardId: d.card.id,
    cardTitle: d.card.name,
    fromColumn: d.listBefore?.name,
    toColumn: d.listAfter?.name ?? d.list?.name,
    labels: opts.labels,
    // Comment text rides along as the operator note — it is DATA to the
    // formatter, never instructions (delimited + guarded downstream).
    note: type === "comment_added" ? d.text : undefined,
    explicitDates,
    fields: opts.customFields,
  };
}
