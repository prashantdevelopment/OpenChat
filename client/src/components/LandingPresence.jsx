import { useEffect, useState } from "react";
import { Link } from "react-router";
import { UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const max = busiest[0]?.online ?? 1;

  return (
    <section aria-labelledby="presence-heading" className="border-y border-border bg-muted/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:items-center md:py-20">
        <div>
          <h2 id="presence-heading" className="text-2xl sm:text-3xl">
            Right now across India
          </h2>
          <p className="mt-3 max-w-prose text-muted-foreground">
            You can see how many people are online in each state, never who they are. Numbers under 5 are hidden, so
            nobody in a small group can be picked out.
          </p>
          <Button render={<Link to="/register" />} size="lg" className="mt-6">
            Join from your state
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6" aria-live="polite">
          {snapshot === null ? (
            <div className="space-y-3" aria-label="Loading online counts">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : snapshot === "error" ? (
            <p className="text-muted-foreground">Live counts aren't available right now. Please try again later.</p>
          ) : (
            <>
              <p className="flex items-center gap-2 font-heading text-lg font-semibold">
                <UsersIcon aria-hidden="true" className="size-5 text-primary" />
                {snapshot.total === null
                  ? "Fewer than 5 people online right now"
                  : `${formatCount(snapshot.total)} people online right now`}
              </p>
              {busiest.length > 0 ? (
                <ol className="mt-5 space-y-3" aria-label="Busiest states">
                  {busiest.map((state) => (
                    <li key={state.code}>
                      <div className="flex justify-between gap-3 text-sm">
                        <span>{stateName(state.code)}</span>
                        <span className="tabular-nums text-muted-foreground">{formatCount(state.online)} online</span>
                      </div>
                      <div aria-hidden="true" className="mt-1.5 h-2 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(state.online / max) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
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
