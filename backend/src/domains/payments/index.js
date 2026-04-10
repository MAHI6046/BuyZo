const Stripe = require('stripe');

function createPaymentConfig(env) {
  const stripeSecretKey = (env.STRIPE_SECRET_KEY || '').trim();
  const stripeWebhookSecret = (env.STRIPE_WEBHOOK_SECRET || '').trim();
  const stripePublishableKey = (env.STRIPE_PUBLISHABLE_KEY || '').trim();
  const PLATFORM_CURRENCY = 'inr';

  return {
    stripeSecretKey,
    stripeWebhookSecret,
    stripePublishableKey,
    PLATFORM_CURRENCY,
    stripeClient: stripeSecretKey ? new Stripe(stripeSecretKey) : null,
  };
}

module.exports = {
  createPaymentConfig,
};
