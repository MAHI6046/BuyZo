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
    setPillStyle({ left: er.left - cr.left, width: er.width });
  };

  useEffect(() => {
    if (!showPill) return;
    const id = requestAnimationFrame(() => updatePillPosition());
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
    const sections = navLinks.map((l) => document.getElementById(l.sectionId)).filter(Boolean) as HTMLElement[];
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
      <nav className="flex h-14 w-full min-w-0 items-center gap-4 sm:h-16 md:gap-6">
        <div className="shrink-0 pl-3 sm:pl-4 md:pl-6">
          <Link href="/" className="flex items-center" aria-label="DOT DELIVERY home">
            <Image
              src="/dotdelivery-mobile-logo.png"
              alt=""
              width={48}
              height={48}
              quality={100}
              className="h-8 w-auto sm:h-9 md:hidden"
              priority
              unoptimized
            />
            <Image
              src="/dotdelivery-logo.png"
              alt=""
              width={192}
              height={48}
              quality={100}
              className="hidden h-4 w-auto sm:h-[18px] md:block"
              priority
              unoptimized
            />
          </Link>
        </div>

        <div className="min-w-0 flex-1 md:hidden" aria-hidden />

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-4 md:flex md:gap-6 md:pr-6 lg:gap-8">
          <div ref={tabsContainerRef} className="relative flex h-10 min-w-0 items-center gap-3 md:gap-4 lg:gap-6">
            {showPill && (
              <span
                className="absolute top-1/2 h-8 -translate-y-1/2 rounded-full border border-white/50 bg-white/40 shadow-[0_2px_12px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                style={{ left: pillStyle.left, width: pillStyle.width }}
                aria-hidden
              />
            )}
            {navLinks.map((item, i) => (
              <span
                key={item.href}
                ref={(el) => { linkRefs.current[i] = el; }}
                className="relative z-10 flex items-center px-1 -mx-1"
              >
                <Link
                  href={linkHref(item)}
                  onClick={() => setActiveTab(item.sectionId)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover:text-foreground ${
                    activeTab === item.sectionId ? "text-foreground" : "text-muted"
                  }`}
                >
                  {item.label}
                </Link>
              </span>
            ))}
          </div>
          <Link
            href={variant === "policy" ? "/#cta" : "#cta"}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen((o) => !o)}
          className="ml-auto flex h-11 min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg pl-3 pr-4 text-foreground transition-colors hover:bg-foreground/5 md:hidden"
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle menu"
        >
          <span className={`h-0.5 w-5 bg-current transition-all ${mobileMenuOpen ? "translate-y-2 rotate-45" : ""}`} />
          <span className={`h-0.5 w-5 bg-current transition-all ${mobileMenuOpen ? "opacity-0" : ""}`} />
          <span className={`h-0.5 w-5 bg-current transition-all ${mobileMenuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
        </button>
      </nav>

      <div className={`overflow-hidden transition-all duration-200 ease-out md:hidden ${mobileMenuOpen ? "max-h-[min(80vh,400px)] opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="border-t border-black/5 bg-background/95 px-4 py-4 backdrop-blur-md">
          <nav className="flex flex-col gap-1" aria-label="Mobile menu">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={linkHref(item)}
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] rounded-lg px-4 py-3 text-sm font-medium text-muted transition-colors hover:bg-foreground/5 hover:text-foreground active:bg-foreground/10"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={variant === "policy" ? "/#cta" : "#cta"}
              onClick={() => setMobileMenuOpen(false)}
              className="mt-2 min-h-[44px] rounded-full bg-foreground px-4 py-3 text-center text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80"
            >
              Get started
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
