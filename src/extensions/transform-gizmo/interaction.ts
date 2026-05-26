/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Interaction state machine for transform gizmo.
 * Subscribes to Canvas3D interaction events and manages drag sessions.
 */

import { PluginContext } from '../../mol-plugin/context';
import { Canvas3D } from '../../mol-canvas3d/canvas3d';
import { Subscription } from 'rxjs';
import { Vec2, Vec3, Mat4, Quat } from '../../mol-math/linear-algebra';
import { eventOffset as getClientEventOffset } from '../../mol-util/input/event-offset';

import { TransformObjectKind, TransformObjectManager } from './manager';
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

type TransformPickSource = 'box-face' | 'box-edge' | 'gizmo';

interface ResolvedTransformPick {
    target: TransformPickTarget;
    source: TransformPickSource;
}

// ---------- Interaction State ----------

export type TransformInteractionState =
    | { mode: 'idle' }
    | { mode: 'hover'; target: TransformPickTarget }
    | { mode: 'dragging'; target: TransformPickTarget; session: DragSession };

interface DragSession {
    startX: number;
    startY: number;
    dragStartX: number; // CSS-pixel initial position (from first drag event endX)
    dragStartY: number;
    objectKind: TransformObjectKind;
    initialBox?: OrientedBoxState;
    initialTransform: TransformState;
    savedTrackballProps: { rotateSpeed: number; panSpeed: number; zoomSpeed: number };
}

// ---------- Helpers ----------

const tmpVec3 = Vec3.zero();
const tmpMat4 = Mat4.identity();

function groupIdToPickTarget(objectId: string, groupId: number): TransformPickTarget | undefined {
    switch (groupId) {
        case GizmoGroup.Body: return { kind: 'body', objectId };
        case GizmoGroup.Center: return { kind: 'center', objectId };
        case GizmoGroup.AxisX: case GizmoGroup.AxisArrowX: return { kind: 'axis', objectId, axis: 'x' };
        case GizmoGroup.AxisY: case GizmoGroup.AxisArrowY: return { kind: 'axis', objectId, axis: 'y' };
        case GizmoGroup.AxisZ: case GizmoGroup.AxisArrowZ: return { kind: 'axis', objectId, axis: 'z' };
        case GizmoGroup.RingX: case GizmoGroup.RingArrowX: return { kind: 'ring', objectId, axis: 'x' };
        case GizmoGroup.RingY: case GizmoGroup.RingArrowY: return { kind: 'ring', objectId, axis: 'y' };
        case GizmoGroup.RingZ: case GizmoGroup.RingArrowZ: return { kind: 'ring', objectId, axis: 'z' };
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

function getLocalAxisWorldDirectionFromRotation(rotation: Quat, axisIndex: number, out: Vec3): Vec3 {
    Mat4.fromQuat(tmpMat4, rotation);
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
    private mouseDownListener?: (ev: MouseEvent) => void;
    private mouseMoveListener?: (ev: MouseEvent) => void;
    private mouseUpListener?: (ev: MouseEvent) => void;
    private waitingForCanvas = false;
    private stopped = false;

    constructor(
        private plugin: PluginContext,
        private manager: TransformObjectManager
    ) {}

    start() {
        this.stopped = false;
        const c3d = this.plugin.canvas3d;
        if (!c3d) {
            this.startWhenCanvasReady();
            return;
        }

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
            this.handleDrag(e.pageEnd[0], e.pageEnd[1]);
        }));

        this.subs.push(c3d.input.interactionEnd.subscribe(() => {
            if (!this.manager.isEnabled) return;
            this.endDrag();
        }));

        this.installNativeMouseCapture();
    }

    stop() {
        this.stopped = true;
        for (const s of this.subs) s.unsubscribe();
        this.subs = [];
        this.uninstallNativeMouseCapture();
        this.removeNativeDragListeners();
    }

    private get canvas3d(): Canvas3D | undefined {
        return this.plugin.canvas3d;
    }

    private get canvas(): HTMLCanvasElement | undefined {
        return this.plugin.canvas3dContext?.canvas;
    }

    private startWhenCanvasReady() {
        if (this.waitingForCanvas) return;
        this.waitingForCanvas = true;
        this.plugin.canvas3dInitialized.then(() => {
            this.waitingForCanvas = false;
            if (!this.stopped) this.start();
        });
    }

    private get eventWindow(): Window | undefined {
        return this.canvas?.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined);
    }

    private installNativeMouseCapture() {
        const canvas = this.canvas;
        if (!canvas || this.mouseDownListener) return;
        this.mouseDownListener = ev => this.handleNativeMouseDown(ev);
        canvas.addEventListener('mousedown', this.mouseDownListener, true);
    }

    private uninstallNativeMouseCapture() {
        const canvas = this.canvas;
        if (!canvas || !this.mouseDownListener) return;
        canvas.removeEventListener('mousedown', this.mouseDownListener, true);
        this.mouseDownListener = undefined;
    }

    private addNativeDragListeners() {
        const win = this.eventWindow;
        if (!win) return;
        if (this.mouseMoveListener || this.mouseUpListener) return;
        this.mouseMoveListener = ev => this.handleNativeMouseMove(ev);
        this.mouseUpListener = ev => this.handleNativeMouseUp(ev);
        win.addEventListener('mousemove', this.mouseMoveListener, true);
        win.addEventListener('mouseup', this.mouseUpListener, true);
    }

    private removeNativeDragListeners() {
        const win = this.eventWindow;
        if (!win) return;
        if (this.mouseMoveListener) {
            win.removeEventListener('mousemove', this.mouseMoveListener, true);
            this.mouseMoveListener = undefined;
        }
        if (this.mouseUpListener) {
            win.removeEventListener('mouseup', this.mouseUpListener, true);
            this.mouseUpListener = undefined;
        }
    }

    private canvasPoint(ev: MouseEvent): Vec2 | undefined {
        const canvas = this.canvas;
        if (!canvas) return undefined;
        return getClientEventOffset(Vec2(), ev, canvas);
    }

    private stopNativeEvent(ev: MouseEvent) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
    }

    private pickHitAt(x: number, y: number): ResolvedTransformPick | undefined {
        const freshLoci = this.pickLociAt(x, y);
        return this.resolvePickHit(freshLoci);
    }

    private pickLociAt(x: number, y: number): import('../../mol-repr/representation').Representation.Loci | undefined {
        const c3d = this.canvas3d;
        if (!c3d) return undefined;
        const pickData = c3d.identify(Vec2.create(x, y));
        return c3d.getLoci(pickData?.id);
    }

    private isEditablePick(hit: ResolvedTransformPick): boolean {
        if (hit.source !== 'gizmo') return false;
        const canUse = (this.manager as any).canUsePickTarget?.(hit.target);
        return canUse !== false;
    }

    private isTransformMode(): boolean {
        const getMode = (this.manager as any).getMode;
        return typeof getMode === 'function' && getMode.call(this.manager) === 'transform';
    }

    private handleNativeMouseDown(ev: MouseEvent) {
        if (!this.manager.isEnabled || ev.button !== 0) return;
        const point = this.canvasPoint(ev);
        if (!point) return;

        const hit = this.pickHitAt(point[0], point[1]);
        if (hit && this.isEditablePick(hit)) {
            if (!this.beginDrag(hit.target, point[0], point[1])) return;

            this.stopNativeEvent(ev);
            this.addNativeDragListeners();
            return;
        }

        if (this.isTransformMode()) {
            if (hit && hit.source !== 'gizmo') {
                // Let the Canvas3D click pipeline activate the object via handleClick(),
                // which fires on the standard InputObserver → Canvas3D interaction path.
                // Do NOT stop propagation here: stopNativeEvent would prevent the
                // InputObserver from seeing this mousedown, so click/drag detection
                // would be lost and the gizmo would never appear.
                return;
            }

            const loci = this.pickLociAt(point[0], point[1]);
            const selected = (this.manager as any).selectRootStructureFromLoci?.(loci?.loci);
            if (selected) {
                this.stopNativeEvent(ev);
            }
            // Do NOT deselect on mousedown on blank space here — that would
            // fire before the click/drag distinction is made, closing the
            // gizmo even when the user starts a camera rotate drag.
            // Deselection on blank-space CLICK is handled by handleClick().
        }
    }

    private handleNativeMouseMove(ev: MouseEvent) {
        if (this.state.mode !== 'dragging') return;
        const point = this.canvasPoint(ev);
        if (!point) return;

        const { target, session } = this.state;
        this.applyDrag(target, session, session.dragStartX, session.dragStartY, point[0], point[1]);
        this.stopNativeEvent(ev);
    }

    private handleNativeMouseUp(ev: MouseEvent) {
        if (this.state.mode !== 'dragging') return;
        this.stopNativeEvent(ev);
        this.removeNativeDragListeners();
        this.endDrag();
    }

    private resolvePickTarget(loci: import('../../mol-repr/representation').Representation.Loci): TransformPickTarget | undefined {
        return this.resolvePickHit(loci)?.target;
    }

    private resolvePickHit(loci: import('../../mol-repr/representation').Representation.Loci): ResolvedTransformPick | undefined {
        if (!loci || !loci.loci) return undefined;
        const dataLoci = loci.loci as any;
        if (!isTransformGizmoLoci(dataLoci)) return undefined;
        const d = dataLoci.data as TransformGizmoLociData;
        for (const [objId, obj] of this.manager['objects'] as Map<string, any>) {
            const target = groupIdToPickTarget(objId, d.groupId);
            if (!target) continue;

            if (obj.gizmoRenderObject.id === d.objectId) {
                return { target, source: 'gizmo' };
            }
            if (obj.kind === 'box' && obj.faceRenderObject.id === d.objectId) {
                return { target, source: 'box-face' };
            }
            if (obj.kind === 'box' && obj.edgeRenderObject.id === d.objectId) {
                return { target, source: 'box-edge' };
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
        const hit = this.resolvePickHit(reprLoci);
        if (hit && this.isTransformMode()) {
            const target = hit.target;
            this.manager.setActiveObject(target.objectId);
            return;
        }
        if (this.isTransformMode()) {
            const selected = (this.manager as any).selectRootStructureFromLoci?.(reprLoci?.loci);
            if (!selected) this.manager.setActiveObject(undefined);
        }
    }

    private beginDrag(target: TransformPickTarget, startX: number, startY: number): boolean {
        const obj = this.manager.getObject(target.objectId);
        if (!obj) return false;
        const canUse = (this.manager as any).canUsePickTarget?.(target);
        if (canUse === false) return false;

        const c3d = this.canvas3d;
        const savedProps = c3d ? {
            rotateSpeed: c3d.props.trackball.rotateSpeed,
            panSpeed: c3d.props.trackball.panSpeed,
            zoomSpeed: c3d.props.trackball.zoomSpeed,
        } : { rotateSpeed: 0, panSpeed: 0, zoomSpeed: 0 };

        if (c3d) {
            c3d.setProps({ trackball: { rotateSpeed: 0, panSpeed: 0, zoomSpeed: 0 } }, true);
        }

        const objectKind: TransformObjectKind = obj.kind ?? 'box';
        const initialBox = objectKind === 'box' ? OrientedBoxState.clone(obj.state as OrientedBoxState) : undefined;
        const initialTransform = initialBox ? OrientedBoxState.toTransform(initialBox) : TransformState.clone(obj.state as TransformState);

        this.state = {
            mode: 'dragging',
            target,
            session: {
                startX,
                startY,
                dragStartX: startX,
                dragStartY: startY,
                objectKind,
                initialBox,
                initialTransform,
                savedTrackballProps: savedProps,
            }
        };
        return true;
    }

    private handleDrag(endX: number, endY: number) {
        if (this.state.mode !== 'dragging') return;
        const { target, session } = this.state;
        this.applyDrag(target, session, session.dragStartX, session.dragStartY, endX, endY);
    }

    endDrag() {
        if (this.state.mode !== 'dragging') return;
        const { target, session } = this.state;
        this.removeNativeDragListeners();

        const c3d = this.canvas3d;
        if (c3d) {
            c3d.setProps({ trackball: session.savedTrackballProps }, true);
        }

        const obj = this.manager.getObject(target.objectId);
        if (obj) {
            const finalTransform = obj.kind === 'box'
                ? OrientedBoxState.toTransform(obj.state as OrientedBoxState)
                : TransformState.clone(obj.state as TransformState);
            void this.manager.commitTransform(target.objectId, finalTransform);
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

        // Convert CSS-pixel coordinates from Canvas3D interaction events
        // into physical pixels for camera.getRay.
        const pr = (c3d as any).webgl?.pixelRatio ?? 1;
        const psx = startX * pr;
        const psy = startY * pr;
        const pex = endX * pr;
        const pey = endY * pr;

        const transform = TransformState.clone(session.initialTransform);
        const box = session.initialBox ? OrientedBoxState.clone(session.initialBox) : undefined;
        const center = box ? box.center : transform.position;
        const rotation = box ? box.rotation : transform.rotation;

        switch (target.kind) {
            case 'center': {
                const delta = viewPlaneDragDelta(camera, vp.width, vp.height, center, psx, psy, pex, pey);
                Vec3.add(transform.position, transform.position, delta);
                if (box) Vec3.add(box.center, box.center, delta);
                break;
            }
            case 'axis': {
                const axisIdx = target.axis === 'x' ? 0 : target.axis === 'y' ? 1 : 2;
                const axisWorld = box ? getLocalAxisWorldDirection(box, axisIdx, tmpVec3) : getLocalAxisWorldDirectionFromRotation(rotation, axisIdx, tmpVec3);
                const delta = axisDragDelta(camera, vp.width, vp.height, center, axisWorld, psx, psy, pex, pey);
                const move = Vec3.scale(tmpVec3, axisWorld, delta);
                Vec3.add(transform.position, transform.position, move);
                if (box) Vec3.add(box.center, box.center, move);
                break;
            }
            case 'face': {
                if (!box) return;
                const axisIdx = faceToAxisIndex(target);
                const sign = faceSign(target);
                const axisWorld = getLocalAxisWorldDirection(box, axisIdx, tmpVec3);
                const delta = axisDragDelta(camera, vp.width, vp.height, box.center, axisWorld, psx, psy, pex, pey);
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
                const axisWorld = box ? getLocalAxisWorldDirection(box, axisIdx, tmpVec3) : getLocalAxisWorldDirectionFromRotation(rotation, axisIdx, tmpVec3);
                const angleDelta = ringRotationDelta(camera, vp.width, vp.height, center, axisWorld, psx, psy, pex, pey);
                const rotResult = rotateAroundAxis(rotation, axisWorld, angleDelta, center);
                transform.rotation = Quat.clone(rotResult.rotation);
                transform.position = Vec3.clone(center);
                if (box) {
                    box.rotation = rotResult.rotation;
                    OrientedBoxState.recomputeMatrix(box);
                    transform.rotation = Quat.clone(box.rotation);
                    transform.position = Vec3.clone(box.center);
                }
                break;
            }
            case 'body': {
                const delta = viewPlaneDragDelta(camera, vp.width, vp.height, center, psx, psy, pex, pey);
                Vec3.add(transform.position, transform.position, delta);
                if (box) Vec3.add(box.center, box.center, delta);
                break;
            }
        }

        TransformState.recomputeMatrix(transform);
        if (box) OrientedBoxState.recomputeMatrix(box);

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
