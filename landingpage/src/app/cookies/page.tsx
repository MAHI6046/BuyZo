import PolicyLayout from "@/components/PolicyLayout";

export const metadata = {
  title: "Cookie Policy | BuyZo",
  description: "Cookie Policy for BuyZo website and services.",
};

export default function CookiesPage() {
  return (
    <PolicyLayout title="Cookie Policy">
      <div className="mt-8 text-muted">
        <ul className="mt-6 list-disc space-y-2 pl-6">
          <li>We use cookies and analytics tools to improve functionality and user experience.</li>
          <li>Cookies help us analyse usage and improve performance.</li>
          <li>You may disable cookies through your browser settings.</li>
        </ul>
        <p className="mt-8 text-sm">
          For questions, contact us at{" "}
          <a href="mailto:Support@dotdelivery.com.au" className="text-accent underline">Support@dotdelivery.com.au</a>.
        </p>
      </div>
    </PolicyLayout>
  );
}
