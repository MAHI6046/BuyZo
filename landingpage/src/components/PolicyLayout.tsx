"use client";

import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

export default function PolicyLayout({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <NavBar variant="policy" />

      <main className="flex flex-1 flex-col pt-24 pb-16">
        <div className="mx-auto max-w-3xl px-6">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
      </main>

      <Footer />
    </div>
  );
}
