import { useEffect, useState } from "react";
import api from "../api/api.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";

const SEARCH_DELAY_MS = 300;

const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name;

// Search box for finding people by username. Calls onMessageUser(user) when
// the user clicks "Message" on a result.
const UserSearch = ({ onMessageUser }) => {
  const [query, setQuery] = useState("");
  // The last finished search, with the query it belongs to. Results are only
  // shown when they match what is in the box right now.
  const [search, setSearch] = useState({ query: "", users: [], error: null });
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!trimmedQuery) {
      return;
    }

    // Debounce: wait until typing pauses, so "rahul" sends 1 request, not 5.
    // ignore: a slow answer for an older query must not replace a newer one.
    let ignore = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get("/users/search", { params: { q: trimmedQuery } });
        if (!ignore) setSearch({ query: trimmedQuery, users: res.data.users, error: null });
      } catch {
        if (!ignore) setSearch({ query: trimmedQuery, users: [], error: "Search failed. Please try again." });
      }
    }, SEARCH_DELAY_MS);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const hasResults = trimmedQuery !== "" && search.query === trimmedQuery;

  let status = null;
  if (trimmedQuery && !hasResults) status = "Searching...";
  else if (hasResults && search.error) status = search.error;
  else if (hasResults && search.users.length === 0) status = "No users found";

  return (
    <div>
      <label htmlFor="user-search">Find people</label>
      <br />
      <input
        id="user-search"
        type="search"
        placeholder="Search by username"
        autoComplete="off"
        maxLength={30}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* aria-live: screen readers announce "No users found" etc. */}
      <p aria-live="polite">{status}</p>

      {hasResults && search.users.length > 0 ? (
        <ul>
          {search.users.map((user) => (
            <li key={user._id}>
              {user.username}
              {stateName(user.state) ? ` · ${stateName(user.state)}` : ""}{" "}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  onMessageUser(user);
                }}
              >
                Message
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export default UserSearch;
