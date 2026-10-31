// Geometry of the European roulette wheel and the maths of the ball landing in the right pocket.
// Angles are in degrees, measured clockwise from the top of the wheel.

// Real European wheel order (0 at the top, then clockwise).
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const POCKETS = WHEEL_ORDER.length; // 37
export const SLOT_DEG = 360 / POCKETS;
export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const pocketIndex = (n: number): number => WHEEL_ORDER.indexOf(n);
// Middle of a pocket, measured on the wheel itself (not on the screen).
export const pocketCenterDeg = (index: number): number => (index + 0.5) * SLOT_DEG;

export const pocketColor = (n: number): 'green' | 'red' | 'black' => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');

export const polar = (cx: number, cy: number, r: number, deg: number): { x: number; y: number } => {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
};

// Ball angle (on the screen) at which a ball that started the landing at `ballFrom` ends up exactly
// in the pocket of `resultIndex`, given where the wheel will be when the landing is over.
// The ball runs against the wheel (its angle decreases) for about `idealTurnsDeg`, never fewer than
// two full turns, so the landing always looks like a real run-out and never like a snap.
export function landingBallAngle(ballFrom: number, wheelAtEnd: number, resultIndex: number, idealTurnsDeg = 900): number {
  const target = wheelAtEnd + pocketCenterDeg(resultIndex); // the pocket's angle on the screen, modulo 360
  const ideal = ballFrom - idealTurnsDeg;
  let angle = target + 360 * Math.round((ideal - target) / 360);
  const latest = ballFrom - 720;
  if (angle > latest) angle -= 360 * Math.ceil((angle - latest) / 360);
  return angle;
}

export const easeOutCubic = (u: number): number => 1 - Math.pow(1 - u, 3);
