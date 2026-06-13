/**
 * Off-chain witness functions for the ZKSplunk anonymous-attestation contract.
 *
 * The contract declares two witnesses:
 *   - localSecretKey(): Bytes<32>
 *       The operator's secret key. Never leaves the prover's machine; the
 *       circuit derives the operator's membership-tree leaf and a scoped
 *       nullifier from it, disclosing neither the key nor the leaf.
 *   - operatorPath(leaf): MerkleTreePath<16, Bytes<32>>
 *       The Merkle authentication path proving `leaf` is a member of the
 *       on-chain `operators` HistoricMerkleTree. The circuit recomputes the
 *       root from this path and checks it against the tree WITHOUT revealing
 *       which leaf/position was used.
 *
 * Types are kept in lock-step with the compiler-generated `Witnesses<PS>` type
 * in managed/zksplunk/contract/index.d.ts:
 *
 *   localSecretKey(ctx: WitnessContext<Ledger, PS>): [PS, Uint8Array]
 *   operatorPath(ctx: WitnessContext<Ledger, PS>, leaf_0: Uint8Array):
 *       [PS, MerkleTreePath<Uint8Array>]
 */

import type { WitnessContext, MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../managed/zksplunk/contract/index.js';

/**
 * The ZKSplunk operator private state carried by every operator client.
 *
 *   secretKey:        the operator's 32-byte secret. Its membership-tree leaf is
 *                     persistentHash("zksplunk:op:commit:", secretKey), computed
 *                     in-circuit; the admin must have previously registered that
 *                     same leaf via registerOperator().
 *   operatorLeafIndex: optional — the leaf index this operator occupies in the
 *                     `operators` tree, if known. When present we can use the
 *                     O(log n) `pathForLeaf(index, leaf)`; otherwise we fall
 *                     back to the O(n) `findPathForLeaf(leaf)` scan.
 */
export interface ZkSplunkPrivateState {
  readonly secretKey: Uint8Array; // 32 bytes
  readonly operatorLeafIndex?: bigint;
}

/**
 * Factory for the operator private state.
 */
export const createZkSplunkPrivateState = (
  secretKey: Uint8Array,
  operatorLeafIndex?: bigint,
): ZkSplunkPrivateState => ({ secretKey, operatorLeafIndex });

export const witnesses = {
  /**
   * Provide the operator's 32-byte secret key to the circuit. The circuit
   * derives the membership-tree leaf and the per-incident nullifier from it.
   */
  localSecretKey(
    context: WitnessContext<Ledger, ZkSplunkPrivateState>,
  ): [ZkSplunkPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.secretKey];
  },

  /**
   * Provide the Merkle authentication path proving `leaf` is a member of the
   * on-chain `operators` tree.
   *
   * The path is read from the contract's own ledger state (the prover keeps a
   * local synced copy). If the operator's leaf index is known we use the
   * O(log n) `pathForLeaf`; otherwise we scan with `findPathForLeaf`. If the
   * leaf is not present, proving must fail loudly here rather than emit an
   * invalid path — so we throw, which aborts proof generation client-side.
   */
  operatorPath(
    context: WitnessContext<Ledger, ZkSplunkPrivateState>,
    leaf: Uint8Array,
  ): [ZkSplunkPrivateState, MerkleTreePath<Uint8Array>] {
    const { ledger, privateState } = context;

    const path =
      privateState.operatorLeafIndex !== undefined
        ? ledger.operators.pathForLeaf(privateState.operatorLeafIndex, leaf)
        : ledger.operators.findPathForLeaf(leaf);

    if (path === undefined) {
      throw new Error(
        'operatorPath: operator leaf is not present in the on-chain operators ' +
          'tree — this operator has not been registered (or the local tree copy ' +
          'is out of sync). Cannot produce a membership proof.',
      );
    }

    return [privateState, path];
  },
};
