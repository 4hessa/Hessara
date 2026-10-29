import type { animate } from "motion/mini";
import type { inView } from "motion";
import { motionTokens, sectionReveal } from "./motion-tokens.ts";

const revealSelector = [
  ".overview-composition > *", ".workspace-start", ".assistant-gallery-heading",
  ".assistant-card", ".assistant-workbench", ".decision-studio", ".agent-directory",
  ".student-notebook", ".nvidia-start", ".explore-section",
].join(", ");

/** One owner per block. All content is visible before JavaScript runs. */
export function startSectionMotion(
  panel: HTMLElement,
  animateElement: typeof animate,
  observeInView: typeof inView,
  environment: { window: Window; document: Document } = { window, document },
) {
  const { window: view, document: page } = environment;
  const preference = view.matchMedia("(prefers-reduced-motion: reduce)");
  const candidates = Array.from(panel.querySelectorAll<HTMLElement>(revealSelector));
  const blocks = candidates.length
    ? candidates.filter(element => !candidates.some(parent => parent !== element && parent.contains(element)))
    : [panel];
  const seen = new Set<HTMLElement>();
  const running = new Map<ReturnType<typeof animate>, { element: HTMLElement; opacity: string; transform: string }>();
  let stopObserving = () => {};
  let disposed = false;

  const restore = (control: ReturnType<typeof animate>) => {
    const original = running.get(control);
    if (!original) return;
    original.element.style.opacity = original.opacity;
    original.element.style.transform = original.transform;
    running.delete(control);
  };
  const finish = () => {
    for (const control of Array.from(running.keys())) {
      control.stop();
      restore(control);
    }
  };
  const observe = () => {
    stopObserving();
    finish();
    if (disposed || preference.matches || page.hidden) return;
    const pending = blocks.filter(element => !seen.has(element));
    if (!pending.length) return;
    stopObserving = observeInView(pending, target => {
      if (disposed || preference.matches || page.hidden) return;
      const element = target as HTMLElement;
      seen.add(element);
      const styles = view.getComputedStyle(panel);
      const variants = sectionReveal();
      const duration = Math.max(.12, Math.min(.7,
        (parseFloat(styles.getPropertyValue("--hessara-duration-entrance")) || motionTokens.duration.entrance * 1000) / 1000));
      const distance = Math.max(0, Math.min(12,
        parseFloat(styles.getPropertyValue("--hessara-reveal-distance")) || variants.hidden.y));
      const baseTransform = view.getComputedStyle(element).transform;
      const atRest = baseTransform === "none" ? "none" : baseTransform;
      const start = `translateY(${distance}px)${atRest === "none" ? "" : ` ${atRest}`}`;
      const original = { element, opacity: element.style.opacity, transform: element.style.transform };
      const control = animateElement(element, {
        opacity: [variants.hidden.opacity, variants.visible.opacity],
        transform: [start, atRest],
      }, {
        duration,
        ease: motionTokens.ease.settle,
        delay: Math.min(blocks.indexOf(element) * motionTokens.stagger.step, motionTokens.stagger.maximum),
      });
      running.set(control, original);
      void control.then(() => restore(control));
    }, { margin: "0px 0px -24px 0px", amount: "some" });
  };
  preference.addEventListener("change", observe);
  page.addEventListener("visibilitychange", observe);
  observe();
  return () => {
    disposed = true;
    stopObserving();
    preference.removeEventListener("change", observe);
    page.removeEventListener("visibilitychange", observe);
    finish();
  };
}
