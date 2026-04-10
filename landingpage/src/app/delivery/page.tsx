import PolicyLayout from "@/components/PolicyLayout";

export const metadata = {
  title: "Delivery Policy | DOT Delivery",
  description: "Delivery Policy for DOT Delivery in Victoria, Australia.",
};

export default function DeliveryPage() {
  return (
    <PolicyLayout title="Delivery Policy">
      <div className="mt-8 text-muted">
        <ul className="mt-6 list-disc space-y-2 pl-6">
          <li>DOT Delivery operates within Victoria, Australia.</li>
          <li>Estimated delivery times are shown at checkout.</li>
          <li>Delivery fees are displayed before payment.</li>
          <li>Customers must provide accurate delivery information.</li>
          <li>Contact support for delivery-related concerns.</li>
        </ul>
        <p className="mt-8 text-sm">
          For delivery support, contact us at{" "}
          <a href="mailto:Support@dotdelivery.com.au" className="text-accent underline">Support@dotdelivery.com.au</a>.
        </p>
      </div>
    </PolicyLayout>
  );
}
