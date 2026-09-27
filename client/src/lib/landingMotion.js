import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

gsap.registerPlugin(ScrollTrigger);

const EASE = "power3.out";

// The landing page's motion, kept small on purpose: smooth scrolling (Lenis,
// driven by GSAP's clock so scroll-linked effects stay in step), the red glow
// behind the hero drifting a little slower than the page, and sections
// rising in as they scroll into view. Things already on screen when the page
// opens are left alone (no flash). Loaded only on the landing page and never
// with reduced motion (see Landing.jsx). Returns a function that undoes it all.
export const startLandingMotion = (root) => {
  const lenis = new Lenis({ autoRaf: false });
  lenis.on("scroll", ScrollTrigger.update);
  const tick = (time) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  const context = gsap.context(() => {
    gsap.to("[data-hero-glow]", {
      yPercent: 18,
      ease: "none",
      scrollTrigger: { trigger: "[data-hero]", start: "top top", end: "bottom top", scrub: true },
    });

    for (const section of gsap.utils.toArray("[data-reveal]")) {
      const items = gsap.utils.toArray(section.querySelectorAll("[data-reveal-item]")).filter((item) => !ScrollTrigger.isInViewport(item));
      if (!items.length) continue;
      gsap.from(items, {
        y: 28,
        opacity: 0,
        duration: 0.8,
        ease: EASE,
        stagger: 0.07,
        scrollTrigger: { trigger: items[0], start: "top 88%", once: true },
      });
    }
  }, root);

  return () => {
    context.revert();
    gsap.ticker.remove(tick);
    lenis.destroy();
  };
};
