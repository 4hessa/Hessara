import type { Transition, Variants } from "motion/react";

/** Seconds and pixels; no continuous motion is implied by these tokens. */
export const motionTokens = {
  duration: { press: .12, quick: .18, state: .24, entrance: .42 },
  ease: { settle: [.22, 1, .36, 1] as [number, number, number, number] },
  spring: {
    control: { type: "spring", stiffness: 440, damping: 34, mass: .7 } satisfies Transition,
    navigation: { type: "spring", stiffness: 380, damping: 36, mass: .8 } satisfies Transition,
  },
  distance: { reveal: 8, feedback: 4 },
  stagger: { step: .04, maximum: .16 },
} as const;

export function sectionReveal(reducedMotion = false) {
  return {
    hidden: { opacity: reducedMotion ? 1 : .94, y: reducedMotion ? 0 : motionTokens.distance.reveal },
    visible: { opacity: 1, y: 0, transition: {
      duration: reducedMotion ? 0 : motionTokens.duration.entrance,
      ease: motionTokens.ease.settle,
    } },
  } satisfies Variants;
}

/** Apply only to controls whose transform is not already owned by CSS. */
export function controlVariants(reducedMotion = false) {
  const transition = reducedMotion ? { duration: 0 } : motionTokens.spring.control;
  return {
    rest: { scale: 1, transition },
    hover: { scale: reducedMotion ? 1 : 1.015, transition },
    pressed: { scale: reducedMotion ? 1 : .985, transition },
    disabled: { scale: 1, transition: { duration: 0 } },
  } satisfies Variants;
}

export function feedbackVariants(reducedMotion = false) {
  return {
    initial: { opacity: reducedMotion ? 1 : .94, y: reducedMotion ? 0 : motionTokens.distance.feedback },
    visible: { opacity: 1, y: 0, transition: {
      duration: reducedMotion ? 0 : motionTokens.duration.state,
      ease: motionTokens.ease.settle,
    } },
  } satisfies Variants;
}

/** Selection follows the real active section; it never drives navigation. */
export function navigationVariants(reducedMotion = false) {
  const transition = { duration: reducedMotion ? 0 : motionTokens.duration.quick };
  return {
    rest: { opacity: .76, transition },
    selected: { opacity: 1, transition },
  } satisfies Variants;
}
