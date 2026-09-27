import { useEffect, useState } from "react";
import { LockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeSafetyNumber } from "../crypto/safetyNumber.js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// "End-to-end encrypted" in the chat header. Opens a dialog with the safety
// number, to be compared with the other person (see crypto/safetyNumber.js).
const SafetyNumber = ({ myPublicKey, peerPublicKey, peerName, className }) => {
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
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn("inline-flex cursor-pointer items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground", className)}
          />
        }
      >
        <LockIcon aria-hidden="true" className="size-3" />
        End-to-end encrypted
      </DialogTrigger>

      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Verify encryption with {peerName}</DialogTitle>
          <DialogDescription>
            Messages with {peerName} are end-to-end encrypted. To make sure nobody is in the middle,
            compare this safety number with {peerName} in person or on a call. It must be exactly the
            same on both screens.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <label htmlFor="safety-number" className="text-sm font-medium">
            Safety number
          </label>
          {/* <output>: the result of a calculation. 3 rows of 4 groups, so it is
              easy to compare line by line. */}
          <output
            id="safety-number"
            className="mt-2 grid grid-cols-4 gap-x-4 gap-y-2 rounded-lg bg-muted p-4 text-center font-mono text-base tracking-wider"
          >
            {number
              ? number.split(" ").map((group, i) => <span key={i}>{group} </span>)
              : <span className="col-span-4">Calculating...</span>}
          </output>
          <p className="mt-4 text-sm text-muted-foreground">
            If the numbers are different, don&apos;t share anything private in this chat.
          </p>
        </DialogPanel>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};

export default SafetyNumber;
