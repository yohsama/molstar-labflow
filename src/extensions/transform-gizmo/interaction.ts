/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Interaction state machine for transform gizmo.
 * Subscribes to Canvas3D interaction events and manages drag sessions.
 */

import { PluginContext } from '../../mol-plugin/context';
import { Canvas3D } from '../../mol-canvas3d/canvas3d';
import { Subscription } from 'rxjs';
import { Vec3, Mat4, Quat } from '../../mol-math/linear-algebra';

import { TransformObjectManager } from './manager';
import { isTransformGizmoLoci, TransformGizmoLociData } from './representation';
import { GizmoGroup } from './geometry';
import {
    TransformState, OrientedBoxState,
    axisDragDelta, viewPlaneDragDelta, stretchBoxFace,
    ringRotationDelta, rotateAroundAxis,
} from './math';

// ---------- Pick Target ----------

export type TransformPickTarget =
    | { kind: 'body'; objectId: string }
    | { kind: 'center'; objectId: string }
    | { kind: 'axis'; objectId: string; axis: 'x' | 'y' | 'z' }
    | { kind: 'ring'; objectId: string; axis: 'x' | 'y' | 'z' }
    | { kind: 'face'; objectId: string; face: '+x' | '-x' | '+y' | '-y' | '+z' | '-z' };

// ---------- Interaction State ----------

export type TransformInteractionState =
    | { mode: 'idle' }
    | { mode: 'hover'; target: TransformPickTarget }
    | { mode: 'dragging'; target: TransformPickTarget; session: DragSession };

interface DragSession {
    startX: number;
    startY: number;
    initialBox: OrientedBoxState;
    initialTransform: TransformState;
    savedTrackballProps: { rotateSpeed: number; panSpeed: number; zoomSpeed: number };
}

// ---------- Helpers ----------

const tmpVec3 = Vec3.zero();

function groupIdToPickTarget(objectId: string, groupId: number): TransformPickTarget | undefined {
    switch (groupId) {
        case GizmoGroup.Body: return { kind: 'body', objectId };
        case GizmoGroup.Center: return { kind: 'center', objectId };
        case GizmoGroup.AxisX: return { kind: 'axis', objectId, axis: 'x' };
        case GizmoGroup.AxisY: return { kind: 'axis', objectId, axis: 'y' };
        case GizmoGroup.AxisZ: return { kind: 'axis', objectId, axis: 'z' };
        case GizmoGroup.RingX: return { kind: 'ring', objectId, axis: 'x' };
        case GizmoGroup.RingY: return { kind: 'ring', objectId, axis: 'y' };
        case GizmoGroup.RingZ: return { kind: 'ring', objectId, axis: 'z' };
        case GizmoGroup.FacePosX: return { kind: 'face', objectId, face: '+x' };
        case GizmoGroup.FaceNegX: return { kind: 'face', objectId, face: '-x' };
        case GizmoGroup.FacePosY: return { kind: 'face', objectId, face: '+y' };
        case GizmoGroup.FaceNegY: return { kind: 'face', objectId, face: '-y' };
        case GizmoGroup.FacePosZ: return { kind: 'face', objectId, face: '+z' };
        case GizmoGroup.FaceNegZ: return { kind: 'face', objectId, face: '-z' };
        default: return undefined;
    }
}

function getLocalAxisWorldDirection(box: OrientedBoxState, axisIndex: number, out: Vec3): Vec3 {
    Mat4.fromQuat(tmpMat4, box.rotation);
    Vec3.set(out, tmpMat4[axisIndex * 4], tmpMat4[axisIndex * 4 + 1], tmpMat4[axisIndex * 4 + 2]);
    Vec3.normalize(out, out);
    return out;
}

function faceToAxisIndex(face: TransformPickTarget & { kind: 'face' }): number {
    switch (face.face) {
        case '+x': case '-x': return 0;
        case '+y': case '-y': return 1;
        case '+z': case '-z': return 2;
    }
}

function faceSign(face: TransformPickTarget & { kind: 'face' }): number {
    return face.face.startsWith('+') ? 1 : -1;
}

// ---------- Interaction Handler ----------

export class TransformInteractionHandler {
    private state: TransformInteractionState = { mode: 'idle' };
    private subs: Subscription[] = [];

    constructor(
        private plugin: PluginContext,
        private manager: TransformObjectManager
    ) {}

    start() {
        const c3d = this.plugin.canvas3d;
        if (!c3d) return;

        this.subs.push(c3d.interaction.hover.subscribe(e => {
            if (!this.manager.isEnabled) return;
            this.handleHover(e.current);
        }));

        this.subs.push(c3d.interaction.click.subscribe(e => {
            if (!this.manager.isEnabled) return;
            this.handleClick(e.current);
        }));

        this.subs.push(c3d.interaction.drag.subscribe(e => {
            if (!this.manager.isEnabled) return;
            this.handleDrag(e.pageStart[0], e.pageStart[1], e.pageEnd[0], e.pageEnd[1]);
        }));

        this.subs.push(c3d.input.interactionEnd.subscribe(() => {
            if (!this.manager.isEnabled) return;
            this.endDrag();
        }));
    }

    stop() {
        for (const s of this.subs) s.unsubscribe();
        this.subs = [];
    }

    private get canvas3d(): Canvas3D | undefined {
        return this.plugin.canvas3d;
    }

    private resolvePickTarget(loci: import('../../mol-repr/representation').Representation.Loci): TransformPickTarget | undefined {
        if (!loci || !loci.loci) return undefined;
        const dataLoci = loci.loci as any;
        if (!isTransformGizmoLoci(dataLoci)) return undefined;
        const d = dataLoci.data as TransformGizmoLociData;
        for (const [objId, obj] of this.manager['objects'] as Map<string, any>) {
            if (obj.faceRenderObject.id === d.objectId ||
                obj.edgeRenderObject.id === d.objectId ||
                obj.gizmoRenderObject.id === d.objectId) {
                return groupIdToPickTarget(objId, d.groupId);
            }
        }
        return undefined;
    }

    private handleHover(reprLoci: import('../../mol-repr/representation').Representation.Loci) {
        const target = this.resolvePickTarget(reprLoci);

        if (this.state.mode === 'idle') {
            if (target) {
                this.state = { mode: 'hover', target };
                this.manager.events.hover.next({ objectId: target.objectId, groupId: this.targetToGroupId(target) });
            }
        } else if (this.state.mode === 'hover') {
            if (!target) {
                this.state = { mode: 'idle' };
                this.manager.events.hover.next({ objectId: undefined, groupId: 0 });
            } else if (!this.targetsEqual(this.state.target, target)) {
                this.state = { mode: 'hover', target };
                this.manager.events.hover.next({ objectId: target.objectId, groupId: this.targetToGroupId(target) });
            }
        }
    }

    private handleClick(reprLoci: import('../../mol-repr/representation').Representation.Loci) {
        const target = this.resolvePickTarget(reprLoci);
        if (target) {
            this.manager.setActiveObject(target.objectId);
        } else {
            this.manager.setActiveObject(undefined);
        }
    }

    private handleDrag(startX: number, startY: number, endX: number, endY: number) {
        if (this.state.mode === 'hover') {
            const target = this.state.target;
            const obj = this.manager.getObject(target.objectId);
            if (!obj) return;

            const c3d = this.canvas3d;
            const savedProps = c3d ? {
                rotateSpeed: c3d.props.trackball.rotateSpeed,
                panSpeed: c3d.props.trackball.panSpeed,
                zoomSpeed: c3d.props.trackball.zoomSpeed,
            } : { rotateSpeed: 0, panSpeed: 0, zoomSpeed: 0 };

            if (c3d) {
                c3d.setProps({ trackball: { rotateSpeed: 0, panSpeed: 0, zoomSpeed: 0 } }, true);
            }

            const initialBox = OrientedBoxState.clone(obj.state);
            const initialTransform = OrientedBoxState.toTransform(initialBox);

            this.state = {
                mode: 'dragging',
                target,
                session: {
                    startX,
                    startY,
                    initialBox,
                    initialTransform,
                    savedTrackballProps: savedProps,
                }
            };
        }

        if (this.state.mode === 'dragging') {
            const { target, session } = this.state;
            this.applyDrag(target, session, session.startX, session.startY, endX, endY);
        }
    }

    endDrag() {
        if (this.state.mode !== 'dragging') return;
        const { target, session } = this.state;

        const c3d = this.canvas3d;
        if (c3d) {
            c3d.setProps({ trackball: session.savedTrackballProps }, true);
        }

        const obj = this.manager.getObject(target.objectId);
        if (obj) {
            const finalTransform = OrientedBoxState.toTransform(obj.state);
            this.manager.commitTransform(target.objectId, finalTransform);
        }

        this.state = { mode: 'idle' };
    }

    private applyDrag(
        target: TransformPickTarget,
        session: DragSession,
        startX: number, startY: number,
        endX: number, endY: number
    ) {
        const obj = this.manager.getObject(target.objectId);
        if (!obj) return;

        const c3d = this.canvas3d;
        if (!c3d) return;
        const camera = c3d.camera;
        const vp = camera.viewport;

        const box = OrientedBoxState.clone(session.initialBox);
        const transform = TransformState.clone(session.initialTransform);

        switch (target.kind) {
            case 'center': {
                const delta = viewPlaneDragDelta(camera, vp.width, vp.height, box.center, startX, startY, endX, endY);
                Vec3.add(transform.position, transform.position, delta);
                Vec3.add(box.center, box.center, delta);
                break;
            }
            case 'axis': {
                const axisIdx = target.axis === 'x' ? 0 : target.axis === 'y' ? 1 : 2;
                const axisWorld = getLocalAxisWorldDirection(box, axisIdx, tmpVec3);
                const delta = axisDragDelta(camera, vp.width, vp.height, box.center, axisWorld, startX, startY, endX, endY);
                const move = Vec3.scale(tmpVec3, axisWorld, delta);
                Vec3.add(transform.position, transform.position, move);
                Vec3.add(box.center, box.center, move);
                break;
            }
            case 'face': {
                const axisIdx = faceToAxisIndex(target);
                const sign = faceSign(target);
                const axisWorld = getLocalAxisWorldDirection(box, axisIdx, tmpVec3);
                const delta = axisDragDelta(camera, vp.width, vp.height, box.center, axisWorld, startX, startY, endX, endY);
                const result = stretchBoxFace(box, axisIdx, sign, delta);
                box.center = result.center;
                box.size = result.size;
                OrientedBoxState.recomputeMatrix(box);
                transform.position = Vec3.clone(box.center);
                transform.scale = Vec3.clone(box.size);
                break;
            }
            case 'ring': {
                const axisIdx = target.axis === 'x' ? 0 : target.axis === 'y' ? 1 : 2;
                const axisWorld = getLocalAxisWorldDirection(box, axisIdx, tmpVec3);
                const angleDelta = ringRotationDelta(camera, vp.width, vp.height, box.center, axisWorld, startX, startY, endX, endY);
                const rotResult = rotateAroundAxis(box.rotation, axisWorld, angleDelta, box.center);
                box.rotation = rotResult.rotation;
                OrientedBoxState.recomputeMatrix(box);
                transform.rotation = Quat.clone(box.rotation);
                transform.position = Vec3.clone(box.center);
                break;
            }
            case 'body': {
                const delta = viewPlaneDragDelta(camera, vp.width, vp.height, box.center, startX, startY, endX, endY);
                Vec3.add(transform.position, transform.position, delta);
                Vec3.add(box.center, box.center, delta);
                break;
            }
        }

        TransformState.recomputeMatrix(transform);
        OrientedBoxState.recomputeMatrix(box);

        this.manager.previewTransform(target.objectId, transform);
    }

    private targetsEqual(a: TransformPickTarget, b: TransformPickTarget): boolean {
        if (a.kind !== b.kind) return false;
        if (a.objectId !== (b as any).objectId) return false;
        if (a.kind === 'axis' || a.kind === 'ring') return a.axis === (b as any).axis;
        if (a.kind === 'face') return a.face === (b as any).face;
        return true;
    }

    private targetToGroupId(target: TransformPickTarget): number {
        switch (target.kind) {
            case 'body': return GizmoGroup.Body;
            case 'center': return GizmoGroup.Center;
            case 'axis':
                return target.axis === 'x' ? GizmoGroup.AxisX :
                       target.axis === 'y' ? GizmoGroup.AxisY : GizmoGroup.AxisZ;
            case 'ring':
                return target.axis === 'x' ? GizmoGroup.RingX :
                       target.axis === 'y' ? GizmoGroup.RingY : GizmoGroup.RingZ;
            case 'face':
                switch (target.face) {
                    case '+x': return GizmoGroup.FacePosX;
                    case '-x': return GizmoGroup.FaceNegX;
                    case '+y': return GizmoGroup.FacePosY;
                    case '-y': return GizmoGroup.FaceNegY;
                    case '+z': return GizmoGroup.FacePosZ;
                    case '-z': return GizmoGroup.FaceNegZ;
                }
        }
        return GizmoGroup.None;
    }

    get currentState(): TransformInteractionState {
        return this.state;
    }
}
