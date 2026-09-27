import { useEffect, useRef } from "react";
import { Link, Navigate } from "react-router";
import { CheckCheckIcon, FileIcon, LanguagesIcon, LockIcon, MapPinIcon, MicIcon, VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "../components/ThemeToggle.jsx";
import LandingPresence from "../components/LandingPresence.jsx";
import ArrowLink from "../components/ArrowLink.jsx";
import { useAuth } from "../auth/AuthContext.js";


const FEATURES = [
  {
    icon: LockIcon,
    title: "End-to-end encrypted",
    text: "Every conversation gets its own key, made in your browser. Our server only ever stores scrambled text it can't read.",
  },
  {
    icon: FileIcon,
    title: "Photos, videos and files",
    text: "Encrypted before they're uploaded, up to 10 MB each. Photos lose their location data before they leave your device.",
  },
  {
    icon: VideoIcon,
    title: "Voice and video calls",
    text: "Calls go straight between the two browsers, and even the call setup is encrypted, so nobody in between can listen in.",
  },
  {
    icon: CheckCheckIcon,
    title: "Online, typing, read",
    text: "See when someone is online, typing or has read your message. Turn read receipts off whenever you like.",
  },
  {
    icon: MapPinIcon,
    title: "Meet people by state",
    text: "Find people from any state or union territory. You see how many are online, never who, and you can hide yourself.",
  },
  {
    icon: LanguagesIcon,
    title: "Hindi and English",
    text: "Fonts made for Devanagari and Latin, light and dark themes, and a layout that works on small phones too.",
  },
];

const Wordmark = ({ className = "" }) => (
  <Link to="/" className={`w-fit font-heading text-foreground no-underline ${className}`}>
    Open<span className="text-brand italic">chat</span>
  </Link>
);

// Smooth scrolling and a few scroll reveals (lib/landingMotion.js). Its file
// (GSAP + Lenis) is downloaded only here, and not at all with reduced motion.
const useLandingMotion = (root) => {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let stop = null;
    let cancelled = false;
    import("../lib/landingMotion.js")
      .then(({ startLandingMotion }) => {
        if (!cancelled) stop = startLandingMotion(root.current);
      })
      .catch(() => {
        // Couldn't download it (connection lost): the page works without it.
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [root]);
};

// The hero's picture: an example conversation drawn with the app's own
// styles (no image to download), like the real chat. Decorative.
const ChatPreview = ({ className = "" }) => (
  <div
    aria-hidden="true"
    className={`relative z-10 mx-auto w-full max-w-sm select-none border border-border bg-card text-card-foreground shadow-[0_40px_80px_-40px_rgb(40_20_10/0.55)] ${className}`}
  >
    <div className="border-b border-border px-5 pt-4 pb-3">
      <p className="font-heading text-[28px] leading-none italic">riya_kochi</p>
      <p className="mt-2 font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">
        <span className="text-success">● Online</span> · Kerala
      </p>
    </div>
    <div className="space-y-2 px-5 py-4 text-[15px]">
      <p className="w-fit max-w-[80%] rounded-md bg-muted px-3.5 py-2.5">नमस्ते! आज शाम कॉल करें?</p>
      <p className="ml-auto w-fit max-w-[80%] rounded-md bg-bubble-own px-3.5 py-2.5 text-bubble-own-foreground">
        Haan, 7 baje. Pehle photos bhejta hoon.
      </p>
      <div className="ml-auto flex w-fit items-center gap-2.5 rounded-md bg-muted px-3 py-2">
        <span className="grid size-7 place-items-center rounded-full bg-brand text-brand-foreground">
          <MicIcon className="size-3.5" strokeWidth={1.6} />
        </span>
        <span className="flex h-4 items-end gap-0.5">
          {[6, 12, 8, 14, 10, 5, 12, 7, 11, 6].map((h, i) => (
            <span key={i} className="w-0.5 bg-brand" style={{ height: h }} />
          ))}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">0:12</span>
      </div>
      <p className="flex items-center justify-end gap-1.5 font-mono text-[10.5px] text-muted-foreground">
        7:02 pm <CheckCheckIcon className="size-3.5" />
      </p>
      <p className="font-heading text-[15px] text-muted-foreground italic">riya_kochi is writing…</p>
    </div>
  </div>
);

// Public landing page at "/". Someone already logged in goes straight to
// their chats, like /login and /register do.
// The site's own address, set at deploy (vite.config.js).
const SITE_URL = import.meta.env.VITE_SITE_URL?.replace(/\/+$/, "");
const STRUCTURED_DATA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "OpenChat",
  description: "Private, end-to-end encrypted messages, photos, voice notes and calls with people across India.",
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Any (web browser)",
  inLanguage: ["en-IN", "hi-IN"],
  offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
  ...(SITE_URL ? { url: `${SITE_URL}/` } : {}),
});

const Landing = () => {
  const { currentUser } = useAuth();
  const root = useRef(null);
  useLandingMotion(root);
  if (currentUser) return <Navigate to="/chat" replace />;

  return (
    <div ref={root} className="min-h-dvh bg-background text-foreground">
      <title>OpenChat: private, end-to-end encrypted chat for India</title>
      {SITE_URL ? <link rel="canonical" href={`${SITE_URL}/`} /> : null}
      {/* What search engines show about the app (schema.org). Static data. */}
      <script type="application/ld+json">{STRUCTURED_DATA}</script>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-foreground no-underline focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 md:h-18 md:px-9">
          <Wordmark className="text-2xl md:text-[30px]" />
          <nav aria-label="Account" className="flex items-center gap-2">
            <Button render={<Link to="/login" />} variant="ghost" className="rounded-full px-4">
              Log in
            </Button>
            <Button render={<Link to="/register" />} className="rounded-full px-4 max-sm:hidden">
              Create account
            </Button>
            <ThemeToggle className="rounded-full" />
          </nav>
        </div>
      </header>

      <main id="main">
        <section aria-labelledby="hero-heading" data-hero="" className="relative overflow-hidden border-b border-border">
          {/* A soft red glow behind the example chat (it drifts a little on scroll). */}
          <div
            aria-hidden="true"
            data-hero-glow=""
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] lg:block"
            style={{ background: "radial-gradient(55% 55% at 62% 50%, color-mix(in srgb, var(--brand) 26%, transparent), transparent)" }}
          />

          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 py-14 md:px-9 md:py-20 lg:min-h-[640px] lg:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                End-to-end encrypted · Made for India
              </p>
              <h1 id="hero-heading" className="mt-5 text-[40px] leading-[0.95] text-balance sm:text-7xl xl:text-[84px]">
                Private chats with people <span className="text-brand italic">across India</span>
              </h1>
              <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground">
                Messages, photos, voice notes and calls are locked on your device. Only the person you're talking to can
                open them, not even our server.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <ArrowLink to="/register">Create free account</ArrowLink>
                <Button render={<Link to="/login" />} variant="outline" className="h-12.5 rounded-full border-foreground px-6 text-[15px] sm:h-12.5 sm:text-[15px]">
                  Log in
                </Button>
              </div>
              <p className="mt-5 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
                No phone number needed · Works in your browser
              </p>
            </div>
            <div className="lg:flex lg:h-full lg:items-end lg:pb-4">
              <ChatPreview className="lg:ml-0 lg:w-88 lg:-rotate-2" />
            </div>
          </div>
        </section>

        <section aria-labelledby="features-heading" data-reveal="" className="mx-auto max-w-6xl px-5 py-16 md:px-9 md:py-24">
          <p data-reveal-item="" className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">What you get</p>
          <h2 id="features-heading" data-reveal-item="" className="mt-3 max-w-3xl text-[30px] leading-[1.05] sm:text-[52px]">
            Everything a chat needs, <span className="italic">private by default</span>
          </h2>
          <ul className="mt-12 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }, i) => (
              <li key={title} data-reveal-item="" className="border-t border-border py-7">
                <div className="flex items-center justify-between">
                  <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Icon aria-hidden="true" strokeWidth={1.3} className="size-5 text-brand" />
                </div>
                <h3 className="mt-4 text-[26px] leading-tight">{title}</h3>
                <p className="mt-2 text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <LandingPresence />
      </main>

      <footer data-reveal="" className="mx-auto max-w-6xl px-5 pt-14 pb-10 md:px-9">
        <div data-reveal-item="" className="flex flex-col gap-8 border-b border-border pb-10 md:flex-row md:items-end md:justify-between">
          <div>
            <Wordmark className="text-5xl md:text-6xl" />
            <p className="mt-3 text-muted-foreground">End-to-end encrypted chat for India.</p>
          </div>
          <nav aria-label="Footer" className="flex gap-6">
            <Link to="/login" className="text-foreground no-underline underline-offset-4 hover:underline">
              Log in
            </Link>
            <Link to="/register" className="text-foreground no-underline underline-offset-4 hover:underline">
              Create account
            </Link>
          </nav>
        </div>
        <p className="mt-6 font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
          © {new Date().getFullYear()} OpenChat
        </p>
      </footer>
    </div>
  );
};

export default Landing;
