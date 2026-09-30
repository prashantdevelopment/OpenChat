import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

// A small drop-down menu (the chat header's "⋮"), on Base UI's Menu: keyboard
// arrows, Esc, focus back to the button and the ARIA roles come from there.

export const Menu = MenuPrimitive.Root;

export function MenuTrigger(props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />;
}

export function MenuPopup({ className, children, align = "end", sideOffset = 6, ...props }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="z-50" align={align} sideOffset={sideOffset}>
        <MenuPrimitive.Popup
          data-slot="menu-popup"
          className={cn(
            "min-w-48 origin-(--transform-origin) rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-[0_18px_40px_-20px_rgb(40_20_10/0.45)] outline-none",
            "transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

const itemClass =
  "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-foreground no-underline outline-none select-none data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function MenuItem({ className, ...props }) {
  return <MenuPrimitive.Item data-slot="menu-item" className={cn(itemClass, className)} {...props} />;
}

export function MenuLinkItem({ className, ...props }) {
  return <MenuPrimitive.LinkItem data-slot="menu-item" className={cn(itemClass, className)} {...props} />;
}
