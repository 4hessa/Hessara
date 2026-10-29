"use client";

import { useEffect, type ReactNode } from "react";
import { useAnimate } from "motion/react-mini";
import { useReducedMotion } from "motion/react";
import { feedbackVariants } from "@/lib/motion-tokens";

type MotionFeedbackProps = {
  children: ReactNode;
  eventKey: string;
  className?: string;
  role?: "status" | "alert";
};

/** Animate a genuine message/mode change without remounting fields or live regions. */
export function MotionFeedback({ children, eventKey, className, role }: MotionFeedbackProps) {
  const [scope, animateFeedback] = useAnimate<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const element = scope.current;
    if (!element || reducedMotion !== false || document.hidden) return;
    const variants = feedbackVariants();
    const original = { opacity: element.style.opacity, transform: element.style.transform };
    const baseTransform = getComputedStyle(element).transform;
    const atRest = baseTransform === "none" ? "none" : baseTransform;
    const restore = () => {
      element.style.opacity = original.opacity;
      element.style.transform = original.transform;
    };
    const control = animateFeedback(element, {
      opacity: [variants.initial.opacity, variants.visible.opacity],
      transform: [`translateY(${variants.initial.y}px)${atRest === "none" ? "" : ` ${atRest}`}`, atRest],
    }, variants.visible.transition);
    void control.then(restore);
    const finish = () => { control.stop(); restore(); };
    const visibility = () => { if (document.hidden) finish(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      finish();
    };
  }, [eventKey, reducedMotion, scope, animateFeedback]);
  return <div ref={scope} className={className} role={role} aria-atomic={role ? true : undefined}>{children}</div>;
}
