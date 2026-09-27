import { useLayoutEffect, useRef } from "react";

// When a list item's position changes (e.g. a new message moves a chat to
// the top), it slides from where it was instead of jumping ("FLIP": measure,
// then animate the difference with a transform). Uses the browser's own Web
// Animations API, so the list needs no layout-animation library. Nothing
// moves with reduced motion.
export const useSlideOnMove = () => {
  const ref = useRef(null);
  const lastTop = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const top = element.offsetTop;
    const previous = lastTop.current;
    lastTop.current = top;
    if (previous === null || previous === top) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "none" }], {
      duration: 200,
      easing: "ease-out",
    });
  });
  return ref;
};
