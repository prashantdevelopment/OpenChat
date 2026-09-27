import { Link } from "react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// The main call to action on public pages: an ink pill with the arrow in a
// red circle ("button in button"), linking to `to`.
const ArrowLink = ({ to, children, className = "" }) => (
  <Button render={<Link to={to} />} className={`h-12.5 gap-3 rounded-full pr-1.5 pl-6 text-[0.9375rem] sm:h-12.5 sm:text-[0.9375rem] ${className}`}>
    {children}
    <span aria-hidden="true" className="grid size-9.5 place-items-center rounded-full bg-brand text-brand-foreground">
      <ArrowUpRightIcon strokeWidth={1.7} />
    </span>
  </Button>
);

export default ArrowLink;
