"""Original optional ManimGL scene; see the adjacent README before rendering.

Run from this directory so the standard-library data module is found:
    manimgl gradient_descent.py HessaraGradientDescent -w --video_dir renders
"""

from manimlib import (
    Arrow, Axes, Dot, DOWN, FadeIn, FadeOut, LEFT, Line, RIGHT, Scene,
    ShowCreation, Text, Transform, UpdateFromAlphaFunc, UP, VGroup, linear,
)

from descent_math import LEARNING_RATE, check_calculations, descent_states, gradient, loss

PALE = "#ABBAC5"
CINDER = "#24292E"
SLATE = "#626B7C"


class HessaraGradientDescent(Scene):
    """A scalar optimizer demonstration, with every displayed point computed."""

    default_camera_config = {"background_color": PALE}

    def construct(self):
        check_calculations()
        states = descent_states()
        title = Text("Small steps, lower loss", font="sans-serif", font_size=34, fill_color=CINDER, stroke_color=CINDER)
        title.to_edge(UP, buff=0.42).to_edge(LEFT, buff=0.7)
        subtitle = Text(
            "A computed scalar example · not model training",
            font="sans-serif", font_size=19, fill_color=CINDER, stroke_color=CINDER,
        )
        subtitle.next_to(title, DOWN, buff=0.15).align_to(title, LEFT)
        axes = Axes(
            x_range=(-3.5, 3.5, 1), y_range=(0, 10, 2), width=7.9, height=4.65,
            axis_config={"stroke_color": SLATE, "stroke_width": 1.6, "include_tip": False},
        )
        axes.move_to(LEFT * 1.8 + DOWN * 0.55)
        curve = axes.get_graph(loss, x_range=(-3.4, 3.4, 0.05), fill_color=CINDER, stroke_color=CINDER, stroke_width=3)
        x_label = Text("x", font="sans-serif", font_size=20, fill_color=CINDER, stroke_color=CINDER)
        x_label.next_to(axes.x_axis, RIGHT, buff=0.14)
        y_label = Text("L(x)", font="sans-serif", font_size=20, fill_color=CINDER, stroke_color=CINDER)
        y_label.next_to(axes.y_axis, UP, buff=0.14)
        origin_label = Text("0", font="sans-serif", font_size=15, fill_color=CINDER, stroke_color=CINDER)
        origin_label.next_to(axes.c2p(0, 0), DOWN + LEFT, buff=0.12)
        explanation = VGroup(
            Text("L(x) = 0.8 x^2 + 0.12", font="sans-serif", font_size=23, fill_color=CINDER, stroke_color=CINDER),
            Text("dL/dx = 1.6 x", font="sans-serif", font_size=23, fill_color=CINDER, stroke_color=CINDER),
            Text(f"eta = {LEARNING_RATE:.2f}", font="sans-serif", font_size=23, fill_color=CINDER, stroke_color=CINDER),
            Text("x_next = x - eta * dL/dx", font="sans-serif", font_size=19, fill_color=CINDER, stroke_color=CINDER),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.24)
        explanation.move_to(RIGHT * 4.25 + UP * 0.45)

        def readout(state):
            group = VGroup(
                Text(f"Step {state.step} / {states[-1].step}", font="sans-serif", font_size=22, fill_color=CINDER, stroke_color=CINDER),
                Text(f"x = {state.x:.3f}", font="sans-serif", font_size=22, fill_color=CINDER, stroke_color=CINDER),
                Text(f"L = {state.loss:.3f}", font="sans-serif", font_size=22, fill_color=CINDER, stroke_color=CINDER),
            ).arrange(DOWN, aligned_edge=LEFT, buff=0.16)
            group.next_to(explanation, DOWN, buff=0.52).align_to(explanation, LEFT)
            return group

        point = Dot(axes.c2p(states[0].x, states[0].loss), radius=0.085, fill_color=CINDER, stroke_color=CINDER)
        values = readout(states[0])
        footer = Text(
            "Dots: discrete updates. Motion between dots: interpolation along the loss curve.",
            font="sans-serif", font_size=16, fill_color=CINDER, stroke_color=CINDER,
        ).to_edge(DOWN, buff=0.3)
        self.add(title, subtitle, axes, curve, x_label, y_label, origin_label, explanation, values, point, footer)
        self.wait(0.7)
        history = []
        for before, after in zip(states, states[1:]):
            half_span = 0.23
            tangent = Line(
                axes.c2p(before.x - half_span, before.loss - gradient(before.x) * half_span),
                axes.c2p(before.x + half_span, before.loss + gradient(before.x) * half_span),
                color=SLATE, stroke_width=2.2,
            )
            step_arrow = Arrow(
                axes.c2p(before.x, 0.35), axes.c2p(after.x, 0.35),
                buff=0, color=SLATE, stroke_width=2,
            )
            history_dot = Dot(axes.c2p(before.x, before.loss), radius=0.045, color=SLATE)
            history.append(history_dot)
            self.add(history_dot)
            self.play(FadeIn(tangent), FadeIn(step_arrow), run_time=0.2)

            def follow_curve(mobject, alpha, start=before.x, end=after.x):
                x = start + (end - start) * alpha
                mobject.move_to(axes.c2p(x, loss(x)))

            self.play(
                UpdateFromAlphaFunc(point, follow_curve),
                run_time=0.75, rate_func=linear,
            )
            self.remove(values)
            values = readout(after)
            self.add(values)
            self.play(FadeOut(tangent), FadeOut(step_arrow), run_time=0.15)
        minimum = Dot(axes.c2p(0, loss(0)), radius=0.055, color=SLATE)
        minimum_label = Text("minimum at x = 0", font="sans-serif", font_size=17, fill_color=CINDER, stroke_color=CINDER)
        minimum_label.next_to(minimum, UP + LEFT, buff=0.2)
        self.play(FadeIn(minimum), FadeIn(minimum_label), run_time=0.4)
        self.wait(0.6)

        # Return along the curve as illustration, not an optimizer update. The
        # opening and closing static states match for a quiet, seamless loop.
        def reset_along_curve(mobject, alpha):
            x = states[-1].x + (states[0].x - states[-1].x) * alpha
            mobject.move_to(axes.c2p(x, loss(x)))

        self.play(
            FadeOut(VGroup(minimum, minimum_label, *history)),
            UpdateFromAlphaFunc(point, reset_along_curve),

            run_time=1.1, rate_func=linear,
        )
        self.remove(values)
        self.add(readout(states[0]))
        self.wait(0.7)



