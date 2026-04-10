import Link from "next/link";

const footerLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/delivery", label: "Delivery" },
  { href: "/cookies", label: "Cookies" },
];

export default function Footer() {
  return (
    <footer className="mt-auto shrink-0 border-t border-black/5 py-10 min-h-[220px]">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="mb-6 text-sm text-muted">
          <p className="font-semibold text-foreground">DOTDELIVERY</p>
          <p>Operated by VMRS Pty Ltd</p>
          <p>18 Mt Alexander Rd, Travancore, Victoria, Australia</p>
          <p className="mt-2">
            Email:{" "}
            <a href="mailto:vmrs62361@gmail.com" className="underline hover:text-foreground">vmrs62361@gmail.com</a>
            {" / "}
            <a href="mailto:Admin@dotdelivery.com.au" className="underline hover:text-foreground">Admin@dotdelivery.com.au</a>
            {" / "}
            <a href="mailto:Support@dotdelivery.com.au" className="underline hover:text-foreground">Support@dotdelivery.com.au</a>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-black/5 pt-6">
          <span className="text-sm text-muted">© {new Date().getFullYear()} DOT Delivery</span>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted" aria-label="Footer">
            {footerLinks.map(({ href, label }) => (
              <Link key={href} href={href} className="transition-colors hover:text-foreground">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
