import { Link } from "react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Frame for the pages outside the chat (login, register, unlock, 404), set
// like a magazine spread: on wide screens the left page carries the wordmark
// and one large line (`tagline`), the right page the form. Phones get the
// wordmark and the form only. Scrolls normally when the form is long.
const AuthCard = ({ title, description, children, footer, tagline = ["Private letters,", "across India."] }) => (
  <main className="min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
    <div className="hidden flex-col justify-between border-r border-border p-12 lg:flex">
      <Link to="/" className="font-heading text-3xl text-foreground no-underline">
        Open<span className="text-brand italic">chat</span>
      </Link>
      <p aria-hidden="true" className="font-heading text-[64px] leading-[0.95] tracking-tight xl:text-[84px]">
        {tagline[0]}
        <br />
        <span className="text-brand italic">{tagline[1]}</span>
      </p>
      <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
        End-to-end encrypted · Hindi &amp; English · Made for India
      </p>
    </div>

    <div className="mx-auto flex w-full max-w-[560px] flex-col justify-center px-5 py-14 sm:px-12 xl:px-16">
      <Link to="/" className="mb-10 font-heading text-2xl text-foreground no-underline lg:hidden">
        Open<span className="text-brand italic">chat</span>
      </Link>
      <h1 className="text-[40px] leading-none sm:text-[44px]">{title}</h1>
      {description ? <p className="mt-3 text-muted-foreground">{description}</p> : null}
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  </main>
);

// The form's main button: an ink pill with the arrow in a red circle.
export const SubmitButton = ({ children, loading }) => (
  <Button type="submit" loading={loading} className="h-12.5 w-full justify-between rounded-full pr-1.5 pl-6 text-[15px] sm:h-12.5 sm:text-[15px]">
    {children}
    <span aria-hidden="true" className="grid size-9.5 place-items-center rounded-full bg-brand text-brand-foreground">
      <ArrowUpRightIcon strokeWidth={1.7} />
    </span>
  </Button>
);

export default AuthCard;
