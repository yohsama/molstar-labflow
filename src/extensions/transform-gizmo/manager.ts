/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * TransformObjectManager: create, update, and destroy transformable objects
 * and their gizmos directly on the Canvas3D scene without state tree commits.
 */

import { PluginContext } from '../../mol-plugin/context';
import { Canvas3D } from '../../mol-canvas3d/canvas3d';
import { GraphicsRenderObject } from '../../mol-gl/render-object';
import { Shape } from '../../mol-model/shape';
import { Structure, StructureElement } from '../../mol-model/structure';
import { Vec3, Mat4, Quat } from '../../mol-math/linear-algebra';
import { Color } from '../../mol-util/color';
import { ColorNames } from '../../mol-util/color/names';
import { ValueCell } from '../../mol-util';
import { Subject } from 'rxjs';
import { Representation } from '../../mol-repr/representation';
import { PluginStateObject } from '../../mol-plugin-state/objects';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { StructureComponentRef, StructureRef } from '../../mol-plugin-state/manager/structure/hierarchy-state';
import { structureAreEqual } from '../../mol-model/structure/query/utils/structure-set';
import { StructureFocusRepresentationTags } from '../../mol-plugin/behavior/dynamic/selection/structure-focus-representation';
import { StateObject } from '../../mol-state';

import { OrientedBoxState, TransformState } from './math';
import { createBoxFaceMesh, createBoxEdgeLines, createGizmoMesh, GizmoGroup } from './geometry';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
import { Lines } from '../../mol-geo/geometry/lines/lines';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { createTransformGizmoRepresentation, TransformGizmoRepresentation } from './representation';
import { SplitRootStructure } from './split-root-structure';

// ---------- Style Types ----------

export interface BoxStyle {
    faceColor: Color;
    faceColorX: Color;
    faceColorY: Color;
    faceColorZ: Color;
    faceOpacity: number;
    edgeColor: Color;
    edgeOpacity: number;
    edgeSize: number;
    gizmoColorX: Color;
    gizmoColorY: Color;
    gizmoColorZ: Color;
    gizmoOpacity: number;
}

export const DefaultBoxStyle: BoxStyle = {
    faceColor: ColorNames.blue,
    faceColorX: ColorNames.red,
    faceColorY: ColorNames.green,
    faceColorZ: ColorNames.blue,
    faceOpacity: 0.18,
    edgeColor: ColorNames.blue,
    edgeOpacity: 0.8,
    edgeSize: 2,
    gizmoColorX: ColorNames.red,
    gizmoColorY: ColorNames.green,
    gizmoColorZ: ColorNames.blue,
    gizmoOpacity: 0.85,
};

export function getBoxFaceGroupColor(style: BoxStyle, groupId: number): Color {
    switch (groupId) {
        case GizmoGroup.FacePosX:
        case GizmoGroup.FaceNegX:
            return style.faceColorX;
        case GizmoGroup.FacePosY:
        case GizmoGroup.FaceNegY:
            return style.faceColorY;
        case GizmoGroup.FacePosZ:
        case GizmoGroup.FaceNegZ:
            return style.faceColorZ;
        default:
            return style.faceColor;
    }
}

export function getGizmoGroupColor(style: BoxStyle, groupId: number): Color {
    switch (groupId) {
        case GizmoGroup.Center:
            return ColorNames.grey;
        case GizmoGroup.FacePosX: case GizmoGroup.FaceNegX:
        case GizmoGroup.FacePosY: case GizmoGroup.FaceNegY:
        case GizmoGroup.FacePosZ: case GizmoGroup.FaceNegZ:
            return ColorNames.yellow;
        case GizmoGroup.AxisX: case GizmoGroup.AxisArrowX:
        case GizmoGroup.RingX: case GizmoGroup.RingArrowX:
            return style.gizmoColorX;
        case GizmoGroup.AxisY: case GizmoGroup.AxisArrowY:
        case GizmoGroup.RingY: case GizmoGroup.RingArrowY:
            return style.gizmoColorY;
        case GizmoGroup.AxisZ: case GizmoGroup.AxisArrowZ:
        case GizmoGroup.RingZ: case GizmoGroup.RingArrowZ:
            return style.gizmoColorZ;
        default:
            return ColorNames.grey;
    }
}

// ---------- Events ----------

export interface TransformObjectEvents {
    readonly preview: Subject<{ objectId: string; transform: TransformState }>;
    readonly commit: Subject<{ objectId: string; transform: TransformState }>;
    readonly hover: Subject<{ objectId: string | undefined; groupId: number }>;
    readonly select: Subject<{ objectId: string | undefined }>;
    readonly changed: Subject<{ objectId: string | undefined; reason: TransformObjectChangeReason }>;
}

export function createTransformObjectEvents(): TransformObjectEvents {
    return {
        preview: new Subject(),
        commit: new Subject(),
        hover: new Subject(),
        select: new Subject(),
        changed: new Subject(),
    };
}

export type TransformObjectMode = 'view' | 'transform';
export type TransformObjectKind = 'box' | 'pose-object' | 'root-structure' | 'pose-complex';
export type PoseObjectSourceKind = 'structure' | 'component';
export type TransformObjectChangeReason = 'add' | 'remove' | 'select' | 'mode' | 'update' | 'preview' | 'commit' | 'sync' | 'split' | 'merge';

export interface BoxStateSnapshot {
    readonly id: string;
    readonly center: Vec3;
    readonly size: Vec3;
    readonly rotation: Quat;
    readonly isActive: boolean;
}
export type ActiveBoxStateSnapshot = BoxStateSnapshot;

export interface PoseObjectTarget {
    readonly id?: string;
    readonly sourceKind: PoseObjectSourceKind;
    readonly label: string;
    readonly sourceRef: string;
    readonly transformRef?: string;
    readonly center: Vec3;
    readonly baseCenter?: Vec3;
    readonly radius: number;
    readonly rotation?: Quat;
    readonly committedTransform?: Mat4;
    readonly sourceStructure?: Structure;
    readonly currentStructure?: Structure;
    readonly representations?: ReadonlyArray<Representation.Any>;
}

export interface PoseObjectStateSnapshot {
    readonly id: string;
    readonly kind: 'pose-object';
    readonly sourceKind: PoseObjectSourceKind;
    readonly sourceRef: string;
    readonly label: string;
    readonly position: Vec3;
    readonly rotation: Quat;
    readonly radius: number;
    readonly isActive: boolean;
}
export type MolecularObjectTarget = PoseObjectTarget;
export type MolecularObjectStateSnapshot = PoseObjectStateSnapshot;

export interface RootStructureStateSnapshot {
    readonly id: string;
    readonly kind: 'root-structure';
    readonly sourceRef: string;
    readonly label: string;
    readonly position: Vec3;
    readonly rotation: Quat;
    readonly matrix: Mat4;
    readonly radius: number;
    readonly isActive: boolean;
    readonly isLocked: boolean;
}

export interface PoseComplexStateSnapshot {
    readonly id: string;
    readonly kind: 'pose-complex';
    readonly label: string;
    readonly rootIds: readonly string[];
    readonly sourceRefs: readonly string[];
}

export interface TransformObjectStateSnapshot {
    readonly id: string;
    readonly kind: TransformObjectKind;
    readonly sourceKind?: PoseObjectSourceKind;
    readonly label: string;
    readonly position: Vec3;
    readonly rotation: Quat;
    readonly size?: Vec3;
    readonly radius?: number;
    readonly isActive: boolean;
}

// ---------- Internal Object Record ----------

interface BaseObjectRecord {
    id: string;
    style: BoxStyle;
    gizmoMesh: Mesh;
    gizmoRenderObject: GraphicsRenderObject<'mesh'>;
    gizmoRepr: TransformGizmoRepresentation;
    visible: boolean;
    gizmoVisible: boolean;
    gizmoScale: number;
}

interface BoxObjectRecord extends BaseObjectRecord {
    kind: 'box';
    state: OrientedBoxState;
    faceMesh: Mesh;
    faceRenderObject: GraphicsRenderObject<'mesh'>;
    faceRepr: TransformGizmoRepresentation;
    edgeLines: Lines;
    edgeRenderObject: GraphicsRenderObject<'lines'>;
    edgeRepr: TransformGizmoRepresentation;
}

interface PoseObjectRecord extends BaseObjectRecord {
    kind: 'pose-object';
    sourceKind: PoseObjectSourceKind;
    label: string;
    sourceRef: string;
    locked?: boolean;
    transformRef?: string;
    sourceStructure?: Structure;
    currentStructure?: Structure;
    state: TransformState;
    baseCenter: Vec3;
    previewBasePosition: Vec3;
    previewBaseRotation: Quat;
    committedTransform: Mat4;
    radius: number;
    representations: Representation.Any[];
}

interface RootStructureRecord extends BaseObjectRecord {
    kind: 'root-structure';
    label: string;
    sourceRef: string;
    locked: boolean;
    transformRef?: string;
    sourceStructure?: Structure;
    currentStructure?: Structure;
    state: TransformState;
    baseCenter: Vec3;
    previewBasePosition: Vec3;
    previewBaseRotation: Quat;
    committedTransform: Mat4;
    radius: number;
    representations: Representation.Any[];
}

type StructureTransformRecord = PoseObjectRecord | RootStructureRecord;
type ObjectRecord = BoxObjectRecord | StructureTransformRecord;

interface PoseComplexRecord {
    id: string;
    kind: 'pose-complex';
    label: string;
    rootIds: string[];
    sourceRefs: string[];
    matrices: Mat4[];
}

interface FocusPreviewRecord {
    repr: Representation.Any;
    resetTransform: boolean;
    restoreVisibility: boolean;
    wasVisible: boolean;
}

const tmpMat4 = Mat4.identity();
const tmpMat4b = Mat4.identity();
const tmpMat4c = Mat4.identity();
const tmpVec3 = Vec3.zero();
const tmpQuat = Quat.identity();
const MolecularTransformTag = 'labflow-object-transform';

// ---------- Manager ----------

export class TransformObjectManager {
    private objects = new Map<string, ObjectRecord>();
    private poseComplexes = new Map<string, PoseComplexRecord>();
    private poseObjectIdsBySource = new Map<string, string>();
    private rootObjectIdsBySource = new Map<string, string>();
    private authoredRootObjectIds = new Set<string>();
    private suppressedRootSourceRefs = new Set<string>();
    private splitProducedSourceRefs = new Set<string>();
    private focusPreviewReprs = new Map<Representation.Any, FocusPreviewRecord>();
    private focusPreviewObjectId: string | undefined;
    private activeObjectId: string | undefined;
    private mode: TransformObjectMode = 'view';
    private enabled = true;

    readonly events = createTransformObjectEvents();

    constructor(private plugin: PluginContext) {}

    private get canvas3d(): Canvas3D | undefined {
        return this.plugin.canvas3d;
    }

    addBox(center: Vec3, size: Vec3, rotation?: Quat, style?: Partial<BoxStyle>): BoxObjectHandle {
        const id = `box-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const boxState = OrientedBoxState.create(center, size, rotation);
        const fullStyle = { ...DefaultBoxStyle, ...style };

        const faceMesh = createBoxFaceMesh();
        const edgeLines = createBoxEdgeLines();
        const minDim = Math.min(boxState.size[0], boxState.size[1], boxState.size[2]);
        const gizmoScale = Math.max(minDim * 0.25, 2.0);
        const gizmoMesh = createGizmoMesh(gizmoScale);

        const faceShape = Shape.create('box-faces', {}, faceMesh,
            (groupId) => getBoxFaceGroupColor(fullStyle, groupId),
            () => 1,
            () => ''
        );

        const edgeShape = Shape.create('box-edges', {}, edgeLines,
            () => fullStyle.edgeColor,
            () => fullStyle.edgeSize,
            () => ''
        );

        const gizmoShape = Shape.create('gizmo', {}, gizmoMesh,
            (groupId) => getGizmoGroupColor(fullStyle, groupId),
            () => 1,
            () => ''
        );

        const faceRO = Shape.createRenderObject(faceShape, {
            ...PD.getDefaultValues(Mesh.Params),
            alpha: fullStyle.faceOpacity,
            ignoreLight: true,
            doubleSided: true,
            cellSize: 0,
            batchSize: 0,
        } as any) as any;

        const edgeRO = Shape.createRenderObject(edgeShape, {
            ...PD.getDefaultValues(Lines.Params),
            alpha: fullStyle.edgeOpacity,
            ignoreLight: true,
            cellSize: 0,
            batchSize: 0,
        } as any) as any;

        const gizmoRO = Shape.createRenderObject(gizmoShape, {
            ...PD.getDefaultValues(Mesh.Params),
            alpha: fullStyle.gizmoOpacity,
            ignoreLight: true,
            cellSize: 0,
            batchSize: 0,
        } as any) as any;

        const faceRepr = createTransformGizmoRepresentation('box-faces', [faceRO]);
        const edgeRepr = createTransformGizmoRepresentation('box-edges', [edgeRO]);
        const gizmoRepr = createTransformGizmoRepresentation('gizmo', [gizmoRO]);

        const c3d = this.canvas3d;
        if (c3d) {
            c3d.add(faceRepr);
            c3d.add(edgeRepr);
            c3d.add(gizmoRepr);
        }

        const record: ObjectRecord = {
            id,
            kind: 'box',
            state: boxState,
            style: fullStyle,
            faceMesh,
            faceRenderObject: faceRO,
            faceRepr,
            edgeLines,
            edgeRenderObject: edgeRO,
            edgeRepr,
            gizmoMesh,
            gizmoRenderObject: gizmoRO,
            gizmoRepr,
            visible: true,
            gizmoVisible: false,
            gizmoScale,
        };

        this.objects.set(id, record);
        this.syncGizmoVisibility(record);
        this.updateRenderTransform(record);
        this.emitChanged('add', id);

        return new BoxObjectHandleImpl(id, this);
    }

    removeObject(id: string) {
        const obj = this.objects.get(id);
        if (!obj) return;

        const c3d = this.canvas3d;
        if (c3d) {
            if (obj.kind === 'box') {
                c3d.remove(obj.faceRepr);
                c3d.remove(obj.edgeRepr);
            }
            c3d.remove(obj.gizmoRepr);
        }

        this.objects.delete(id);
        if (obj.kind === 'pose-object') {
            this.poseObjectIdsBySource.delete(this.getPoseSourceKey(obj.sourceKind, obj.sourceRef));
        } else if (obj.kind === 'root-structure') {
            this.rootObjectIdsBySource.delete(obj.sourceRef);
            this.authoredRootObjectIds.delete(obj.id);
        }
        if (this.activeObjectId === id) {
            this.activeObjectId = undefined;
            this.events.select.next({ objectId: undefined });
            this.emitChanged('select', undefined);
        }
        this.emitChanged('remove', id);
    }

    getObject(id: string): ObjectRecord | undefined {
        return this.objects.get(id);
    }

    setActiveObject(id: string | undefined) {
        if (this.activeObjectId === id) return;
        if (this.activeObjectId) {
            const prev = this.objects.get(this.activeObjectId);
            if (prev) {
                prev.gizmoVisible = false;
                this.syncGizmoVisibility(prev);
            }
        }
        this.activeObjectId = id;
        if (id) {
            const next = this.objects.get(id);
            if (next) {
                next.gizmoVisible = this.shouldShowGizmo(next);
                this.syncGizmoVisibility(next);
            }
        }
        this.events.select.next({ objectId: id });
        this.emitChanged('select', id);
    }

    setMode(mode: TransformObjectMode) {
        if (this.mode === mode) return;
        this.mode = mode;
        for (const obj of this.objects.values()) {
            obj.gizmoVisible = this.shouldShowGizmo(obj);
            this.syncGizmoVisibility(obj);
        }
        this.emitChanged('mode', this.activeObjectId);
    }

    enableControls(enabled: boolean) {
        this.enabled = enabled;
    }

    get isEnabled() {
        return this.enabled;
    }

    get activeId() {
        return this.activeObjectId;
    }

    getMode(): TransformObjectMode {
        return this.mode;
    }

    canSplitSourceRef(sourceRef: string): boolean {
        return !this.suppressedRootSourceRefs.has(sourceRef) && !this.splitProducedSourceRefs.has(sourceRef);
    }

    listSplittableRootStructureStates(): RootStructureStateSnapshot[] {
        return this.listRootStructureStates().filter(r => this.canSplitSourceRef(r.sourceRef));
    }

    getActiveBoxState(): ActiveBoxStateSnapshot | undefined {
        if (!this.activeObjectId) return undefined;
        const obj = this.objects.get(this.activeObjectId);
        if (!obj || obj.kind !== 'box') return undefined;
        return this.createBoxSnapshot(obj);
    }

    listBoxStates(): BoxStateSnapshot[] {
        const boxes: BoxStateSnapshot[] = [];
        for (const obj of this.objects.values()) {
            if (obj.kind === 'box') boxes.push(this.createBoxSnapshot(obj));
        }
        return boxes;
    }

    listPoseObjectStates(): PoseObjectStateSnapshot[] {
        const objects: PoseObjectStateSnapshot[] = [];
        for (const obj of this.objects.values()) {
            if (obj.kind === 'pose-object') objects.push(this.createPoseSnapshot(obj));
        }
        return objects;
    }

    listRootStructureStates(): RootStructureStateSnapshot[] {
        const objects: RootStructureStateSnapshot[] = [];
        for (const obj of this.objects.values()) {
            if (obj.kind === 'root-structure') objects.push(this.createRootStructureSnapshot(obj));
        }
        return objects;
    }

    listPoseComplexStates(): PoseComplexStateSnapshot[] {
        return Array.from(this.poseComplexes.values()).map(complex => ({
            id: complex.id,
            kind: complex.kind,
            label: complex.label,
            rootIds: Array.from(complex.rootIds),
            sourceRefs: Array.from(complex.sourceRefs),
        }));
    }

    /** @deprecated Molecular targets must now be registered explicitly as pose objects. */
    listMolecularObjectStates(): MolecularObjectStateSnapshot[] {
        return this.listPoseObjectStates();
    }

    listObjectStates(): TransformObjectStateSnapshot[] {
        const objects: TransformObjectStateSnapshot[] = [];
        let boxIndex = 0;
        for (const obj of this.objects.values()) {
            if (obj.kind === 'box') {
                boxIndex += 1;
                objects.push({
                    id: obj.id,
                    kind: obj.kind,
                    label: `Box ${boxIndex}`,
                    position: Vec3.clone(obj.state.center),
                    rotation: Quat.clone(obj.state.rotation),
                    size: Vec3.clone(obj.state.size),
                    isActive: obj.id === this.activeObjectId,
                });
            } else if (obj.kind === 'pose-object') {
                objects.push({
                    id: obj.id,
                    kind: obj.kind,
                    sourceKind: obj.sourceKind,
                    label: obj.label,
                    position: Vec3.clone(obj.state.position),
                    rotation: Quat.clone(obj.state.rotation),
                    radius: obj.radius,
                    isActive: obj.id === this.activeObjectId,
                });
            } else if (obj.kind === 'root-structure') {
                objects.push({
                    id: obj.id,
                    kind: obj.kind,
                    sourceKind: 'structure',
                    label: obj.label,
                    position: Vec3.clone(obj.state.position),
                    rotation: Quat.clone(obj.state.rotation),
                    radius: obj.radius,
                    isActive: obj.id === this.activeObjectId,
                });
            }
        }
        for (const complex of this.poseComplexes.values()) {
            objects.push({
                id: complex.id,
                kind: complex.kind,
                label: complex.label,
                position: Vec3.zero(),
                rotation: Quat.identity(),
                isActive: false,
            });
        }
        return objects;
    }

    syncRootStructures(structures: ReadonlyArray<StructureRef>) {
        const seen = new Set<string>();
        for (const structure of structures) {
            if (this.suppressedRootSourceRefs.has(structure.cell.transform.ref)) continue;
            const id = this.createOrUpdateRootStructureObject(structure);
            if (id) seen.add(id);
        }

        // If no valid structures are seen, check the state tree directly before clearing
        // to avoid removing objects due to transient empty hierarchy during updates.
        if (seen.size === 0) {
            const data = this.plugin.state?.data;
            for (const obj of Array.from(this.objects.values())) {
                if (obj.kind !== 'root-structure' || this.authoredRootObjectIds.has(obj.id)) continue;
                const cell = data?.cells?.get(obj.sourceRef);
                if (cell && cell.obj && cell.obj !== StateObject.Null) {
                    // Source ref still exists in state tree; keep the object.
                    continue;
                }
                this.removeObject(obj.id);
            }
            return;
        }

        for (const obj of Array.from(this.objects.values())) {
            if (obj.kind === 'root-structure' && !seen.has(obj.id) && !this.authoredRootObjectIds.has(obj.id)) {
                this.removeObject(obj.id);
            }
        }
    }

    setRootStructureTransform(id: string, state: { position: Vec3; rotation: Quat }) {
        const obj = this.objects.get(id);
        if (!obj || obj.kind !== 'root-structure') return;
        if (obj.locked) return;
        obj.state.position = Vec3.clone(state.position);
        obj.state.rotation = Quat.clone(state.rotation);
        TransformState.recomputeMatrix(obj.state);
        this.updateRenderTransform(obj, true);
        void this.commitTransform(id, obj.state);
        this.emitChanged('update', id);
    }

    resetRootStructureTransform(id: string) {
        const obj = this.objects.get(id);
        if (!obj || obj.kind !== 'root-structure') return;
        if (obj.locked) return;
        obj.state.position = Vec3.clone(obj.baseCenter);
        obj.state.rotation = Quat.identity();
        obj.state.scale = Vec3.create(1, 1, 1);
        TransformState.recomputeMatrix(obj.state);
        this.updateRenderTransform(obj, true);
        void this.commitTransform(id, obj.state);
        this.emitChanged('update', id);
    }

    setRootStructureLocked(id: string, locked: boolean) {
        const obj = this.objects.get(id);
        if (!obj || obj.kind !== 'root-structure') return;
        if (obj.locked === locked) return;
        obj.locked = locked;
        obj.gizmoVisible = this.shouldShowGizmo(obj);
        this.syncGizmoVisibility(obj);
        this.emitChanged('update', id);
    }

    selectRootStructureFromLoci(loci: any): string | undefined {
        if (this.mode !== 'transform') return undefined;
        if (!StructureElement.Loci.is(loci)) return undefined;

        const root = this.resolveRootStructureFromLoci(loci);
        if (!root) return undefined;
        const id = this.createOrUpdateRootStructureObject(root);
        if (!id) return undefined;
        this.setActiveObject(id);
        return id;
    }

    async splitCurrentSelectionToRootObject(): Promise<string[] | undefined> {
        const hierarchy = (this.plugin as any).managers?.structure?.hierarchy;
        const roots = hierarchy?.selection?.structures as ReadonlyArray<StructureRef> | undefined;
        if (!roots || roots.length === 0) {
            this.plugin.log?.warn?.('No root structures are selected to split.');
            return undefined;
        }

        const ids: string[] = [];
        for (const root of roots) {
            const sourceRef = root.cell.transform.ref;
            if (this.suppressedRootSourceRefs.has(sourceRef)) continue;
            if (this.splitProducedSourceRefs.has(sourceRef)) continue;
            const splitIds = await this.splitStructureRoot(root);
            ids.push(...splitIds);
        }

        this.setActiveObject(undefined);
        this.setMode('view');
        if (ids.length > 0) {
            this.emitChanged('split', ids[0]);
            return ids;
        }
        this.plugin.log?.warn?.('No splittable root structures found in selection.');
        return undefined;
    }

    mergeRootStructuresToPoseComplex(options?: { label?: string; rootIds?: readonly string[] }): string | undefined {
        let roots: RootStructureRecord[];
        if (options?.rootIds) {
            roots = this.listRootStructureRecords(options.rootIds);
        } else {
            const selectedStructures = (this.plugin as any).managers?.structure?.hierarchy?.selection?.structures as ReadonlyArray<StructureRef> | undefined;
            if (!selectedStructures || selectedStructures.length < 2) {
                this.plugin.log?.warn?.('Merge needs at least two selected root structures.');
                return undefined;
            }
            const selectedIds = selectedStructures
                .map(s => this.rootObjectIdsBySource.get(s.cell.transform.ref))
                .filter((id): id is string => !!id);
            roots = this.listRootStructureRecords(selectedIds);
        }
        if (roots.length < 2) {
            this.plugin.log?.warn?.('Merge needs at least two root structures.');
            return undefined;
        }

        const id = `pose-complex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const record: PoseComplexRecord = {
            id,
            kind: 'pose-complex',
            label: options?.label ?? `Pose Complex ${this.poseComplexes.size + 1}`,
            rootIds: roots.map(root => root.id),
            sourceRefs: roots.map(root => root.sourceRef),
            matrices: roots.map(root => Mat4.clone(root.committedTransform)),
        };
        this.poseComplexes.set(id, record);
        for (const root of roots) {
            this.suppressedRootSourceRefs.add(root.sourceRef);
            this.removeObject(root.id);
        }
        this.addMergedRootStructureObject(id, record.label, roots);
        this.setActiveObject(undefined);
        this.setMode('view');
        this.refreshCurrentFocus();

        // Sync with hierarchy after merge to ensure un-merged roots stay visible
        const hierarchy = (this.plugin as any).managers?.structure?.hierarchy;
        this.syncRootStructures(hierarchy?.current?.structures ?? []);

        this.emitChanged('merge', id);
        return id;
    }

    private addAuthoredRootStructureObject(target: {
        sourceRef: string,
        label: string,
        sourceStructure: Structure,
        currentStructure: Structure,
        center: Vec3,
        baseCenter: Vec3,
        radius: number,
        representations?: ReadonlyArray<Representation.Any>,
    }): string {
        const id = this.rootObjectIdsBySource.get(target.sourceRef) ?? `root:${target.sourceRef}`;
        const existing = this.objects.get(id);
        const fullTarget = {
            id,
            kind: 'root-structure' as const,
            label: target.label,
            sourceRef: target.sourceRef,
            center: target.center,
            baseCenter: target.baseCenter,
            radius: target.radius,
            sourceStructure: target.sourceStructure,
            currentStructure: target.currentStructure,
            representations: target.representations ?? this.getRepresentationsBelowRef(target.sourceRef),
        };

        if (existing && existing.kind === 'root-structure') {
            this.updateRootStructureRecord(existing, fullTarget);
        } else {
            this.addStructureTransformObject(fullTarget);
        }

        this.rootObjectIdsBySource.set(target.sourceRef, id);
        this.authoredRootObjectIds.add(id);
        return id;
    }

    private async splitStructureRoot(root: StructureRef): Promise<string[]> {
        const modelRef = root.model?.cell.transform.ref;
        const data = this.plugin.state?.data;
        const rootType = (root.cell.transform.params as any)?.type ?? { name: 'model', params: {} };
        if (!modelRef || !data?.build || !data?.updateTree || !this.plugin.runTask) {
            this.plugin.log?.warn?.('Split requires a model-backed root structure.');
            return [];
        }

        const splitDefs = [
            { componentType: 'water', label: 'Water' },
            { componentType: 'polymer', label: 'Polymer' },
            { componentType: 'ligand', label: 'Ligand' },
        ] as const;

        const builder = data.build();
        const modelTo = builder.to(modelRef);
        const created: { ref: string }[] = [];
        for (const def of splitDefs) {
            const split = modelTo.apply(SplitRootStructure, {
                rootType,
                componentType: def.componentType,
                label: def.label,
            });
            created.push(split);
        }

        await this.plugin.runTask(data.updateTree(builder));
        const realized = !data.cells
            ? created
            : created.filter(split => {
                const cell = data.cells.get(split.ref);
                return !!cell && cell.obj !== StateObject.Null;
            });
        for (const split of realized) {
            await (this.plugin as any).builders?.structure?.representation?.applyPreset?.(split.ref, 'auto');
        }
        this.suppressedRootSourceRefs.add(root.cell.transform.ref);
        const rootId = this.rootObjectIdsBySource.get(root.cell.transform.ref);
        if (rootId) this.removeObject(rootId);
        for (const split of realized) {
            this.splitProducedSourceRefs.add(split.ref);
        }
        await (this.plugin as any).managers?.structure?.hierarchy?.remove?.([root], true);

        // Defer to next tick to ensure the hierarchy has fully synced after
        // the state-tree mutation, so that split structures are visible in
        // current.structures and can be added to the selection.
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        const hierarchy = (this.plugin as any).managers?.structure?.hierarchy;
        this.syncRootStructures(hierarchy?.current?.structures ?? []);

        // Explicitly add split-produced structures to hierarchy selection so that
        // Mol* selection/focus systems recognize them.
        const splitRefs = realized
            .map(split => hierarchy?.current?.structures?.find((s: any) => s.cell.transform.ref === split.ref))
            .filter(Boolean) as StructureRef[];
        if (splitRefs.length > 0 && hierarchy?.updateCurrent) {
            hierarchy.updateCurrent(splitRefs, 'add');
        }

        return realized.map(split => `root:${split.ref}`);
    }

    private addMergedRootStructureObject(id: string, label: string, roots: ReadonlyArray<RootStructureRecord>) {
        const center = Vec3.zero();
        const baseCenter = Vec3.zero();
        for (const root of roots) {
            Vec3.add(center, center, root.state.position);
            Vec3.add(baseCenter, baseCenter, root.baseCenter);
        }
        Vec3.scale(center, center, 1 / roots.length);
        Vec3.scale(baseCenter, baseCenter, 1 / roots.length);

        let radius = 1;
        for (const root of roots) {
            radius = Math.max(radius, Vec3.distance(center, root.state.position) + root.radius);
        }

        const syntheticStructure = {
            label,
            boundary: { sphere: { center: Vec3.clone(center), radius } },
        } as Structure;

        this.addAuthoredRootStructureObject({
            sourceRef: id,
            label,
            sourceStructure: syntheticStructure,
            currentStructure: syntheticStructure,
            center: Vec3.clone(center),
            baseCenter: Vec3.clone(baseCenter),
            radius,
            representations: [],
        });
    }

    private listRootStructureRecords(rootIds?: readonly string[]): RootStructureRecord[] {
        const allowed = rootIds ? new Set(rootIds) : undefined;
        const roots: RootStructureRecord[] = [];
        for (const obj of this.objects.values()) {
            if (obj.kind !== 'root-structure') continue;
            if (allowed && !allowed.has(obj.id)) continue;
            roots.push(obj);
        }
        return roots;
    }

    private collectComponentRepresentations(component: StructureComponentRef): Representation.Any[] {
        const reprs: Representation.Any[] = [];
        for (const repr of component.representations ?? []) {
            const data = repr.cell.obj?.data as any;
            if (data?.repr) reprs.push(data.repr);
        }
        for (const repr of component.genericRepresentations ?? []) {
            const data = repr.cell.obj?.data as any;
            if (data?.repr) reprs.push(data.repr);
        }
        return reprs;
    }

    createPoseObject(target: PoseObjectTarget): string {
        const id = target.id ?? this.getPoseObjectId(target.sourceKind, target.sourceRef);
        const sourceKey = this.getPoseSourceKey(target.sourceKind, target.sourceRef);
        const existingId = this.poseObjectIdsBySource.get(sourceKey);
        const existing = existingId ? this.objects.get(existingId) : undefined;

        if (existing && existing.kind === 'pose-object') {
            this.updatePoseRecord(existing, target);
            this.emitChanged('update', existing.id);
            return existing.id;
        }

        this.addPoseObject({ ...target, id });
        this.poseObjectIdsBySource.set(sourceKey, id);
        return id;
    }

    createPoseObjectFromComponent(component: StructureComponentRef, options?: { label?: string }): string | undefined {
        const source = component.cell.obj?.data;
        if (!source) return undefined;

        const transform = this.findTransformDecorator(component.cell.transform.ref);
        const current = transform?.obj?.data ?? source;
        if (!current) return undefined;

        const sphere = current.boundary.sphere;
        const sourceSphere = source.boundary.sphere;
        const representations = [
            ...component.representations.map(r => r.cell.obj?.data.repr).filter(Boolean),
            ...(component.genericRepresentations ?? []).map(r => (r.cell.obj?.data as any)?.repr).filter(Boolean)
        ] as Representation.Any[];

        return this.createPoseObject({
            sourceKind: 'component',
            label: options?.label ?? component.cell.obj?.label ?? 'Component',
            sourceRef: component.cell.transform.ref,
            transformRef: transform?.transform.ref,
            center: Vec3.clone(sphere.center),
            baseCenter: Vec3.clone(sourceSphere.center),
            radius: sphere.radius,
            rotation: this.rotationFromTransform(transform?.transform.params?.transform),
            committedTransform: this.matrixFromTransform(transform?.transform.params?.transform),
            sourceStructure: source,
            currentStructure: current,
            representations,
        });
    }

    createPoseObjectFromSelection(options?: { label?: string }): string | undefined {
        const structureManagers = (this.plugin as any).managers?.structure;
        const entries = structureManagers?.selection?.entries as Map<string, { structure?: any }> | undefined;
        const componentGroups = structureManagers?.hierarchy?.currentComponentGroups as ReadonlyArray<ReadonlyArray<StructureComponentRef>> | undefined;
        if (!entries || !componentGroups) return undefined;

        const selectedStructures = Array.from(entries.values()).map(e => e.structure).filter(Boolean);
        if (selectedStructures.length !== 1) return undefined;

        const selected = selectedStructures[0];
        let match: StructureComponentRef | undefined;
        for (const group of componentGroups) {
            for (const component of group) {
                const structure = component.cell.obj?.data;
                if (!structure || !structureAreEqual(structure, selected)) continue;
                if (match) return undefined;
                match = component;
            }
        }

        return match ? this.createPoseObjectFromComponent(match, options) : undefined;
    }

    enterPoseEditMode(id: string) {
        const obj = this.objects.get(id);
        if (!obj || obj.kind !== 'pose-object') return;
        this.setActiveObject(id);
        this.setMode('transform');
    }

    exitPoseEditMode() {
        this.setMode('view');
    }

    /** @deprecated Use createPoseObject/createPoseObjectFromComponent instead. */
    syncMolecularObjects(targets: ReadonlyArray<MolecularObjectTarget>) {
        void targets;
    }

    setActiveBoxState(id: string, state: OrientedBoxState) {
        this.setBoxState(id, state);
    }

    setBoxState(id: string, state: OrientedBoxState) {
        this.updateBoxState(id, state);
    }

    updateBoxState(id: string, state: OrientedBoxState) {
        const obj = this.objects.get(id);
        if (!obj || obj.kind !== 'box') return;
        obj.state = OrientedBoxState.clone(state);
        this.updateRenderTransform(obj);
        this.emitChanged('update', id);
    }

    setPoseObjectTransform(id: string, state: { position: Vec3; rotation: Quat }) {
        const obj = this.objects.get(id);
        if (!obj || obj.kind !== 'pose-object') return;
        obj.state.position = Vec3.clone(state.position);
        obj.state.rotation = Quat.clone(state.rotation);
        TransformState.recomputeMatrix(obj.state);
        this.updateRenderTransform(obj, true);
        void this.commitTransform(id, obj.state);
        this.emitChanged('update', id);
    }

    /** @deprecated Use setPoseObjectTransform instead. */
    setMolecularObjectState(id: string, state: { position: Vec3; rotation: Quat }) {
        this.setPoseObjectTransform(id, state);
    }

    previewTransform(id: string, transform: TransformState) {
        const obj = this.objects.get(id);
        if (!obj) return;
        if (obj.kind === 'root-structure' && obj.locked) return;
        if (obj.kind === 'box') {
            obj.state.center = Vec3.clone(transform.position);
            obj.state.rotation = Quat.clone(transform.rotation);
            obj.state.size = Vec3.clone(transform.scale);
            Mat4.copy(obj.state.matrix, transform.matrix);
        } else if (obj.kind === 'pose-object' || obj.kind === 'root-structure') {
            obj.state = TransformState.clone(transform);
        }
        this.updateRenderTransform(obj, obj.kind !== 'box');
        this.events.preview.next({ objectId: id, transform: TransformState.clone(transform) });
        this.emitChanged('preview', id);
    }

    async commitTransform(id: string, transform: TransformState) {
        const obj = this.objects.get(id);
        if (!obj) return;
        if (obj.kind === 'root-structure' && obj.locked) return;
        if (obj.kind === 'box') {
            obj.state.center = Vec3.clone(transform.position);
            obj.state.rotation = Quat.clone(transform.rotation);
            obj.state.size = Vec3.clone(transform.scale);
            Mat4.copy(obj.state.matrix, transform.matrix);
        } else {
            obj.state = TransformState.clone(transform);
        }
        this.updateRenderTransform(obj, obj.kind !== 'box');
        if (obj.kind !== 'box') await this.commitStructureTransform(obj, transform);
        this.events.commit.next({ objectId: id, transform: TransformState.clone(transform) });
        this.emitChanged('commit', id);
    }

    canUsePickTarget(target: { kind: string; objectId: string }): boolean {
        const obj = this.objects.get(target.objectId);
        if (!obj) return false;
        if (this.mode !== 'transform' || this.activeObjectId !== target.objectId) return false;
        if (obj.kind === 'root-structure' && obj.locked) return false;
        if (obj.kind === 'box') return true;
        return target.kind === 'center' || target.kind === 'axis' || target.kind === 'ring';
    }

    private emitChanged(reason: TransformObjectChangeReason, objectId: string | undefined) {
        this.events.changed.next({ objectId, reason });
    }

    private getPoseSourceKey(sourceKind: PoseObjectSourceKind, sourceRef: string): string {
        return `${sourceKind}:${sourceRef}`;
    }

    private getPoseObjectId(sourceKind: PoseObjectSourceKind, sourceRef: string): string {
        return `pose:${this.getPoseSourceKey(sourceKind, sourceRef)}`;
    }

    private findTransformDecorator(sourceRef: string) {
        const data = this.plugin.state?.data;
        return data?.selectQ(q => q.byRef(sourceRef).children().withTransformer(StateTransforms.Model.TransformStructureConformation))[0];
    }

    private rotationFromTransform(transform: any): Quat | undefined {
        if (!transform || transform.name !== 'matrix' || !transform.params?.data) return undefined;
        return Mat4.getRotation(Quat.identity(), transform.params.data);
    }

    private matrixFromTransform(transform: any): Mat4 | undefined {
        if (!transform || transform.name !== 'matrix' || !transform.params?.data) return undefined;
        return Mat4.clone(transform.params.data);
    }

    private createBoxSnapshot(obj: ObjectRecord): BoxStateSnapshot {
        if (obj.kind !== 'box') throw new Error('Expected box object.');
        return {
            id: obj.id,
            center: Vec3.clone(obj.state.center),
            size: Vec3.clone(obj.state.size),
            rotation: Quat.clone(obj.state.rotation),
            isActive: obj.id === this.activeObjectId,
        };
    }

    private createPoseSnapshot(obj: PoseObjectRecord): PoseObjectStateSnapshot {
        return {
            id: obj.id,
            kind: obj.kind,
            sourceKind: obj.sourceKind,
            sourceRef: obj.sourceRef,
            label: obj.label,
            position: Vec3.clone(obj.state.position),
            rotation: Quat.clone(obj.state.rotation),
            radius: obj.radius,
            isActive: obj.id === this.activeObjectId,
        };
    }

    private createRootStructureSnapshot(obj: RootStructureRecord): RootStructureStateSnapshot {
        return {
            id: obj.id,
            kind: obj.kind,
            sourceRef: obj.sourceRef,
            label: obj.label,
            position: Vec3.clone(obj.state.position),
            rotation: Quat.clone(obj.state.rotation),
            matrix: Mat4.clone(obj.committedTransform),
            radius: obj.radius,
            isActive: obj.id === this.activeObjectId,
            isLocked: obj.locked,
        };
    }

    private addPoseObject(target: PoseObjectTarget & { id: string }) {
        this.addStructureTransformObject({
            id: target.id,
            kind: 'pose-object',
            label: target.label,
            sourceRef: target.sourceRef,
            transformRef: target.transformRef,
            sourceKind: target.sourceKind,
            center: target.center,
            baseCenter: target.baseCenter,
            radius: target.radius,
            rotation: target.rotation,
            committedTransform: target.committedTransform,
            sourceStructure: target.sourceStructure,
            currentStructure: target.currentStructure,
            representations: target.representations,
        });
    }

    private createOrUpdateRootStructureObject(structure: StructureRef): string | undefined {
        const source = structure.cell.obj?.data;
        if (!source) return undefined;

        const sourceRef = structure.cell.transform.ref;
        const id = this.rootObjectIdsBySource.get(sourceRef) ?? `root:${sourceRef}`;
        const existing = this.objects.get(id);
        const transformRef = structure.transform?.cell.transform.ref;
        const current = structure.transform?.cell.obj?.data ?? source;
        const sphere = current.boundary.sphere;
        const sourceSphere = source.boundary.sphere;
        const target = {
            id,
            kind: 'root-structure' as const,
            label: structure.cell.obj?.label ?? source.label ?? 'Root Structure',
            sourceRef,
            locked: existing && existing.kind === 'root-structure' ? existing.locked : false,
            transformRef,
            center: Vec3.clone(sphere.center),
            baseCenter: Vec3.clone(sourceSphere.center),
            radius: sphere.radius,
            rotation: this.rotationFromTransform(structure.transform?.cell.transform.params?.transform),
            committedTransform: this.matrixFromTransform(structure.transform?.cell.transform.params?.transform),
            sourceStructure: source,
            currentStructure: current,
            representations: this.collectStructureRepresentations(structure),
        };
        if (existing && existing.kind === 'root-structure') {
            this.updateRootStructureRecord(existing, target);
            return id;
        }

        this.addStructureTransformObject(target);
        this.rootObjectIdsBySource.set(sourceRef, id);
        return id;
    }

    private addStructureTransformObject(target: {
        id: string,
        kind: 'pose-object' | 'root-structure',
        sourceKind?: PoseObjectSourceKind,
        label: string,
        sourceRef: string,
        locked?: boolean,
        transformRef?: string,
        center: Vec3,
        baseCenter?: Vec3,
        radius: number,
        rotation?: Quat,
        committedTransform?: Mat4,
        sourceStructure?: Structure,
        currentStructure?: Structure,
        representations?: ReadonlyArray<Representation.Any>,
    }) {
        const fullStyle = { ...DefaultBoxStyle };
        const radius = Math.max(target.radius, 1);
        const gizmoScale = Math.max(radius * 0.35, 2.0);
        const gizmoMesh = createGizmoMesh(gizmoScale, { includeFaceHandles: false });
        const gizmoShape = Shape.create('object-gizmo', {}, gizmoMesh,
            (groupId) => getGizmoGroupColor(fullStyle, groupId),
            () => 1,
            () => ''
        );
        const gizmoRO = Shape.createRenderObject(gizmoShape, {
            ...PD.getDefaultValues(Mesh.Params),
            alpha: fullStyle.gizmoOpacity,
            ignoreLight: true,
            cellSize: 0,
            batchSize: 0,
        } as any) as any;
        const gizmoRepr = createTransformGizmoRepresentation('object-gizmo', [gizmoRO]);

        const c3d = this.canvas3d;
        c3d?.add?.(gizmoRepr);

        const state = TransformState.fromPositionRotationScale(
            target.center,
            target.rotation ?? Quat.identity(),
            Vec3.create(1, 1, 1)
        );
        const record: PoseObjectRecord = {
            id: target.id,
            kind: target.kind as 'pose-object',
            sourceKind: target.sourceKind ?? 'structure',
            label: target.label,
            sourceRef: target.sourceRef,
            locked: target.kind === 'root-structure' ? !!(target as any).locked : false,
            transformRef: target.transformRef,
            sourceStructure: target.sourceStructure,
            currentStructure: target.currentStructure ?? target.sourceStructure,
            state,
            baseCenter: Vec3.clone(target.baseCenter ?? target.center),
            previewBasePosition: Vec3.clone(target.center),
            previewBaseRotation: Quat.clone(target.rotation ?? Quat.identity()),
            committedTransform: target.committedTransform ? Mat4.clone(target.committedTransform) : Mat4.identity(),
            radius,
            representations: Array.from(target.representations ?? []),
            style: fullStyle,
            gizmoMesh,
            gizmoRenderObject: gizmoRO,
            gizmoRepr,
            visible: true,
            gizmoVisible: false,
            gizmoScale,
        };

        this.objects.set(record.id, record as ObjectRecord);
        this.syncGizmoVisibility(record as ObjectRecord);
        this.updateRenderTransform(record);
        this.emitChanged('add', record.id);
    }

    private updatePoseRecord(obj: PoseObjectRecord, target: PoseObjectTarget) {
        obj.label = target.label;
        obj.sourceKind = target.sourceKind;
        obj.sourceRef = target.sourceRef;
        obj.transformRef = target.transformRef;
        obj.sourceStructure = target.sourceStructure ?? obj.sourceStructure;
        obj.currentStructure = target.currentStructure ?? target.sourceStructure ?? obj.currentStructure;
        obj.radius = Math.max(target.radius, 1);
        obj.baseCenter = Vec3.clone(target.baseCenter ?? target.center);
        obj.committedTransform = target.committedTransform ? Mat4.clone(target.committedTransform) : obj.committedTransform;
        obj.representations = Array.from(target.representations ?? []);

        const isPreviewing = obj.id === this.activeObjectId && obj.gizmoVisible;
        if (!isPreviewing) {
            obj.state.position = Vec3.clone(target.center);
            obj.state.rotation = Quat.clone(target.rotation ?? Quat.identity());
            obj.state.scale = Vec3.create(1, 1, 1);
            TransformState.recomputeMatrix(obj.state);
            obj.previewBasePosition = Vec3.clone(obj.state.position);
            obj.previewBaseRotation = Quat.clone(obj.state.rotation);
            this.updateRenderTransform(obj);
        }
    }

    private updateRootStructureRecord(obj: RootStructureRecord, target: {
        label: string,
        sourceRef: string,
        locked?: boolean,
        transformRef?: string,
        center: Vec3,
        baseCenter?: Vec3,
        radius: number,
        rotation?: Quat,
        committedTransform?: Mat4,
        sourceStructure?: Structure,
        currentStructure?: Structure,
        representations?: ReadonlyArray<Representation.Any>,
    }) {
        obj.label = target.label;
        obj.sourceRef = target.sourceRef;
        obj.locked = target.locked ?? obj.locked;
        obj.transformRef = target.transformRef;
        obj.sourceStructure = target.sourceStructure ?? obj.sourceStructure;
        obj.currentStructure = target.currentStructure ?? target.sourceStructure ?? obj.currentStructure;
        obj.radius = Math.max(target.radius, 1);
        obj.baseCenter = Vec3.clone(target.baseCenter ?? target.center);
        obj.committedTransform = target.committedTransform ? Mat4.clone(target.committedTransform) : obj.committedTransform;
        obj.representations = Array.from(target.representations ?? []);

        const isPreviewing = obj.id === this.activeObjectId && obj.gizmoVisible;
        if (!isPreviewing) {
            obj.state.position = Vec3.clone(target.center);
            obj.state.rotation = Quat.clone(target.rotation ?? Quat.identity());
            obj.state.scale = Vec3.create(1, 1, 1);
            TransformState.recomputeMatrix(obj.state);
            obj.previewBasePosition = Vec3.clone(obj.state.position);
            obj.previewBaseRotation = Quat.clone(obj.state.rotation);
            this.updateRenderTransform(obj);
        }
    }

    private collectStructureRepresentations(structure: StructureRef): Representation.Any[] {
        const reprs: Representation.Any[] = [];
        for (const repr of structure.genericRepresentations ?? []) {
            const data = repr.cell.obj?.data as any;
            if (data?.repr) reprs.push(data.repr);
        }
        for (const component of structure.components) {
            for (const repr of component.representations) {
                const data = repr.cell.obj?.data as any;
                if (data?.repr) reprs.push(data.repr);
            }
            for (const repr of component.genericRepresentations ?? []) {
                const data = repr.cell.obj?.data as any;
                if (data?.repr) reprs.push(data.repr);
            }
        }
        return reprs;
    }

    private updateRenderTransform(obj: ObjectRecord, applyMolecularPreview = false) {
        const c3d = this.canvas3d;

        if (obj.kind === 'box') {
            if (!c3d) return;
            Mat4.copy(tmpMat4, obj.state.matrix);

            Mat4.copy(obj.faceRenderObject.values.aTransform.ref.value as unknown as Mat4, tmpMat4);
            ValueCell.update(obj.faceRenderObject.values.aTransform, obj.faceRenderObject.values.aTransform.ref.value);

            Mat4.copy(obj.edgeRenderObject.values.aTransform.ref.value as unknown as Mat4, tmpMat4);
            ValueCell.update(obj.edgeRenderObject.values.aTransform, obj.edgeRenderObject.values.aTransform.ref.value);
        } else {
            if (applyMolecularPreview) {
                const preview = this.getMolecularPreviewMatrix(obj, obj.state);
                for (const repr of this.getPoseRepresentations(obj)) {
                    repr.setState({ transform: preview });
                    c3d?.update?.(repr, false);
                }
                if (obj.kind === 'pose-object') this.applyFocusPreview(obj, preview);
            }
            c3d?.requestDraw();
            if (!c3d) return;
        }

        const gizmoTransform = Mat4.identity();
        Mat4.fromQuat(gizmoTransform, obj.kind === 'box' ? obj.state.rotation : obj.state.rotation);
        // Gizmo mesh vertices are already scaled by gizmoScale in createGizmoMesh,
        // so aTransform only needs rotation + translation.
        Mat4.setTranslation(gizmoTransform, obj.kind === 'box' ? obj.state.center : obj.state.position);

        Mat4.copy(obj.gizmoRenderObject.values.aTransform.ref.value as unknown as Mat4, gizmoTransform);
        ValueCell.update(obj.gizmoRenderObject.values.aTransform, obj.gizmoRenderObject.values.aTransform.ref.value);

        // Update bounding spheres after transform changes so renderer frustum culling is correct
        if (obj.kind === 'box') {
            Mesh.Utils.updateBoundingSphere(obj.faceRenderObject.values, obj.faceMesh);
            Lines.Utils.updateBoundingSphere(obj.edgeRenderObject.values, obj.edgeLines);
        }
        Mesh.Utils.updateBoundingSphere(obj.gizmoRenderObject.values, obj.gizmoMesh);

        if (obj.kind === 'box') {
            c3d.update(obj.faceRepr, false);
            c3d.update(obj.edgeRepr, false);
        }
        c3d.update?.(obj.gizmoRepr, false);
        c3d.requestDraw();
    }

    private getMolecularPreviewMatrix(obj: PoseObjectRecord, transform: TransformState): Mat4 {
        const matrix = Mat4.identity();
        const translateToOrigin = Mat4.identity();
        const rotate = Mat4.identity();
        const translateToPosition = Mat4.identity();

        const inverseBaseRotation = Quat.invert(tmpQuat, obj.previewBaseRotation);
        const deltaRotation = Quat.multiply(Quat.identity(), transform.rotation, inverseBaseRotation);
        Quat.normalize(deltaRotation, deltaRotation);

        Vec3.negate(tmpVec3, obj.previewBasePosition);
        Mat4.setTranslation(translateToOrigin, tmpVec3);
        Mat4.fromQuat(rotate, deltaRotation);
        Mat4.setTranslation(translateToPosition, transform.position);

        Mat4.mul(tmpMat4b, rotate, translateToOrigin);
        Mat4.mul(matrix, translateToPosition, tmpMat4b);
        return matrix;
    }

    private async commitStructureTransform(obj: StructureTransformRecord, transform: TransformState) {
        const data = this.plugin.state?.data;
        if (!data) {
            this.clearMolecularPreview(obj);
            return;
        }

        const preview = this.getMolecularPreviewMatrix(obj, transform);
        const matrix = Mat4.mul(Mat4.identity(), preview, obj.committedTransform);
        const params = {
            transform: {
                name: 'matrix' as const,
                params: { data: matrix, transpose: false }
            }
        };

        const existing = obj.transformRef
            ? { transform: { ref: obj.transformRef } }
            : data.selectQ(q => q.byRef(obj.sourceRef).children().withTransformer(StateTransforms.Model.TransformStructureConformation))[0];

        let transformRef = existing?.transform.ref;
        const builder = existing
            ? data.build().to(existing.transform.ref).update(params)
            : data.build().to(obj.sourceRef).insert(StateTransforms.Model.TransformStructureConformation, params, { tags: MolecularTransformTag });
        transformRef = transformRef ?? (builder as any).ref;

        await this.plugin.runTask(data.updateTree(builder));
        obj.transformRef = transformRef;
        obj.committedTransform = Mat4.clone(matrix);
        obj.currentStructure = this.getStructureFromRef(transformRef) ?? obj.currentStructure;
        obj.previewBasePosition = Vec3.clone(transform.position);
        obj.previewBaseRotation = Quat.clone(transform.rotation);
        this.clearMolecularPreview(obj);
        this.clearFocusPreview();
        if (obj.kind === 'pose-object') {
            this.refreshCurrentFocus(this.getRemappedFocusLociForPoseObject(obj));
        } else {
            this.refreshCurrentFocus();
        }
    }

    private clearMolecularPreview(obj: StructureTransformRecord) {
        Mat4.copy(tmpMat4c, Mat4.identity());
        for (const repr of this.getPoseRepresentations(obj)) {
            repr.setState({ transform: tmpMat4c });
            this.canvas3d?.update?.(repr, false);
        }
        this.canvas3d?.requestDraw();
    }

    private applyFocusPreview(obj: PoseObjectRecord, preview: Mat4) {
        const focusRepresentations = this.getFocusRepresentationsForPoseObject(obj);
        if (!focusRepresentations) {
            if (this.focusPreviewObjectId === obj.id) this.clearFocusPreview();
            return;
        }

        if (this.focusPreviewObjectId && this.focusPreviewObjectId !== obj.id) {
            this.clearFocusPreview();
        }
        this.focusPreviewObjectId = obj.id;

        for (const repr of focusRepresentations.target) {
            this.trackFocusPreviewRepr(repr, { resetTransform: true });
            repr.setState({ transform: preview });
            this.canvas3d?.update?.(repr, false);
        }
        for (const repr of focusRepresentations.context) {
            this.trackFocusPreviewRepr(repr, { restoreVisibility: true });
            repr.setState({ visible: false });
            this.canvas3d?.update?.(repr, false);
        }
        this.canvas3d?.requestDraw();
    }

    private clearFocusPreview() {
        if (this.focusPreviewReprs.size === 0) {
            this.focusPreviewObjectId = undefined;
            return;
        }

        for (const record of this.focusPreviewReprs.values()) {
            const state: Partial<Representation.State> = {};
            if (record.resetTransform) state.transform = Mat4.identity();
            if (record.restoreVisibility) state.visible = record.wasVisible;
            record.repr.setState(state);
            this.canvas3d?.update?.(record.repr, false);
        }

        this.focusPreviewReprs.clear();
        this.focusPreviewObjectId = undefined;
        this.canvas3d?.requestDraw();
    }

    private trackFocusPreviewRepr(repr: Representation.Any, flags: { resetTransform?: boolean; restoreVisibility?: boolean }) {
        let record = this.focusPreviewReprs.get(repr);
        if (!record) {
            record = {
                repr,
                resetTransform: false,
                restoreVisibility: false,
                wasVisible: (repr as any).state?.visible !== false,
            };
            this.focusPreviewReprs.set(repr, record);
        }
        record.resetTransform = record.resetTransform || !!flags.resetTransform;
        record.restoreVisibility = record.restoreVisibility || !!flags.restoreVisibility;
    }

    private getFocusRepresentationsForPoseObject(obj: PoseObjectRecord): { target: Representation.Any[]; context: Representation.Any[] } | undefined {
        const rootRef = this.getCurrentFocusRootRefForPoseObject(obj);
        if (!rootRef) return undefined;

        const target = this.getFocusRepresentationsByTag(rootRef, StructureFocusRepresentationTags.TargetRepr);
        const context = [
            ...this.getFocusRepresentationsByTag(rootRef, StructureFocusRepresentationTags.SurrRepr),
            ...this.getFocusRepresentationsByTag(rootRef, StructureFocusRepresentationTags.SurrNciRepr),
        ];

        return { target, context };
    }

    private getCurrentFocusRootRefForPoseObject(obj: PoseObjectRecord): string | undefined {
        const focus = (this.plugin as any).managers?.structure?.focus?.current;
        const structure = focus?.loci?.structure;
        if (!structure) return undefined;

        const parent = (this.plugin as any).helpers?.substructureParent?.get?.(structure);
        const rootRef = parent?.transform?.ref;
        if (!rootRef) return undefined;
        if (!this.focusBelongsToPoseObject(obj, focus.loci, rootRef)) return undefined;
        return rootRef;
    }

    private focusBelongsToPoseObject(obj: PoseObjectRecord, loci: StructureElement.Loci, rootRef?: string): boolean {
        if (rootRef && (rootRef === obj.sourceRef || rootRef === obj.transformRef)) return true;
        if (!obj.sourceStructure) return false;
        const remapped = StructureElement.Loci.remap(loci, obj.sourceStructure);
        return !StructureElement.Loci.isEmpty(remapped);
    }

    private getRemappedFocusLociForPoseObject(obj: PoseObjectRecord): StructureElement.Loci | undefined {
        const focus = (this.plugin as any).managers?.structure?.focus?.current;
        const loci = focus?.loci as StructureElement.Loci | undefined;
        if (!loci || !obj.currentStructure) return undefined;

        const rootRef = (this.plugin as any).helpers?.substructureParent?.get?.(loci.structure)?.transform?.ref;
        if (!this.focusBelongsToPoseObject(obj, loci, rootRef)) return undefined;

        const remapped = StructureElement.Loci.remap(loci, obj.currentStructure);
        return StructureElement.Loci.isEmpty(remapped) ? undefined : remapped;
    }

    private getStructureFromRef(ref: string | undefined): Structure | undefined {
        if (!ref) return undefined;
        return this.plugin.state?.data?.cells?.get(ref)?.obj?.data as Structure | undefined;
    }

    private resolveRootStructureFromLoci(loci: StructureElement.Loci): StructureRef | undefined {
        const hierarchy = (this.plugin as any).managers?.structure?.hierarchy;
        const direct = hierarchy?.findStructure?.(loci.structure);
        if (direct) return direct;

        const rootRef = (this.plugin as any).helpers?.substructureParent?.get?.(loci.structure)?.transform?.ref;
        if (!rootRef) return undefined;

        const roots = hierarchy?.current?.structures as ReadonlyArray<StructureRef> | undefined;
        return roots?.find(root => root.cell.transform.ref === rootRef);
    }

    private getFocusRepresentationsByTag(rootRef: string, tag: StructureFocusRepresentationTags): Representation.Any[] {
        const data = this.plugin.state?.data;
        if (!data) return [];
        const cells = data.selectQ(q => q.byRef(rootRef).subtree().withTag(tag));
        return cells.map(cell => cell.obj?.data.repr).filter(Boolean) as Representation.Any[];
    }

    private refreshCurrentFocus(loci?: StructureElement.Loci) {
        (this.plugin as any).managers?.structure?.focus?.refreshCurrent?.(loci);
    }

    private getPoseRepresentations(obj: StructureTransformRecord): Representation.Any[] {
        if (obj.representations.length > 0) return obj.representations;

        const data = this.plugin.state?.data;
        if (!data) return obj.representations;

        obj.representations = this.getRepresentationsBelowRef(obj.sourceRef);
        return obj.representations;
    }

    private getRepresentationsBelowRef(ref: string): Representation.Any[] {
        const data = this.plugin.state?.data;
        if (!data) return [];

        const cells = data.selectQ(q => q.byRef(ref).subtree().ofType(PluginStateObject.Molecule.Structure.Representation3D));
        return cells.map(cell => cell.obj?.data.repr).filter(Boolean) as Representation.Any[];
    }

    private syncGizmoVisibility(obj: ObjectRecord) {
        obj.gizmoRepr.setState({ visible: obj.gizmoVisible });
        const c3d = this.canvas3d;
        c3d?.update?.(obj.gizmoRepr, true);
        c3d?.requestDraw?.();
    }

    private shouldShowGizmo(obj: ObjectRecord) {
        if (this.mode !== 'transform' || this.activeObjectId !== obj.id) return false;
        if (obj.kind === 'root-structure' && obj.locked) return false;
        return true;
    }

    dispose() {
        for (const id of Array.from(this.objects.keys())) {
            this.removeObject(id);
        }
        this.events.preview.complete();
        this.events.commit.complete();
        this.events.hover.complete();
        this.events.select.complete();
        this.events.changed.complete();
    }
}

// ---------- Public Handle API ----------

export interface BoxObjectHandle {
    readonly id: string;
    getState(): OrientedBoxState;
    setState(state: OrientedBoxState): void;
    updateStyle(style: Partial<BoxStyle>): void;
    dispose(): void;
}

class BoxObjectHandleImpl implements BoxObjectHandle {
    constructor(public readonly id: string, private manager: TransformObjectManager) {}

    getState(): OrientedBoxState {
        const obj = this.manager.getObject(this.id);
        if (!obj) return OrientedBoxState.create();
        return OrientedBoxState.clone(obj.state);
    }

    setState(state: OrientedBoxState) {
        this.manager.updateBoxState(this.id, state);
    }

    updateStyle(style: Partial<BoxStyle>) {
        const obj = this.manager.getObject(this.id);
        if (!obj) return;
        obj.style = { ...obj.style, ...style };
    }

    dispose() {
        this.manager.removeObject(this.id);
    }
}
