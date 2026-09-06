# SevaSetu controlled demo portal

This is a local-only, fictional public-service portal for demonstrating Nudge. Every apparent personal value is deliberately fake.

Run it from the repository root:

```bash
pnpm demo:portal
```

Open `http://127.0.0.1:4173` in Chrome, then use the Nudge side panel.

Suggested flow:

1. Inspect the page and show the locally redacted fake PII in Nudge.
2. Ask Nudge to find a scholarship service. It will propose the search field.
3. Enter `Scholarship` in Nudge's **Text to enter locally** field and confirm. Reinspect: the entered text is now user-marked private and absent from outbound context.
4. Request and confirm the low-risk `Find service`, `Open scholarship tracker`, and `View application status` actions one at a time.
5. Open the restricted-step example, reinspect, and show that Nudge pauses at the visible OTP/MFA gate and form submit control.

The portal has no network API and stores nothing.
