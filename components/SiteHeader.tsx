"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import CartMenu from "./CartMenu";

/**
 * The header, drawn from design/site-v3 (T12.1): two capsules — wordmark plus menu on the left, the
 * cart on the right.
 *
 * On the home page the capsules float over the hero (position: absolute); everywhere else they sit
 * in the flow with a hairline, as the design's `inner` pages do. A client component only because it
 * needs the pathname for that and to close the menu after a navigation — the cart's own state is in
 * `CartMenu`, untouched.
 *
 * The menu is a native <details>: it opens and closes without any script of ours, and Escape (below)
 * is the one thing a <details> does not do by itself.
 *
 * The design's "Search" link is left out: there is no search page to send it to.
 */
const MENU = [
  { href: "/", label: "Trang chủ" },
  { href: "/ve-chung-toi", label: "Chuyện của The Hour" },
  { href: "/shop", label: "Online Shop" },
  { href: "/lien-he", label: "Liên hệ" },
  { href: "/blog", label: "Blog" },
] as const;

export default function SiteHeader() {
  const pathname = usePathname();
  const floating = pathname === "/";
  const menuRef = useRef<HTMLDetailsElement>(null);

  // A client-side navigation keeps this component mounted, so the panel would stay open.
  useEffect(() => {
    if (menuRef.current) menuRef.current.open = false;
  }, [pathname]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDetailsElement>) => {
    if (e.key === "Escape" && menuRef.current?.open) {
      menuRef.current.open = false;
      menuRef.current.querySelector("summary")?.focus();
    }
  };

  const capsule = `flex min-h-[60px] items-center gap-6 rounded-md bg-page px-4 text-ink ${floating ? "" : "border border-line"}`;

  return (
    <header
      className={`z-20 flex flex-wrap items-start justify-between gap-4 px-4 lg:px-10 ${
        floating ? "absolute inset-x-0 top-3 sm:top-6" : "relative pt-6 lg:pt-8"
      }`}
    >
      <div className={capsule}>
        <Link href="/" className="text-sm leading-4 font-medium tracking-wide whitespace-nowrap text-ink no-underline">
          The&nbsp;Hour&nbsp;Tea
        </Link>
        <details ref={menuRef} onKeyDown={onKeyDown} className="relative">
          <summary
            aria-label="Menu"
            className="flex cursor-pointer list-none items-center py-2 [&::-webkit-details-marker]:hidden"
          >
            <span aria-hidden="true" className="grid w-5 gap-1">
              <span className="block h-[1.5px] bg-ink" />
              <span className="block h-[1.5px] bg-ink" />
              <span className="block h-[1.5px] bg-ink" />
            </span>
          </summary>
          <nav
            aria-label="Menu"
            className="absolute top-[calc(100%+28px)] -left-4 z-30 [&_a]:text-inherit w-[min(499px,calc(100vw-32px))] rounded-md border border-line bg-page p-8"
          >
            <ul className="m-0 grid list-none gap-3 p-0 text-xl leading-[26px]">
              {MENU.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} onClick={() => menuRef.current && (menuRef.current.open = false)} className="no-underline hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      </div>

      <div className={capsule}>
        <CartMenu />
      </div>
    </header>
  );
}
