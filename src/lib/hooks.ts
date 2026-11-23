// Store selectors shared by screens.
import { useMemo } from 'react';
import type { Budget, CreditData } from './finance';
import { useStore } from './store';

/** The cash-flow inputs plus the card data needed to price each month. */
export function useBudget(): { budget: Budget; credit: CreditData } {
  const fixed = useStore((s) => s.fixed);
  const oneOffs = useStore((s) => s.oneOffs);
  const overrides = useStore((s) => s.overrides);
  const instalments = useStore((s) => s.instalments);
  const loans = useStore((s) => s.loans);
  const txs = useStore((s) => s.txs);
  const statementDay = useStore((s) => s.settings.statementDay);
  return useMemo(
    () => ({ budget: { fixed, oneOffs, overrides, instalments, loans }, credit: { txs, statementDay } }),
    [fixed, oneOffs, overrides, instalments, loans, txs, statementDay],
  );
}
