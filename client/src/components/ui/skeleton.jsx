import { cn } from "@/lib/utils";

// Grey placeholder in the shape of content that is still loading. Decorative:
// the container that shows skeletons announces "Loading..." itself.
// (The pulse stops with prefers-reduced-motion, see index.css.)
export const Skeleton = ({ className }) => (
  <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted", className)} />
);
