import test from "node:test";
import assert from "node:assert/strict";
import { startSectionMotion } from "../lib/section-motion-controller.ts";
import { controlVariants, feedbackVariants, navigationVariants, sectionReveal } from "../lib/motion-tokens.ts";

function fixture({ reduced = false, nested = false } = {}) {
  class TrackedTarget extends EventTarget {
    handlers = new Map();
    addEventListener(name, callback, options) {
      super.addEventListener(name, callback, options);
      if (!this.handlers.has(name)) this.handlers.set(name, new Set());
      this.handlers.get(name).add(callback);
    }
    removeEventListener(name, callback, options) {
      super.removeEventListener(name, callback, options);
      this.handlers.get(name)?.delete(callback);
    }
    get count() { return [...this.handlers.values()].reduce((sum, entries) => sum + entries.size, 0); }
  }
  const elements = [0, 1, 2].map(index => ({ id: index, style: { opacity: "", transform: "" }, contains: () => false }));
  if (nested) elements[0].contains = element => element === elements[1];
  elements[0].style.transform = "scale(1.01)";
  elements[0].baseTransform = "matrix(1.01, 0, 0, 1.01, 0, 0)";
  const panel = { querySelectorAll: () => elements };
  const preference = new TrackedTarget(); preference.matches = reduced;
  const page = new TrackedTarget(); page.hidden = false;
  const view = { matchMedia: () => preference,
    getComputedStyle: element => ({ transform: element.baseTransform ?? "none", getPropertyValue: () => "" }) };
  const observations = [];
  const animations = [];
  const inView = (targets, callback) => {
    const observation = { targets: new Set(targets), callback, active: true };
    observations.push(observation);
    return () => { observation.active = false; };
  };
  const animate = (element, keyframes, options) => {
    const control = { element, keyframes, options, stopped: false, onComplete: undefined,
      stop() { this.stopped = true; },
      then(callback) { this.onComplete = callback; return Promise.resolve(); },
      complete() {
        element.style.opacity = String(keyframes.opacity.at(-1));
        element.style.transform = keyframes.transform.at(-1);
        this.onComplete?.();
      },
    };
    element.style.opacity = String(keyframes.opacity[0]);
    element.style.transform = keyframes.transform[0];
    animations.push(control);
    return control;
  };
  return { elements, panel, preference, page, view, observations, animations,
    start: () => startSectionMotion(panel, animate, inView, { window: view, document: page }),
    enter(element) {
      for (const observation of observations) if (observation.active && observation.targets.has(element)) {
        observation.targets.delete(element);
        observation.callback(element);
      }
    },
  };
}

test("reduced motion never hides or translates content, including a live preference change", () => {
  const browser = fixture({ reduced: true });
  const stop = browser.start();
  assert.equal(browser.observations.length, 0);
  assert.equal(browser.animations.length, 0);
  assert.equal(browser.elements[0].style.opacity, "");
  browser.preference.matches = false;
  browser.preference.dispatchEvent(new Event("change"));
  browser.enter(browser.elements[0]);
  assert.equal(browser.animations.length, 1);
  browser.preference.matches = true;
  browser.preference.dispatchEvent(new Event("change"));
  assert.equal(browser.animations[0].stopped, true);
  assert.equal(browser.elements[0].style.transform, "scale(1.01)");
  assert.equal(browser.elements[0].style.opacity, "");
  stop();
  assert.equal(browser.preference.count, 0);
  assert.equal(browser.page.count, 0);
});

test("visibility changes stop work, retain readable styles, and do not replay seen blocks", () => {
  const browser = fixture();
  const stop = browser.start();
  browser.enter(browser.elements[0]);
  browser.page.hidden = true;
  browser.page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(browser.animations[0].stopped, true);
  assert.equal(browser.elements[0].style.opacity, "");
  assert.equal(browser.observations.every(item => !item.active), true);
  browser.page.hidden = false;
  browser.page.dispatchEvent(new Event("visibilitychange"));
  browser.enter(browser.elements[0]);
  assert.equal(browser.animations.length, 1);
  browser.enter(browser.elements[1]);
  assert.equal(browser.animations.length, 2);
  stop();
  assert.equal(browser.animations[1].stopped, true);
  assert.equal(browser.elements[1].style.opacity, "");
  assert.equal(browser.observations.every(item => !item.active), true);
  assert.equal(browser.preference.count + browser.page.count, 0);
});

test("nested candidates have one owner and completed animations restore prior transforms", () => {
  const browser = fixture({ nested: true });
  const stop = browser.start();
  assert.equal(browser.observations[0].targets.has(browser.elements[1]), false);
  browser.enter(browser.elements[0]);
  const animation = browser.animations[0];
  assert.match(animation.keyframes.transform[0], /^translateY\(8px\) matrix/);
  assert.equal(animation.keyframes.opacity[0], .94);
  assert.ok(animation.options.duration <= .7);
  assert.ok(animation.options.delay <= .16);
  animation.complete();
  assert.equal(browser.elements[0].style.transform, "scale(1.01)");
  assert.equal(browser.elements[0].style.opacity, "");
  stop();
});

test("shared reduced-motion variants resolve at rest without travel or spring feedback", () => {
  assert.equal(sectionReveal(true).hidden.y, 0);
  assert.equal(sectionReveal(true).hidden.opacity, 1);
  assert.equal(feedbackVariants(true).initial.y, 0);
  assert.equal(controlVariants(true).hover.scale, 1);
  assert.equal(controlVariants(true).pressed.scale, 1);
  assert.equal(controlVariants(true).pressed.transition.duration, 0);
  assert.equal(navigationVariants(true).selected.transition.duration, 0);
});
