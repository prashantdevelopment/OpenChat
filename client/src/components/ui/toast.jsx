import { Toast } from "@base-ui/react/toast";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Toasts: short messages about something that happened in the background
// (e.g. "Couldn't load older messages"). Errors about the thing on screen are
// shown inline instead. Built on Base UI Toast: the viewport is an aria-live
// region (screen readers read new toasts); a toast closes by itself, with the
// X button or with a swipe.
//
// toastManager works outside React too:
//   toastManager.add({ type: "error", title: "...", description: "..." })
export const toastManager = Toast.createToastManager();

const ICONS = {
  error: <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive-foreground" />,
};

const ToastList = () => {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      {/* Top of the screen: at the bottom they would cover the composer. */}
      <Toast.Viewport className="fixed inset-x-4 top-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96">
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            swipeDirection={["right", "up"]}
            className={cn(
              "flex items-start gap-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg",
              "translate-x-(--toast-swipe-movement-x) translate-y-(--toast-swipe-movement-y)",
              "transition-[opacity,translate] duration-200 ease-out data-ending-style:opacity-0 data-starting-style:-translate-y-2 data-starting-style:opacity-0",
            )}
          >
            {ICONS[toast.type] ?? null}
            <div className="min-w-0 flex-1">
              <Toast.Title className="text-sm font-medium" />
              <Toast.Description className="text-sm text-muted-foreground" />
            </div>
            <Toast.Close
              data-slot="toast-close"
              aria-label="Close"
              className="-m-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-9"
            >
              <XIcon aria-hidden="true" className="size-4" />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
};

// Wrap the app once. Errors stay 6s (a little longer than the 5s default).
export const ToastProvider = ({ children }) => (
  <Toast.Provider toastManager={toastManager} timeout={6000}>
    {children}
    <ToastList />
  </Toast.Provider>
);
