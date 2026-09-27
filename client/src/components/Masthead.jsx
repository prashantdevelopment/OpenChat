import { Link } from "react-router";
import { ArrowLeftIcon, ArrowUpRightIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import ThemeToggle from "./ThemeToggle.jsx";
import { useAuth } from "../auth/AuthContext.js";

const today = () => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).replace(", ", " · ");

// The app's top bar, like a newspaper masthead: the wordmark, today's date,
// an optional slot (the people search), a link to Discover (or back to the
// chats) and the account buttons. Hairline rule underneath.
const Masthead = ({ children, discover = true }) => {
  const { logout } = useAuth();
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 md:h-18 md:gap-6 md:px-9">
      <Link to="/chat" className="font-heading text-2xl text-foreground no-underline md:text-[30px]">
        Open<span className="text-brand italic">chat</span>
      </Link>
      <span className="hidden font-mono text-[11.5px] tracking-[0.14em] text-muted-foreground uppercase lg:inline">{today()}</span>
      <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-4">
        {children}
        {discover ? (
          <Button render={<Link to="/discover" />} variant="outline" className="rounded-full border-foreground px-4 max-sm:hidden">
            Discover India
            <ArrowUpRightIcon aria-hidden="true" strokeWidth={1.4} />
          </Button>
        ) : (
          <Button render={<Link to="/chat" />} variant="outline" className="rounded-full border-foreground px-4 max-sm:size-9 max-sm:px-0">
            <ArrowLeftIcon aria-hidden="true" strokeWidth={1.4} className="sm:hidden" />
            <span className="max-sm:sr-only">Back to chats</span>
          </Button>
        )}
        <ThemeToggle className="rounded-full" />
        <Button render={<Link to="/settings" />} variant="outline" size="icon" className="rounded-full" aria-label="Settings">
          <SettingsIcon aria-hidden="true" strokeWidth={1.4} />
        </Button>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={logout}>
          <LogOutIcon aria-hidden="true" strokeWidth={1.4} />
          <span className="max-md:sr-only">Logout</span>
        </Button>
      </div>
    </header>
  );
};

export default Masthead;
