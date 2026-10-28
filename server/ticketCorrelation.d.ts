export interface CorrelationInput {
  matchId: string;
  marketId: string;
  marketName: string;
  optionName: string;
  home?: string;
  away?: string;
  startTime?: string;
}

export function selectionFamilies(sel: CorrelationInput): Set<string>;
export function goalInterval(optionName: string): { min: number; max: number } | null;
export function findCorrelatedSelections(
  selections: CorrelationInput[],
): { first: CorrelationInput; second: CorrelationInput; family: string } | null;
