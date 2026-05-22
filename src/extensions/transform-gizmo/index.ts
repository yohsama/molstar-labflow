/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Transform Gizmo Extension for Mol*.
 */

import { PluginContext } from '../../mol-plugin/context';
import { PluginBehavior } from '../../mol-plugin/behavior/behavior';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { TransformObjectManager } from './manager';
import { TransformInteractionHandler } from './interaction';

export { TransformObjectManager } from './manager';
export { TransformInteractionHandler } from './interaction';
export { TransformState, OrientedBoxState } from './math';
export type { BoxObjectHandle, BoxStyle, MolecularObjectStateSnapshot, MolecularObjectTarget, PoseObjectSourceKind, PoseObjectStateSnapshot, PoseObjectTarget, RootStructureStateSnapshot, TransformObjectEvents, TransformObjectKind, TransformObjectStateSnapshot } from './manager';
export type { TransformPickTarget, TransformInteractionState } from './interaction';

export const TransformGizmoParams = {
    enabled: PD.Boolean(true, { description: 'Enable transform gizmo interactions' }),
    defaultMode: PD.Select('view', PD.arrayToOptions(['view', 'transform'] as const), { description: 'Default interaction mode' }),
};
export type TransformGizmoParams = typeof TransformGizmoParams;
export type TransformGizmoProps = PD.Values<TransformGizmoParams>;

const managerMap = new WeakMap<PluginContext, TransformObjectManager>();

export function getTransformObjectManager(ctx: PluginContext): TransformObjectManager | undefined {
    return managerMap.get(ctx);
}

export const TransformGizmoBehavior = PluginBehavior.create<TransformGizmoProps>({
    name: 'extension-transform-gizmo',
    category: 'interaction',
    display: {
        name: 'Transform Gizmo',
        description: '3D transform gizmos for interactive object manipulation'
    },
    ctor: class extends PluginBehavior.Handler<TransformGizmoProps> {
        private manager!: TransformObjectManager;
        private interaction!: TransformInteractionHandler;

        register(): void {
            const ctx = this.ctx;
            let manager = managerMap.get(ctx);
            if (!manager) {
                manager = new TransformObjectManager(ctx);
                managerMap.set(ctx, manager);
            }
            this.manager = manager;
            this.manager.enableControls(this.params.enabled);
            this.manager.setActiveObject(undefined);
            this.manager.setMode('view');

            this.interaction = new TransformInteractionHandler(ctx, this.manager);
            this.interaction.start();
        }

        update(params: TransformGizmoProps) {
            const changed = super.update(params);
            if (changed) {
                this.manager.enableControls(params.enabled);
                if (!params.enabled) this.manager.setMode('view');
            }
            return changed;
        }

        unregister() {
            if (this.interaction) {
                this.interaction.stop();
            }
        }

        dispose() {
            if (this.interaction) {
                this.interaction.stop();
            }
            if (this.manager) {
                this.manager.dispose();
                managerMap.delete(this.ctx);
            }
            super.dispose();
        }
    },
    params: () => TransformGizmoParams,
    canAutoUpdate: () => true,
});
