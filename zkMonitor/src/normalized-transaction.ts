import * as ledger from '@midnight-ntwrk/ledger-v8';
import type { WalletFacade, UnboundTransactionRecipe } from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnboundTransaction } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';

type BalanceSecretKeys = {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
};

type BalanceOptions = {
  ttl: Date;
};

/**
 * Finalize a proven contract-call transaction plus its balancing fee tx in the
 * ledger-normalized order expected by Midnight nodes.
 *
 * WalletFacade.finalizeRecipe() currently merges UNBOUND_TRANSACTION recipes as
 * contractTx.merge(feeTx). For circuit-call transactions this can place the
 * guaranteed DUST fee segment after the fallible contract-call segment, and the
 * node rejects it as InvalidTransaction::Custom(117) / NotNormalized.
 *
 * The normalized order is fee first, then the contract call:
 *   [G_fee, G_contract, F_contract]
 */
export async function finalizeUnboundTransactionNormalized(
  wallet: WalletFacade,
  recipe: UnboundTransactionRecipe,
): Promise<ledger.FinalizedTransaction> {
  const finalizedContract = recipe.baseTransaction.bind() as ledger.FinalizedTransaction;

  if (!recipe.balancingTransaction) {
    return finalizedContract;
  }

  const provenFee = await wallet.provingService.prove(recipe.balancingTransaction);
  const finalizedFee = provenFee.bind() as ledger.FinalizedTransaction;

  return finalizedFee.merge(finalizedContract) as ledger.FinalizedTransaction;
}

export async function balanceAndFinalizeUnboundTransactionNormalized(
  wallet: WalletFacade,
  tx: UnboundTransaction,
  secretKeys: BalanceSecretKeys,
  options: BalanceOptions,
): Promise<ledger.FinalizedTransaction> {
  const recipe = await wallet.balanceUnboundTransaction(tx, secretKeys, options);
  return finalizeUnboundTransactionNormalized(wallet, recipe);
}
