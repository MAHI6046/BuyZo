import PolicyLayout from "@/components/PolicyLayout";

export const metadata = {
  title: "Terms & Conditions | DOT Delivery",
  description: "Terms and Conditions for using DOT Delivery in Victoria, Australia.",
};

export default function TermsPage() {
  return (
    <PolicyLayout title="Terms & Conditions">
      <div className="mt-8 text-muted">
        <p className="text-foreground text-lg">
          By using Dot Delivery, you agree to these Terms and Conditions.
        </p>
        <ul className="mt-6 list-disc space-y-2 pl-6">
          <li>DOT Delivery is a technology platform connecting customers with local grocery stores and independent delivery partners in Victoria.</li>
          <li>We do not manufacture, store, or own listed products.</li>
          <li>You must be at least 18 years old to use this service.</li>
          <li>Orders are subject to store confirmation and availability.</li>
          <li>Prices are displayed in AUD. Delivery fees may apply.</li>
          <li>Payment must be completed before dispatch.</li>
          <li>Delivery times are estimates only and may vary.</li>
          <li>Refund requests must be made within 24 to 48 hours of delivery.</li>
          <li>Nothing in these Terms excludes your rights under Australian Consumer Law.</li>
          <li>We reserve the right to suspend accounts for misuse or fraudulent activity.</li>
          <li>These Terms are governed by the laws of Victoria, Australia.</li>
        </ul>
        <p className="mt-8 text-sm">
          For questions, contact us at{" "}
          <a href="mailto:Support@dotdelivery.com.au" className="text-accent underline">Support@dotdelivery.com.au</a>.
        </p>
      </div>
    </PolicyLayout>
  );
}
