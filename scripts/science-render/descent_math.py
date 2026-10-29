"""Standard-library teaching data for the optional Hessara ManimGL scene."""

from dataclasses import asdict, dataclass
import json
import math

CURVATURE = 1.6
LOSS_FLOOR = 0.12
INITIAL_X = 3.2
LEARNING_RATE = 0.18
STEPS = 7


def loss(x: float) -> float:
    """L(x) = 0.8 x² + 0.12, a scalar quadratic teaching objective."""
    return 0.5 * CURVATURE * x * x + LOSS_FLOOR


def gradient(x: float) -> float:
    return CURVATURE * x


@dataclass(frozen=True)
class DescentState:
    step: int
    x: float
    loss: float
    gradient: float


def descent_states(
    initial_x: float = INITIAL_X,
    learning_rate: float = LEARNING_RATE,
    steps: int = STEPS,
) -> tuple[DescentState, ...]:
    """Return the initial point and each discrete gradient-descent update.

    For this quadratic, 0 < eta < 2 / curvature contracts the distance from
    the minimizer. These bounds are specific to this objective.
    """
    if not math.isfinite(initial_x):
        raise ValueError("initial_x must be finite")
    if not math.isfinite(learning_rate) or not 0 < learning_rate < 2 / CURVATURE:
        raise ValueError("learning_rate must be between 0 and 1.25, exclusively")
    if isinstance(steps, bool) or not isinstance(steps, int) or not 1 <= steps <= 10000:
        raise ValueError("steps must be an integer between 1 and 10000")
    states = []
    x = initial_x
    for step in range(steps + 1):
        state = DescentState(step, x, loss(x), gradient(x))
        if not all(math.isfinite(value) for value in (state.x, state.loss, state.gradient)):
            raise ValueError("parameters produce a non-finite teaching value")
        states.append(state)
        x -= learning_rate * gradient(x)
    return tuple(states)


def check_calculations() -> dict:
    """Check the derivative, update rule, closed form and decreasing loss."""
    states = descent_states()
    epsilon = 1e-5
    for x in (-3.2, -0.7, 0.0, 0.7, 3.2):
        numerical_gradient = (loss(x + epsilon) - loss(x - epsilon)) / (2 * epsilon)
        if not math.isclose(gradient(x), numerical_gradient, rel_tol=1e-8, abs_tol=1e-8):
            raise AssertionError("analytic derivative differs from central difference")
    contraction = 1 - LEARNING_RATE * CURVATURE
    for state in states:
        expected = INITIAL_X * contraction ** state.step
        if not math.isclose(state.x, expected, rel_tol=1e-12, abs_tol=1e-12):
            raise AssertionError("iterates differ from the quadratic's closed form")
    for before, after in zip(states, states[1:]):
        expected = before.x - LEARNING_RATE * before.gradient
        if not math.isclose(after.x, expected, rel_tol=1e-12, abs_tol=1e-12):
            raise AssertionError("an iterate differs from the gradient update")
        if not after.loss < before.loss:
            raise AssertionError("the configured teaching trajectory must reduce loss")
    return {
        "status": "passed",
        "scope": "scalar teaching objective; not model training or benchmark data",
        "objective": "L(x) = 0.8*x^2 + 0.12",
        "derivative": "dL/dx = 1.6*x",
        "learning_rate": LEARNING_RATE,
        "contraction": contraction,
        "states": [asdict(state) for state in states],
    }


if __name__ == "__main__":
    print(json.dumps(check_calculations(), indent=2))
