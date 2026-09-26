import { useEffect, useState } from "react";
import { computeSafetyNumber } from "../crypto/safetyNumber.js";

// "Verify encryption": shows the safety number for this conversation, to be
// compared with the other person (see crypto/safetyNumber.js for why).
// <details> is a native disclosure widget: keyboard and screen-reader friendly.
const SafetyNumber = ({ myPublicKey, peerPublicKey, peerName }) => {
  const [result, setResult] = useState({ forKeys: null, number: null });
  const keys = `${myPublicKey}|${peerPublicKey}`;

  useEffect(() => {
    if (!myPublicKey || !peerPublicKey) return;
    let ignore = false;
    computeSafetyNumber(myPublicKey, peerPublicKey).then((number) => {
      if (!ignore) setResult({ forKeys: keys, number });
    });
    return () => {
      ignore = true;
    };
  }, [myPublicKey, peerPublicKey, keys]);

  if (!myPublicKey || !peerPublicKey) {
    return null;
  }
  const number = result.forKeys === keys ? result.number : null;

  return (
    <details>
      <summary>Verify encryption with {peerName}</summary>
      <p>
        Messages with {peerName} are end-to-end encrypted. To make sure nobody is in the middle,
        compare this safety number with {peerName} in person or on a call. It must be exactly the
        same on both screens.
      </p>
      <p>
        <code aria-label="Safety number">{number ?? "Calculating..."}</code>
      </p>
      <p>If the numbers are different, don&apos;t share anything private in this chat.</p>
    </details>
  );
};

export default SafetyNumber;
