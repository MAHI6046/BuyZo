# DOT Production Go-Live Checklist

Use this checklist before enabling full production traffic.

## 1. Environment & Secrets

- [ ] `POSTGRES_URL` is production DB and reachable from backend.
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` are set.
- [ ] `APP_CLIENT_KEY` is set and rotated from staging values.
- [ ] `ADMIN_PORTAL_API_KEY` is set and shared only with admin portal.
- [ ] Firebase Admin credentials are configured in backend runtime.
- [ ] `ENFORCE_APP_CHECK=true` is enabled for production.
- [ ] `MARKETING_SITE_URL`, app store URLs, and deep-link scheme are correct.

## 2. Database & Schema

- [ ] Latest schema migration applied successfully.
- [ ] `orders.payment_method` exists and is populated for new orders.
- [ ] `order_credit_reservations` table exists with `expires_at`.
- [ ] `stripe_webhook_events` table exists for webhook idempotency.
- [ ] Indexes created:
  - [ ] `idx_order_credit_reservations_user_status`
  - [ ] `idx_order_credit_reservations_intent_status`
  - [ ] `idx_order_credit_reservations_status_expires`

## 3. Payments & Credits Flows

- [ ] Zero-pay (`total_amount = 0`) order flow skips Stripe and marks paid.
- [ ] Mixed payment flow reserves credits before Stripe intent creation.
- [ ] Stripe success finalizes reservation and posts `used` ledger.
- [ ] Stripe failed/canceled releases reservation.
- [ ] Available credits calculation excludes expired reservations:
  - [ ] `earned - used - pending(unexpired)`
- [ ] Promo usage and credit usage are idempotent per order/source.

## 4. Webhooks & Reconciliation

- [ ] Stripe webhook endpoint is reachable and signature validation works.
- [ ] Duplicate webhook deliveries do not double-apply (idempotent by `event_id`).
- [ ] Reconciliation script runs successfully in production:
  - [ ] `npm run stripe:reconcile --prefix backend`
- [ ] Reconciliation output is captured in logs/monitoring.
- [ ] Manual test done:
  - [ ] succeeded intent mismatch fixed by reconciliation
  - [ ] canceled/requires_payment_method stale reservations released

## 5. Monitoring & Admin Visibility

- [ ] `/api/admin/wallet-health` is accessible from admin portal backend key.
- [ ] Dashboard shows:
  - [ ] pending reservations
  - [ ] expired unreleased reservations
  - [ ] avg pending age
  - [ ] stuck intents (>20 min)
  - [ ] webhook event counters
- [ ] Alert thresholds defined (even if manual initially).

## 6. Driver & Order Ops

- [ ] Driver pickup checklist works (at least one item required).
- [ ] `Out for Delivery` allowed only after `Picked`.
- [ ] Delivery PIN required and validated at `Delivered`.
- [ ] Missing items credits are issued only after successful delivery.

## 7. Security & Access

- [ ] Admin endpoints protected by `x-admin-portal-key`.
- [ ] Non-admin API requires `x-app-client-key`.
- [ ] CORS policy validated for production domains only.
- [ ] No secrets committed in repo.

## 8. Performance & Reliability

- [ ] DB connection pool limits are appropriate for traffic.
- [ ] Cache invalidation paths validated for orders/products.
- [ ] Error rate and latency baselines captured after smoke test.

## 9. Backup & Rollback

- [ ] Production DB backup snapshot verified.
- [ ] Rollback plan documented (previous Vercel deploy + DB rollback strategy).
- [ ] On-call owner assigned for launch window.

## 10. Final Smoke Test

- [ ] Customer checkout with Stripe payment.
- [ ] Customer checkout fully covered by credits ($0 payable).
- [ ] Mixed credits + Stripe checkout.
- [ ] Driver status updates end-to-end.
- [ ] Admin pricing/promos updates reflect in app.

---

## Post-Launch (First 24h)

- [ ] Monitor wallet health every 30–60 minutes.
- [ ] Run reconciliation at least once manually.
- [ ] Review webhook duplicate/mismatch logs.
- [ ] Review failed checkouts and reservation releases.
