import { MessageSquareLockIcon } from "lucide-react";

// Frame for the pages outside the chat (login, register, unlock, 404): the
// OpenChat mark and one centred card. Scrolls normally on small screens.
const AuthCard = ({ title, description, children, footer }) => (
  <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
    <div className="w-full max-w-md">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <MessageSquareLockIcon aria-hidden="true" className="size-6" />
        </span>
        <p className="font-heading text-lg font-semibold">OpenChat</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <h1 className="text-xl">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </div>

      {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
    </div>
  </main>
);

export default AuthCard;
