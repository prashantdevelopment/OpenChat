import { Link } from "react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Frame for the pages outside the chat (login, register, unlock, 404), set
// like a magazine spread: on wide screens the left page carries the wordmark
// and one large line (`tagline`), the right page the form. Phones and tablets
// get one card in the middle of the paper instead: the wordmark and the
// tagline on top, then the form. Scrolls normally when the form is long.
const AuthCard = ({ title, description, children, footer, tagline = ["Private letters,", "across India."] }) => (
  <main className="grid min-h-dvh place-items-center bg-background px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:place-items-stretch lg:p-0">
    <div className="hidden flex-col justify-between border-r border-border p-12 lg:flex">
      <Link to="/" className="font-heading text-3xl text-foreground no-underline">
        Open<span className="text-brand italic">chat</span>
      </Link>
      <p aria-hidden="true" className="font-heading text-[4rem] leading-[0.95] tracking-tight xl:text-[5.25rem]">
        {tagline[0]}
        <br />
        <span className="text-brand italic">{tagline[1]}</span>
      </p>
      <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
        End-to-end encrypted · Hindi &amp; English · Made for India
      </p>
    </div>

    <div className="w-full max-w-[460px] rounded-2xl border border-border bg-card px-6 py-8 shadow-[0_30px_60px_-34px_rgb(10_30_25/0.5)] sm:max-w-[500px] sm:px-10 sm:py-10 lg:mx-auto lg:flex lg:max-w-[560px] lg:flex-col lg:justify-center lg:rounded-none lg:border-0 lg:bg-transparent lg:px-12 lg:py-14 lg:shadow-none xl:px-16">
      <header className="mb-8 border-b border-border pb-7 text-center lg:hidden">
        <Link to="/" className="font-heading text-[1.75rem] leading-none text-foreground no-underline">
          Open<span className="text-brand italic">chat</span>
        </Link>
        <p aria-hidden="true" className="mt-4 font-heading text-[1.375rem] leading-[1.15] sm:text-[1.625rem]">
          {tagline[0]} <span className="text-brand italic">{tagline[1]}</span>
        </p>
        <p className="mt-3 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">Encrypted · Made for India</p>
      </header>
      <h1 className="text-[1.75rem] leading-none sm:text-[2.25rem] lg:text-[2.75rem]">{title}</h1>
      {description ? <p className="mt-3 text-muted-foreground">{description}</p> : null}
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  </main>
);

// The form's main button: a jade pill with the arrow in its own circle.
export const SubmitButton = ({ children, loading }) => (
  <Button type="submit" loading={loading} className="h-12.5 w-full justify-between rounded-full pr-1.5 pl-6 text-[0.9375rem] sm:h-12.5 sm:text-[0.9375rem]">
    {children}
    <span aria-hidden="true" className="grid size-9.5 place-items-center rounded-full bg-primary-foreground text-primary">
      <ArrowUpRightIcon strokeWidth={1.7} />
    </span>
  </Button>
);

export default AuthCard;
