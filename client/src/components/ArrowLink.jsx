import { Link } from "react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// The main call to action on public pages: a jade pill with the arrow in its
// own circle ("button in button"), linking to `to`.
const ArrowLink = ({ to, children, className = "" }) => (
  <Button render={<Link to={to} />} className={`h-12.5 min-h-[44px] gap-3 rounded-full pr-1.5 pl-6 text-[0.9375rem] sm:h-12.5 sm:text-[0.9375rem] ${className}`}>
    {children}
    <span aria-hidden="true" className="grid size-9.5 place-items-center rounded-full bg-primary-foreground text-primary">
      <ArrowUpRightIcon strokeWidth={1.7} />
    </span>
  </Button>
);

export default ArrowLink;
