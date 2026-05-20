/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Lightweight Representation wrapper for transform-gizmo render objects,
 * enabling Canvas3D picking without state tree commits.
 */

import { Subject } from 'rxjs';
import { Representation } from '../../mol-repr/representation';
import { GraphicsRenderObject } from '../../mol-gl/render-object';
import { PickingId } from '../../mol-geo/geometry/picking';
import { Loci, EmptyLoci, isEveryLoci } from '../../mol-model/loci';
import { DataLoci } from '../../mol-model/loci';
import { MarkerAction, MarkerActions } from '../../mol-util/marker-action';
import { Visual } from '../../mol-repr/visual';
import { Interval } from '../../mol-data/int';
import { Theme } from '../../mol-theme/theme';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { BaseGeometry } from '../../mol-geo/geometry/base';
import { GizmoGroupId } from './geometry';

export const TransformGizmoLociTag = 'transform-gizmo';

export interface TransformGizmoLociData {
    objectId: number;
    groupId: GizmoGroupId;
    instanceId: number;
}

export function TransformGizmoLoci(data: TransformGizmoLociData) {
    return DataLoci(TransformGizmoLociTag, data, [{ groupId: data.groupId, instanceId: data.instanceId }],
        undefined,
        () => `Transform Gizmo | Object ${data.objectId} | Group ${data.groupId}`);
}

export function isTransformGizmoLoci(x: Loci): x is ReturnType<typeof TransformGizmoLoci> {
    return x.kind === 'data-loci' && x.tag === TransformGizmoLociTag;
}

export interface TransformGizmoRepresentation extends Representation<unknown, BaseGeometry.Params, Representation.State> {
    readonly renderObjects: ReadonlyArray<GraphicsRenderObject>;
}

export function createTransformGizmoRepresentation(
    label: string,
    renderObjects: GraphicsRenderObject[]
): TransformGizmoRepresentation {
    const updated = new Subject<number>();
    const state = Representation.createState();
    const theme = Theme.createEmpty();
    const params = PD.clone(BaseGeometry.Params);
    const props = PD.getDefaultValues(BaseGeometry.Params);

    let version = 0;

    const getLoci = (pickingId: PickingId): Loci => {
        for (const ro of renderObjects) {
            if (ro.id === pickingId.objectId) {
                const data: TransformGizmoLociData = {
                    objectId: pickingId.objectId,
                    groupId: pickingId.groupId as GizmoGroupId,
                    instanceId: pickingId.instanceId,
                };
                return TransformGizmoLoci(data);
            }
        }
        return EmptyLoci;
    };

    const eachGroup = (loci: Loci, apply: (interval: Interval) => boolean): boolean => {
        if (!isTransformGizmoLoci(loci)) return false;
        let changed = false;
        for (const ro of renderObjects) {
            if (ro.id === loci.data.objectId) {
                const groupCount = ro.values.uGroupCount.ref.value;
                const idx = loci.data.instanceId * groupCount + loci.data.groupId;
                if (apply(Interval.ofSingleton(idx))) changed = true;
            }
        }
        return changed;
    };

    const mark = (loci: Loci, action: MarkerAction): boolean => {
        if (!MarkerActions.is(MarkerActions.Highlighting, action)) return false;
        if (!isEveryLoci(loci)) {
            if (!isTransformGizmoLoci(loci)) return false;
        }
        let marked = false;
        for (const ro of renderObjects) {
            if (isEveryLoci(loci) || loci.data.objectId === ro.id) {
                marked = Visual.mark(ro, loci, action, eachGroup) || marked;
            }
        }
        return marked;
    };

    return {
        label,
        updated,
        get groupCount() {
            return renderObjects.reduce((sum, ro) => sum + ro.values.uGroupCount.ref.value, 0);
        },
        get renderObjects() {
            return renderObjects;
        },
        get geometryVersion() { return version; },
        get props() { return props; },
        get params() { return params; },
        get state() { return state; },
        get theme() { return theme; },
        createOrUpdate: () => {
            return { run: async () => {}, runInContext: async () => {}, id: '', name: '', params: {} } as any;
        },
        setState: (update: Partial<Representation.State>) => {
            Representation.updateState(state, update);
            for (const ro of renderObjects) {
                if (update.visible !== undefined) Visual.setVisibility(ro, update.visible);
                if (update.pickable !== undefined) Visual.setPickable(ro, update.pickable);
                if (update.alphaFactor !== undefined) Visual.setAlphaFactor(ro, update.alphaFactor);
                if (update.transform !== undefined) Visual.setTransform(ro, update.transform);
            }
        },
        setTheme: () => {},
        getLoci,
        getAllLoci: () => [],
        eachLocation: () => {},
        mark,
        destroy: () => {}
    };
}
