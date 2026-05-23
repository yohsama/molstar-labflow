/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { PluginContext } from '../../mol-plugin/context';
import { PluginStateObject as SO, PluginStateTransform } from '../../mol-plugin-state/objects';
import { RootStructureDefinition } from '../../mol-plugin-state/helpers/root-structure';
import { createStructureComponent, StaticStructureComponentType } from '../../mol-plugin-state/helpers/structure-component';
import { StateObject, StateTransformer } from '../../mol-state';
import { Task } from '../../mol-task';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { deepEqual } from '../../mol-util';
import { Model } from '../../mol-model/structure';

export const SplitRootStructure = PluginStateTransform.BuiltIn({
    name: 'labflow-split-root-structure',
    display: { name: 'Split Root Structure', description: 'Create a root-like semantic structure such as water, polymer, or ligand from an existing root structure definition.' },
    from: SO.Molecule.Model,
    to: SO.Molecule.Structure,
    params: () => ({
        rootType: PD.Value<RootStructureDefinition.Params>({ name: 'model', params: {} } as RootStructureDefinition.Params, { isHidden: true }),
        componentType: PD.Text<StaticStructureComponentType>('polymer', { isHidden: true }),
        label: PD.Text('', { isHidden: true }),
    })
})({
    apply({ a, params }, plugin: PluginContext) {
        return Task.create(`Split ${params.label || params.componentType}`, async ctx => {
            const base = await RootStructureDefinition.create(plugin, ctx, a.data, params.rootType);
            return createStructureComponent(base.data, {
                type: { name: 'static', params: params.componentType as StaticStructureComponentType },
                nullIfEmpty: true,
                label: params.label.trim(),
            }, { source: base.data });
        });
    },
    update: ({ a, b, oldParams, newParams }) => {
        if (!deepEqual(oldParams, newParams)) return StateTransformer.UpdateResult.Recreate;
        if (!SO.Molecule.Structure.is(b)) return StateTransformer.UpdateResult.Recreate;
        if (!b.data.model) return StateTransformer.UpdateResult.Recreate;
        if (!Model.areHierarchiesEqual(a.data, b.data.model)) return StateTransformer.UpdateResult.Recreate;
        return StateTransformer.UpdateResult.Unchanged;
    },
    dispose({ b }) {
        b?.data.customPropertyDescriptors.dispose();
    }
});
