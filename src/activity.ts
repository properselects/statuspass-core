// Activity log — in-memory ring buffer, keyed by scope ("demo" | accountId).
// Restarts wipe it; production would back this with Supabase.

export type ActivityEvent = {
  at: string;
  scope: string;
  passId?: string;
  passLabel?: string;
  kind: "phase_move" | "custom_push" | "pass_issued" | "deliverable_added" | "deliverable_removed" | "manual_update" | "notification";
  actor?: string;
  summary: string;
  detail?: string;
};

const ACTIVITY_MAX = 200;

export function logActivity(ev: Omit<ActivityEvent, "at">) {
  const bucket = ((globalThis as any).__spActivity ??= new Map<string, ActivityEvent[]>());
  const list = bucket.get(ev.scope) ?? [];
  list.unshift({ ...ev, at: new Date().toISOString() });
  if (list.length > ACTIVITY_MAX) list.length = ACTIVITY_MAX;
  bucket.set(ev.scope, list);
}

export function getActivity(scope: string, limit = 50): ActivityEvent[] {
  const bucket = (globalThis as any).__spActivity as Map<string, ActivityEvent[]> | undefined;
  return (bucket?.get(scope) ?? []).slice(0, limit);
}
