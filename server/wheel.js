// "Rrota e Fatit": a 24-segment wheel, one spin pays stake x the multiplier of the segment it stops on. Every segment is
// equally likely (fair crypto draw); the house edge is only in the table below. RTP = sum(multipliers) / 24.
export const WHEEL_SEGMENTS = [
  0, 0.5, 0, 1.5, 0, 0.5, 0, 2, 0, 0.5, 0, 4,
  0, 0.5, 0, 1, 0, 0.5, 0, 3, 0, 8, 0, 0.5,
];
export const wheelRtp = () => WHEEL_SEGMENTS.reduce((a, b) => a + b, 0) / WHEEL_SEGMENTS.length;
export const wheelSpin = (rng) => { const index = rng(WHEEL_SEGMENTS.length); return { index, multiplier: WHEEL_SEGMENTS[index] }; };
