import { ChevronDownIcon } from "lucide-react";
import { INDIAN_STATES } from "../../../shared/indian-states.js";

const STATES = INDIAN_STATES.filter((state) => !state.unionTerritory);
const UNION_TERRITORIES = INDIAN_STATES.filter((state) => state.unionTerritory);

// Native <select> of the 28 states and 8 union territories, grouped. Native,
// so phones show their own picker and it works with every screen reader.
// Takes the usual select props (id, name, value, onChange, aria-*).
const StateSelect = (props) => (
  <div className="relative">
    <select {...props} className="w-full cursor-pointer appearance-none pr-10">
      <option value="">Select your state</option>
      <optgroup label="States">
        {STATES.map((state) => (
          <option key={state.code} value={state.code}>
            {state.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Union territories">
        {UNION_TERRITORIES.map((state) => (
          <option key={state.code} value={state.code}>
            {state.name}
          </option>
        ))}
      </optgroup>
    </select>
    <ChevronDownIcon
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
);

export default StateSelect;
