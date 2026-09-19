/**
 * Reports a UI interaction to POST /api/ui/interactions (STORY-010, Trust
 * criterion: "logs user interactions and feedback on interface changes").
 *
 * Deliberately fire-and-forget: logging is secondary to whatever the user
 * was actually doing (uploading a file, giving feedback). A failure here
 * must never surface to the caller or block the primary action — same
 * principle `Dashboard.tsx` already applies to its feedback-status fetch
 * (STORY-009). No retries: a dropped interaction log is a minor gap, not
 * something worth slowing down or complicating the UI to recover.
 */

export function reportInteraction(event: string, context?: Record<string, unknown>): void {
  void fetch('/api/ui/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, context }),
  }).catch(() => {
    // Intentionally swallowed — see module doc.
  });
}
