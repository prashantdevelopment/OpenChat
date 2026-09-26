import { Link, Navigate } from "react-router";
import {
  CheckCheckIcon,
  FileIcon,
  LanguagesIcon,
  LockIcon,
  MapPinIcon,
  MessageSquareLockIcon,
  MicIcon,
  VideoIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "../components/ThemeToggle.jsx";
import LandingPresence from "../components/LandingPresence.jsx";
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

const Logo = () => (
  <Link to="/" className="flex w-fit items-center gap-2 rounded-lg font-heading text-lg font-semibold text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <MessageSquareLockIcon aria-hidden="true" className="size-4.5" />
    </span>
    OpenChat
  </Link>
);

// The hero's picture: an example conversation drawn with the app's own
// styles (no image to download). Decorative; the 3D hero builds on it later.
const ChatPreview = () => (
  <div aria-hidden="true" className="mx-auto w-full max-w-sm select-none rounded-2xl border border-border bg-card text-card-foreground shadow-xl">
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <span className="relative flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
        R
        <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-card bg-success" />
      </span>
      <div className="min-w-0">
        <p className="font-medium">riya_kochi</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <LockIcon className="size-3" /> End-to-end encrypted
        </p>
      </div>
    </div>
    <div className="space-y-2 px-4 py-4 text-[15px]">
      <p className="w-fit max-w-[80%] rounded-2xl rounded-bl-md bg-muted px-3 py-2">नमस्ते! आज शाम कॉल करें?</p>
      <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-bubble-own px-3 py-2 text-bubble-own-foreground">
        Haan, 7 baje. Pehle photos bhejta hoon.
      </p>
      <div className="ml-auto flex w-fit items-center gap-2 rounded-2xl rounded-br-md bg-bubble-own px-3 py-2 text-bubble-own-foreground">
        <MicIcon className="size-4" />
        <span className="flex h-4 items-end gap-0.5">
          {[6, 12, 8, 14, 10, 5, 12, 7, 11, 6].map((h, i) => (
            <span key={i} className="w-0.5 rounded-full bg-current" style={{ height: h }} />
          ))}
        </span>
        <span className="text-xs tabular-nums">0:12</span>
      </div>
      <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
        7:02 pm <CheckCheckIcon className="size-3.5 text-primary" />
      </p>
      <p className="w-fit rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-muted-foreground italic">typing…</p>
    </div>
  </div>
);

// Public landing page at "/". Someone already logged in goes straight to
// their chats, like /login and /register do.
const Landing = () => {
  const { currentUser } = useAuth();
  if (currentUser) return <Navigate to="/chat" replace />;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <title>OpenChat: private, end-to-end encrypted chat for India</title>
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-2">
            <Button render={<Link to="/login" />} variant="ghost">
              Log in
            </Button>
            <Button render={<Link to="/register" />} className="max-sm:hidden">
              Create account
            </Button>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="main">
        <section aria-labelledby="hero-heading" className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 md:grid-cols-2 md:py-24">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-muted-foreground">
              <LockIcon aria-hidden="true" className="size-3.5 text-primary" /> End-to-end encrypted
            </p>
            <h1 id="hero-heading" className="mt-5 text-4xl leading-tight text-balance sm:text-5xl">
              Private chats with people across India
            </h1>
            <p className="mt-5 max-w-prose text-lg text-muted-foreground">
              Messages, photos, voice notes and calls are locked on your device. Only the person you're talking to can
              open them, not even our server.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button render={<Link to="/register" />} size="xl">
                Create free account
              </Button>
              <Button render={<Link to="/login" />} size="xl" variant="outline">
                Log in
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">No phone number needed. Works in your browser.</p>
          </div>
          <ChatPreview />
        </section>

        <section aria-labelledby="features-heading" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 md:pb-24">
          <h2 id="features-heading" className="text-2xl sm:text-3xl">
            Everything a chat needs, private by default
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-xl border border-border bg-card p-5 text-card-foreground">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h3 className="mt-4 text-lg">{title}</h3>
                <p className="mt-1.5 text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <LandingPresence />
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <Logo />
          <p className="mt-2">End-to-end encrypted chat for India.</p>
        </div>
        <nav aria-label="Footer" className="flex gap-4">
          <Link to="/login" className="rounded text-muted-foreground no-underline underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            Log in
          </Link>
          <Link to="/register" className="rounded text-muted-foreground no-underline underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            Create account
          </Link>
        </nav>
        <p>© {new Date().getFullYear()} OpenChat</p>
      </footer>
    </div>
  );
};

export default Landing;
