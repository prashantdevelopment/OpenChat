import { useEffect, useState } from "react";
import ArrowLink from "./ArrowLink.jsx";
import { Skeleton } from "@/components/ui/skeleton";
import api from "../api/api.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";

const REFRESH_MS = 30_000;
const TOP = 5;
const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name ?? code;
const formatCount = (n) => n.toLocaleString("en-IN");

// The public online counts ({ states, total }; null = fewer than 5), fetched
// again every 30 seconds while the tab is visible. "error" if it failed.
const usePublicPresence = () => {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    let controller;
    const load = () => {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      api
        .get("/presence/states", { signal: controller.signal })
        .then((response) => setSnapshot({ states: response.data.states, total: response.data.total }))
        .catch((error) => {
          if (error.name !== "CanceledError") setSnapshot((current) => current ?? "error");
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      controller?.abort();
    };
  }, []);

  return snapshot;
};

// Landing section: how many people are online in India and the busiest
// states. Counts only, never who; counts under 5 are hidden by the server.
const LandingPresence = () => {
  const snapshot = usePublicPresence();
  const busiest =
    snapshot && snapshot !== "error"
      ? snapshot.states
          .filter((state) => state.online !== null)
          .sort((a, b) => b.online - a.online)
          .slice(0, TOP)
      : [];

  return (
    <section aria-labelledby="presence-heading" data-reveal="" className="border-y border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-2 md:px-9 md:py-24">
        <div data-reveal-item="">
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Live, counts only</p>
          <h2 id="presence-heading" className="mt-3 text-[30px] leading-[1.05] sm:text-[52px]">
            Right now <span className="text-brand italic">across India</span>
          </h2>
          <p className="mt-4 max-w-prose text-muted-foreground">
            You can see how many people are online in each state, never who they are. Numbers under 5 are hidden, so
            nobody in a small group can be picked out.
          </p>
          <ArrowLink to="/register" className="mt-8">
            Join from your state
          </ArrowLink>
        </div>

        <div data-reveal-item="" aria-live="polite">
          {snapshot === null ? (
            <div className="space-y-4" aria-label="Loading online counts">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-5/6" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : snapshot === "error" ? (
            <p className="text-muted-foreground">Live counts aren't available right now. Please try again later.</p>
          ) : (
            <>
              <p className="font-mono text-xs tracking-[0.12em] uppercase">
                {snapshot.total === null
                  ? "Fewer than 5 people online right now"
                  : `${formatCount(snapshot.total)} people online right now`}
              </p>
              {busiest.length > 0 ? (
                <ol className="mt-5" aria-label="Busiest states">
                  {busiest.map((state, i) => (
                    <li key={state.code} className="flex items-baseline gap-3.5 border-t border-border py-3">
                      <span aria-hidden="true" className="w-5 font-mono text-xs text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-heading text-[26px] leading-tight">{stateName(state.code)}</span>
                      <span aria-hidden="true" className="min-w-4 flex-1 -translate-y-1.5 border-b border-dotted border-muted-foreground/60" />
                      <span className="font-mono text-[13px]">{formatCount(state.online)} online</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 border-t border-border pt-4 font-heading text-xl text-muted-foreground italic">
                  No state has 5 or more people online yet. Be one of the first from yours.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default LandingPresence;
