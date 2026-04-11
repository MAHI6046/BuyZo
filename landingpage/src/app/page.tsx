"use client";

import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <NavBar variant="home" />

      <div className="flex flex-1 flex-col">
      {/* Hero */}
      <section id="home" className="flex min-h-screen flex-col items-center justify-center px-6 pt-16 text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-accent">
          BuyZo - Order anything, delivered to your door
        </p>
        <h1 className="max-w-4xl text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl md:text-6xl">
          Order from the app.
          <br />
          <span className="text-muted">We deliver to your door.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          BuyZo connects you with local groceries and everyday essentials across Metpally Mandal. Browse by category, search products, or ask BuyZo Bot by voice—then checkout with secure payment and track your order until it arrives.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="#cta"
            className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-deep"
          >
            Get the app
          </Link>
          <Link
            href="#how-it-works"
            className="rounded-full border border-foreground/15 bg-transparent px-6 py-3 text-sm font-medium transition-colors hover:bg-foreground/5"
          >
            How it works
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-black/5 bg-foreground/[0.02] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            How it works
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted">
            From app to doorstep in four simple steps.
          </p>
          <div className="mt-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { step: "1", title: "Set your location", text: "Add your delivery address once. Use the map or search—we support Google Places so you can pick your home or work." },
              { step: "2", title: "Browse or ask BuyZo Bot", text: "Shop by category or search. Prefer hands-free? Tell BuyZo Bot what you need by voice or text and it adds items to your cart." },
              { step: "3", title: "Checkout securely", text: "Review cart, see item total, delivery fee, and platform fee in AUD. Pay with card via Stripe—secure and fast." },
              { step: "4", title: "Track your order", text: "Watch your order move from confirmed to out for delivery. Get it at your door across Victoria." },
            ].map(({ step, title, text }) => (
              <div key={step} className="relative rounded-2xl border border-black/5 bg-background p-6 shadow-sm">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">{step}</span>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features / Products */}
      <section
        id="features"
        className="border-t border-black/5 py-24"
      >
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Why BuyZo
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted">
            Built for customers and drivers in Victoria—simple, clear, and reliable.
          </p>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Browse & search", description: "Shop groceries, staples, and everyday products. Filter by category, search by name, and choose variants and sizes. Prices in AUD, always clear before you add to cart." },
              { title: "BuyZo Bot assistant", description: "Add items by voice or text. Say or type what you need—BuyZo Bot finds matching products and adds them to your cart. Hands-free and fast for repeat orders." },
              { title: "Cart & checkout", description: "See item total, delivery fee, and platform fee before you pay. Checkout with card via Stripe. No surprises—everything shown upfront." },
              { title: "Order tracking", description: "Track every order from confirmed to out for delivery. Retry payment if needed. View order history and details in the app." },
              { title: "Delivery to your door", description: "We deliver across Victoria. Set your address in the app; delivery fees are shown at checkout. Our drivers bring your order to you." },
              { title: "Drive with BuyZo", description: "Join as a delivery partner. See available orders, accept assignments, and complete deliveries. Separate driver app—BuyZo Driver—for delivery partners." },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-black/5 bg-background p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Coverage */}
      <section className="border-t border-black/5 bg-foreground/[0.02] py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Serving Victoria, Australia
          </h2>
          <p className="mt-3 text-muted">
            BuyZo operates within Victoria. We connect you with local grocery and product options and independent delivery partners. Estimated delivery times and fees are shown at checkout.
          </p>
        </div>
      </section>

      {/* About Us */}
      <section id="about" className="border-t border-black/5 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            About Us
          </h2>
          <p className="mt-4 text-muted">
            BuyZo is a technology platform that connects customers with local groceries and essentials in Victoria. We don't own or store the products—we link you with partner stores and delivery drivers so you can order in the app, pay securely, and get your order at your door. Our focus is a simple experience: set your location, browse or ask BuyZo Bot, checkout, and track your delivery.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-black/5 bg-foreground/[0.02] py-24">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Frequently asked questions
          </h2>
          <dl className="mt-12 space-y-8">
            {[
              { q: "How do I place an order?", a: "Download the BuyZo app, set your delivery address, then browse products or ask BuyZo Bot by voice or text. Add items to your cart, review the total (including delivery and platform fees), and pay with your card at checkout. Orders are subject to store confirmation and availability." },
              { q: "Where do you deliver?", a: "We deliver within Victoria, Australia. Delivery fees and estimated times are shown at checkout based on your address." },
              { q: "How do I pay?", a: "Payment is by card through Stripe. You complete payment in the app before your order is dispatched. We don’t store your full card details." },
              { q: "What if I need a refund?", a: "Refund requests should be made within 24 to 48 hours of delivery. Contact support for delivery-related issues. Your rights under Australian Consumer Law are not excluded by our terms." },
              { q: "What is BuyZo Bot?", a: "BuyZo Bot is our in-app assistant. You can speak or type what you want to buy, and BuyZo Bot finds matching products and adds them to your cart. It's optional—you can always browse and tap to add items yourself." },
            ].map(({ q, a }) => (
              <div key={q}>
                <dt className="font-semibold text-foreground">{q}</dt>
                <dd className="mt-2 text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* CTA */}
      <section
        id="cta"
        className="border-t border-black/5 py-24"
      >
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Get the app
          </h2>
          <p className="mt-3 text-muted">
            Download BuyZo to start ordering. Enter your email and we'll send you the link.
          </p>
          <form className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <input
              type="email"
              placeholder="you@example.com"
              className="rounded-full border border-foreground/15 bg-transparent px-5 py-3 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              aria-label="Email address"
            />
            <button
              type="submit"
              className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Send me the link
            </button>
          </form>
        </div>
      </section>

      </div>

      <Footer />
    </div>
  );
}
