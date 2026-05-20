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
import { Vec3, Mat4, Quat } from '../../mol-math/linear-algebra';
import { Color } from '../../mol-util/color';
import { ColorNames } from '../../mol-util/color/names';
import { ValueCell } from '../../mol-util';
import { Subject } from 'rxjs';

import { OrientedBoxState, TransformState } from './math';
import { createBoxFaceMesh, createBoxEdgeLines, createGizmoMesh, GizmoGroup } from './geometry';
import { createTransformGizmoRepresentation, TransformGizmoRepresentation } from './representation';

// ---------- Style Types ----------

export interface BoxStyle {
    faceColor: Color;
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
    faceOpacity: 0.18,
    edgeColor: ColorNames.blue,
    edgeOpacity: 0.8,
    edgeSize: 2,
    gizmoColorX: ColorNames.red,
    gizmoColorY: ColorNames.green,
    gizmoColorZ: ColorNames.blue,
    gizmoOpacity: 0.85,
};

// ---------- Events ----------

export interface TransformObjectEvents {
    readonly preview: Subject<{ objectId: string; transform: TransformState }>;
    readonly commit: Subject<{ objectId: string; transform: TransformState }>;
    readonly hover: Subject<{ objectId: string | undefined; groupId: number }>;
    readonly select: Subject<{ objectId: string | undefined }>;
}

export function createTransformObjectEvents(): TransformObjectEvents {
    return {
        preview: new Subject(),
        commit: new Subject(),
        hover: new Subject(),
        select: new Subject(),
    };
}

// ---------- Internal Object Record ----------

interface ObjectRecord {
    id: string;
    kind: 'box';
    state: OrientedBoxState;
    style: BoxStyle;
    faceRenderObject: GraphicsRenderObject<'mesh'>;
    faceRepr: TransformGizmoRepresentation;
    edgeRenderObject: GraphicsRenderObject<'lines'>;
    edgeRepr: TransformGizmoRepresentation;
    gizmoRenderObject: GraphicsRenderObject<'mesh'>;
    gizmoRepr: TransformGizmoRepresentation;
    visible: boolean;
    gizmoVisible: boolean;
}

const tmpMat4 = Mat4.identity();

// ---------- Manager ----------

export class TransformObjectManager {
    private objects = new Map<string, ObjectRecord>();
    private activeObjectId: string | undefined;
    private mode: 'view' | 'transform' = 'view';
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
        const gizmoMesh = createGizmoMesh();

        const faceShape = Shape.create('box-faces', {}, faceMesh,
            (groupId) => {
                if (groupId >= GizmoGroup.FacePosX && groupId <= GizmoGroup.FaceNegZ) return fullStyle.faceColor;
                return fullStyle.faceColor;
            },
            () => 1,
            () => ''
        );

        const edgeShape = Shape.create('box-edges', {}, edgeLines,
            () => fullStyle.edgeColor,
            () => fullStyle.edgeSize,
            () => ''
        );

        const gizmoShape = Shape.create('gizmo', {}, gizmoMesh,
            (groupId) => {
                switch (groupId) {
                    case GizmoGroup.AxisX: case GizmoGroup.RingX: return fullStyle.gizmoColorX;
                    case GizmoGroup.AxisY: case GizmoGroup.RingY: return fullStyle.gizmoColorY;
                    case GizmoGroup.AxisZ: case GizmoGroup.RingZ: return fullStyle.gizmoColorZ;
                    default: return ColorNames.grey;
                }
            },
            () => 1,
            () => ''
        );

        const faceRO = Shape.createRenderObject(faceShape, {
            alpha: fullStyle.faceOpacity,
            ignoreLight: true,
            doubleSided: true,
            cellSize: 0,
            batchSize: 0,
        } as any) as any;

        const edgeRO = Shape.createRenderObject(edgeShape, {
            alpha: fullStyle.edgeOpacity,
            ignoreLight: true,
            cellSize: 0,
            batchSize: 0,
        } as any) as any;

        const gizmoRO = Shape.createRenderObject(gizmoShape, {
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
            faceRenderObject: faceRO,
            faceRepr,
            edgeRenderObject: edgeRO,
            edgeRepr,
            gizmoRenderObject: gizmoRO,
            gizmoRepr,
            visible: true,
            gizmoVisible: false,
        };

        this.objects.set(id, record);
        this.updateRenderTransform(record);

        return new BoxObjectHandleImpl(id, this);
    }

    removeObject(id: string) {
        const obj = this.objects.get(id);
        if (!obj) return;

        const c3d = this.canvas3d;
        if (c3d) {
            c3d.remove(obj.faceRepr);
            c3d.remove(obj.edgeRepr);
            c3d.remove(obj.gizmoRepr);
        }

        this.objects.delete(id);
        if (this.activeObjectId === id) {
            this.activeObjectId = undefined;
            this.events.select.next({ objectId: undefined });
        }
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
                next.gizmoVisible = this.mode === 'transform';
                this.syncGizmoVisibility(next);
            }
        }
        this.events.select.next({ objectId: id });
    }

    setMode(mode: 'view' | 'transform') {
        if (this.mode === mode) return;
        this.mode = mode;
        for (const obj of this.objects.values()) {
            obj.gizmoVisible = (this.mode === 'transform' && this.activeObjectId === obj.id);
            this.syncGizmoVisibility(obj);
        }
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

    updateBoxState(id: string, state: OrientedBoxState) {
        const obj = this.objects.get(id);
        if (!obj) return;
        obj.state = OrientedBoxState.clone(state);
        this.updateRenderTransform(obj);
    }

    previewTransform(id: string, transform: TransformState) {
        const obj = this.objects.get(id);
        if (!obj) return;
        obj.state.center = Vec3.clone(transform.position);
        obj.state.rotation = Quat.clone(transform.rotation);
        obj.state.size = Vec3.clone(transform.scale);
        Mat4.copy(obj.state.matrix, transform.matrix);
        this.updateRenderTransform(obj);
        this.events.preview.next({ objectId: id, transform: TransformState.clone(transform) });
    }

    commitTransform(id: string, transform: TransformState) {
        const obj = this.objects.get(id);
        if (!obj) return;
        obj.state.center = Vec3.clone(transform.position);
        obj.state.rotation = Quat.clone(transform.rotation);
        obj.state.size = Vec3.clone(transform.scale);
        Mat4.copy(obj.state.matrix, transform.matrix);
        this.updateRenderTransform(obj);
        this.events.commit.next({ objectId: id, transform: TransformState.clone(transform) });
    }

    private updateRenderTransform(obj: ObjectRecord) {
        const c3d = this.canvas3d;
        if (!c3d) return;

        Mat4.copy(tmpMat4, obj.state.matrix);

        Mat4.copy(obj.faceRenderObject.values.aTransform.ref.value as unknown as Mat4, tmpMat4);
        ValueCell.update(obj.faceRenderObject.values.aTransform, obj.faceRenderObject.values.aTransform.ref.value);

        Mat4.copy(obj.edgeRenderObject.values.aTransform.ref.value as unknown as Mat4, tmpMat4);
        ValueCell.update(obj.edgeRenderObject.values.aTransform, obj.edgeRenderObject.values.aTransform.ref.value);

        const gizmoTransform = Mat4.identity();
        Mat4.fromQuat(gizmoTransform, obj.state.rotation);
        Mat4.setTranslation(gizmoTransform, obj.state.center);

        Mat4.copy(obj.gizmoRenderObject.values.aTransform.ref.value as unknown as Mat4, gizmoTransform);
        ValueCell.update(obj.gizmoRenderObject.values.aTransform, obj.gizmoRenderObject.values.aTransform.ref.value);

        c3d.update(obj.faceRepr, false);
        c3d.update(obj.edgeRepr, false);
        c3d.update(obj.gizmoRepr, false);
        c3d.requestDraw();
    }

    private syncGizmoVisibility(obj: ObjectRecord) {
        const c3d = this.canvas3d;
        if (!c3d) return;
        obj.gizmoRepr.setState({ visible: obj.gizmoVisible });
        c3d.update(obj.gizmoRepr, true);
        c3d.requestDraw();
    }

    dispose() {
        for (const id of Array.from(this.objects.keys())) {
            this.removeObject(id);
        }
        this.events.preview.complete();
        this.events.commit.complete();
        this.events.hover.complete();
        this.events.select.complete();
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
