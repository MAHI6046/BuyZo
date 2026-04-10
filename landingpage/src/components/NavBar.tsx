"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";

const navLinks = [
  { href: "/", label: "Home", sectionId: "home" },
  { href: "#how-it-works", label: "How it works", sectionId: "how-it-works" },
  { href: "#features", label: "Products", sectionId: "features" },
  { href: "#about", label: "About Us", sectionId: "about" },
  { href: "#cta", label: "Contact Us", sectionId: "cta" },
];

type NavBarProps = {
  variant: "home" | "policy";
};

export default function NavBar({ variant }: NavBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 });
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const showPill = variant === "home";

  const linkHref = (item: (typeof navLinks)[0]) =>
    variant === "policy" ? (item.href === "/" ? "/" : `/${item.href}`) : item.href;

  const updatePillPosition = () => {
    if (!showPill) return;
    const container = tabsContainerRef.current;
    const activeIndex = navLinks.findIndex((l) => l.sectionId === activeTab);
    const el = activeIndex >= 0 ? linkRefs.current[activeIndex] : null;
    if (!container || !el) return;

    const cr = container.getBoundingClientRect();
    const er = el.getBoundingClientRect();

    setPillStyle({
      left: er.left - cr.left,
      width: er.width,
    });
  };

  useEffect(() => {
    if (!showPill) return;
    const id = requestAnimationFrame(updatePillPosition);
    return () => cancelAnimationFrame(id);
  }, [activeTab, showPill]);

  useEffect(() => {
    if (!showPill) return;
    const onResize = () => updatePillPosition();
    window.addEventListener("resize", onResize);

    const t = setTimeout(updatePillPosition, 100);

    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(t);
    };
  }, [showPill]);

  useEffect(() => {
    if (variant !== "home") return;

    const sections = navLinks
      .map((l) => document.getElementById(l.sectionId))
      .filter(Boolean) as HTMLElement[];

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id;
          const link = navLinks.find((l) => l.sectionId === id);
          if (link) setActiveTab(link.sectionId);
        }
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );

    sections.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [variant]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-black/5 bg-background/50 backdrop-blur-md">
      <nav className="flex h-14 w-full items-center gap-4 sm:h-16 md:gap-6">

        {/* ✅ LOGO + BRAND */}
        <div className="shrink-0 pl-3 sm:pl-4 md:pl-6">
          <Link href="/" className="flex items-center gap-2" aria-label="BuyZo home">
            <Image
              src="/buyzo-logo.png"
              alt="BuyZo Logo"
              width={40}
              height={40}
              className="h-8 w-auto sm:h-9"
              priority
            />
            <span className="text-lg font-bold text-foreground">BuyZo</span>
          </Link>
        </div>

        <div className="min-w-0 flex-1 md:hidden" />

        {/* ✅ DESKTOP MENU */}
        <div className="hidden flex-1 items-center justify-end gap-4 md:flex md:gap-6 md:pr-6 lg:gap-8">
          <div ref={tabsContainerRef} className="relative flex h-10 items-center gap-4">

            {showPill && (
              <span
                className="absolute top-1/2 h-8 -translate-y-1/2 rounded-full border border-white/50 bg-white/40 backdrop-blur-xl transition-all duration-300"
                style={{ left: pillStyle.left, width: pillStyle.width }}
              />
            )}

            {navLinks.map((item, i) => (
              <span key={item.href} ref={(el) => (linkRefs.current[i] = el)}>
                <Link
                  href={linkHref(item)}
                  onClick={() => setActiveTab(item.sectionId)}
                  className={`px-3 py-1.5 text-sm font-medium ${
                    activeTab === item.sectionId
                      ? "text-foreground"
                      : "text-muted"
                  }`}
                >
                  {item.label}
                </Link>
              </span>
            ))}
          </div>

          <Link
            href={variant === "policy" ? "/#cta" : "#cta"}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Get started
          </Link>
        </div>

        {/* ✅ MOBILE MENU BUTTON */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="ml-auto md:hidden"
        >
          ☰
        </button>
      </nav>

      {/* ✅ MOBILE MENU */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-background p-4">
          {navLinks.map((item) => (
            <Link
              key={item.href}
              href={linkHref(item)}
              className="block py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}