import { useState } from "react";
import MAP from "../data/india-map.json";
import { INDIAN_STATES } from "../../../shared/indian-states.js";
import { popupPlacement, stateFill } from "../lib/indiaMap.js";

const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name ?? code;
const countText = (online) => (online === null || online === undefined ? "fewer than 5 online" : `${online} online`);

// The map of India on Discover, printed in ink on paper: official Survey of
// India boundaries (data/india-map.json), each state tinted red by how many
// people are online there. Click or tap a state to choose it; the chosen one
// gets a heavy outline and a pin, and renderPopup() draws its card next to
// it. For pointer users: the list of states next to it is the accessible way
// to choose, so the drawing itself is described as one image.
const IndiaMap = ({ counts, selected, onSelect, renderPopup }) => {
  const [hovered, setHovered] = useState(null);
  const chosen = MAP.states.find((state) => state.code === selected);
  // The chosen state is drawn last, so its heavy outline isn't covered by a neighbour's.
  const ordered = chosen ? [...MAP.states.filter((state) => state !== chosen), chosen] : MAP.states;
  const place = chosen ? popupPlacement(chosen, MAP) : null;

  return (
    <div className="relative w-full" style={{ aspectRatio: `${MAP.width} / ${MAP.height}` }}>
      <svg
        viewBox={`0 0 ${MAP.width} ${MAP.height}`}
        role="img"
        aria-label="Map of India with each state tinted by how many people are online. Use the list of states to choose one."
        className="absolute inset-0 size-full overflow-visible"
      >
        {MAP.disputed.map((d, i) => (
          <path key={i} d={d} fill="var(--map-disputed)" stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        ))}
        {ordered.map((state) => {
          const isChosen = state === chosen;
          const isHovered = state.code === hovered;
          return (
            <path
              key={state.code}
              d={state.d}
              data-state={state.code}
              fillRule="evenodd"
              style={{ fill: stateFill(counts[state.code]) }}
              stroke="var(--foreground)"
              strokeOpacity={isChosen || isHovered ? 1 : 0.8}
              strokeWidth={isChosen ? 2.4 : isHovered ? 1.5 : 0.7}
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer transition-[fill] duration-500 ease-(--ease-out-soft)"
              onClick={() => onSelect(state.code)}
              onPointerEnter={() => setHovered(state.code)}
              onPointerLeave={() => setHovered((current) => (current === state.code ? null : current))}
            />
          );
        })}
        {chosen ? (
          <circle cx={chosen.cx} cy={chosen.cy} r={7} fill="var(--brand)" stroke="var(--background)" strokeWidth={4} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ) : null}
      </svg>

      {/* The hovered state's name and count, in the corner (pointer only; the
          list says the same for everyone). */}
      {hovered ? (
        <p aria-hidden="true" className="pointer-events-none absolute top-0 left-0 border border-border bg-card px-2.5 py-1 font-mono text-[11.5px] tracking-wide text-card-foreground">
          {stateName(hovered)} · {countText(counts[hovered])}
        </p>
      ) : null}

      {chosen && renderPopup ? renderPopup(chosen.code, place) : null}
    </div>
  );
};

export default IndiaMap;
