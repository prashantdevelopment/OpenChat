import { cn } from "@/lib/utils";

// Round avatar with the first letter of the name (photos come with media
// uploads later). Decorative: the name is always shown next to it, so screen
// readers skip it.
const Avatar = ({ name, className }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-heading font-semibold text-primary-foreground",
      className,
    )}
  >
    {name?.[0]?.toUpperCase() ?? "?"}
  </span>
);

export default Avatar;
