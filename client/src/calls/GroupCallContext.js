import { createContext, useContext } from "react";

// The group call I'm in, calls going on in my groups, and the actions (see GroupCallProvider.jsx).
export const GroupCallContext = createContext(null);

export const useGroupCall = () => useContext(GroupCallContext);
