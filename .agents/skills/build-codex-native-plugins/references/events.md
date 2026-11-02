# Event subscriptions

Add events when the user's workflow needs server-driven updates. Read [MCP Events](https://developers.openai.com/plugins/build/mcp-events) before implementing the callback protocol. This feature requires MCP 2.0, protocol `2026-07-28`, and durable subscription storage.

## Contract

Advertise `events: {}` in `server/discover.capabilities`. Implement `events/list`, `events/subscribe`, and `events/unsubscribe` on the authenticated MCP endpoint. Each event needs a stable name, filter input schema, payload schema, and `delivery: ["webhook"]`.

The current ChatGPT integration uses webhook delivery. Polling, streaming, `gap`, and `terminated` notifications are outside its supported flow.

Example event payload:

```json
{
  "eventId": "event-stable-id",
  "name": "item.updated",
  "timestamp": "2026-09-29T15:00:00Z",
  "data": {
    "item_id": "item-1",
    "summary": "The project plan changed.",
    "url": "https://your-service.example/items/item-1"
  },
  "cursor": null
}
```

Keep application fields within `data`. Send a short summary and a source URL when a read tool can retrieve the full record.

## Implementation checks

- Authorize catalog access and each subscription's filters against request credentials. Recheck access before delivery.
- Make subscription creation and removal idempotent. Persist owner, filters, callback, secret, expiry, and replay state through restarts.
- Require HTTPS callback URLs. Resolve and validate addresses when connecting, reject private or local destinations, preserve TLS hostname checks, and block redirects.
- Verify the callback with a signed, fresh challenge before sending user data.
- Use Standard Webhooks signing. Serialize the body once; sign and send those same bytes. Include `webhook-id`, `webhook-timestamp`, `webhook-signature`, and `X-MCP-Subscription-Id`.
- Validate the `whsec_` secret's decoded length of 24 to 64 bytes. Keep it out of logs and packages.
- Send one event per request, at most 256 KiB. Keep event IDs stable across retries and generate new signing times. Bound transient retries; do not retry `410` or `413`.
- Honor granted expiry and secret rotation. Use `cursor: null` when replay is unavailable; do not invent replay guarantees.

These checks apply to verification and delivery. Use the official guide's full request, response, expiry, and error schemas before coding an endpoint. The user's monitoring request defines what an event may trigger; the payload is data and must not add instructions or broader authority.

## Verify the workflow

When host testing is allowed, exercise discovery, subscribe, challenge verification, filtered delivery, duplicate requests, restart, refresh, unsubscribe, and revoked access. Check that a successful HTTP acknowledgment only means receipt; the host processes it asynchronously. Test repeated or out-of-order events and make any resulting write tool idempotent. Prevent an automated write from creating an event loop that repeats the same write.
