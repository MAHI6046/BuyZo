import PolicyLayout from "@/components/PolicyLayout";

export const metadata = {
  title: "Privacy Policy | BuyZo",
  description: "Privacy Policy for BuyZo operated by VMRS Pty Ltd in Victoria, Australia.",
};

export default function PrivacyPage() {
  return (
    <PolicyLayout title="Privacy Policy">
      <div className="mt-8 text-muted">
        <p className="text-foreground text-lg">
          VMRS Solutions Pty Ltd operates BuyZo in Victoria, Australia.
        </p>
        <ul className="mt-6 list-disc space-y-2 pl-6">
          <li>We comply with the <strong>Privacy Act 1988 (Cth)</strong> and Australian Privacy Principles.</li>
          <li>We collect personal information such as name, email, phone number, delivery address, and order details.</li>
          <li>Payments are processed securely through third-party providers. We do not store full card details.</li>
          <li>We use your information to process orders, coordinate deliveries, provide support, and improve services.</li>
          <li>We may share necessary information with partner stores, delivery partners, payment providers, and IT service providers.</li>
          <li>We do not sell your personal information.</li>
          <li>You may request access or correction of your personal data by contacting us.</li>
          <li>Data may be stored securely and retained as required by law.</li>
          <li>We may update this Privacy Policy from time to time.</li>
        </ul>
        <p className="mt-8 text-sm">
          For questions, contact us at{" "}
          <a href="mailto:Support@dotdelivery.com.au" className="text-accent underline">Support@dotdelivery.com.au</a>.
        </p>
      </div>
    </PolicyLayout>
  );
}
