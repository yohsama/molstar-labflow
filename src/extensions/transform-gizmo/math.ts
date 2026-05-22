/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Transform gizmo math: state types and drag interaction math.
 */

import { Vec3, Vec4, Mat4, Quat } from '../../mol-math/linear-algebra';
import { Camera } from '../../mol-canvas3d/camera';
import { Ray3D } from '../../mol-math/geometry/primitives/ray3d';
import { Euler } from '../../mol-math/linear-algebra/3d/euler';

// ---------- TransformState ----------

export interface TransformState {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
    matrix: Mat4;
}

export namespace TransformState {
    export function create(): TransformState {
        return {
            position: Vec3.zero(),
            rotation: Quat.identity(),
            scale: Vec3.create(1, 1, 1),
            matrix: Mat4.identity()
        };
    }

    export function fromPositionRotationScale(position: Vec3, rotation: Quat, scale: Vec3): TransformState {
        const matrix = Mat4.identity();
        Mat4.fromQuat(matrix, rotation);
        Mat4.scale(matrix, matrix, scale);
        Mat4.setTranslation(matrix, position);
        return { position: Vec3.clone(position), rotation: Quat.clone(rotation), scale: Vec3.clone(scale), matrix };
    }

    export function recomputeMatrix(state: TransformState) {
        Mat4.fromQuat(state.matrix, state.rotation);
        Mat4.scale(state.matrix, state.matrix, state.scale);
        Mat4.setTranslation(state.matrix, state.position);
    }

    export function clone(state: TransformState): TransformState {
        return {
            position: Vec3.clone(state.position),
            rotation: Quat.clone(state.rotation),
            scale: Vec3.clone(state.scale),
            matrix: Mat4.clone(state.matrix)
        };
    }
}

// ---------- OrientedBoxState ----------

export interface OrientedBoxState {
    center: Vec3;
    size: Vec3;   // x = length, y = width, z = height
    rotation: Quat;
    matrix: Mat4;
}

export namespace OrientedBoxState {
    export function create(center?: Vec3, size?: Vec3, rotation?: Quat): OrientedBoxState {
        const c = center ? Vec3.clone(center) : Vec3.zero();
        const s = size ? Vec3.clone(size) : Vec3.create(1, 1, 1);
        const r = rotation ? Quat.clone(rotation) : Quat.identity();
        const matrix = Mat4.identity();
        Mat4.fromQuat(matrix, r);
        Mat4.scale(matrix, matrix, s);
        Mat4.setTranslation(matrix, c);
        return { center: c, size: s, rotation: r, matrix };
    }

    export function toTransform(box: OrientedBoxState): TransformState {
        return {
            position: Vec3.clone(box.center),
            rotation: Quat.clone(box.rotation),
            scale: Vec3.clone(box.size),
            matrix: Mat4.clone(box.matrix)
        };
    }

    export function fromTransform(transform: TransformState): OrientedBoxState {
        return {
            center: Vec3.clone(transform.position),
            size: Vec3.clone(transform.scale),
            rotation: Quat.clone(transform.rotation),
            matrix: Mat4.clone(transform.matrix)
        };
    }

    export function recomputeMatrix(box: OrientedBoxState) {
        Mat4.fromQuat(box.matrix, box.rotation);
        Mat4.scale(box.matrix, box.matrix, box.size);
        Mat4.setTranslation(box.matrix, box.center);
    }

    export function clone(box: OrientedBoxState): OrientedBoxState {
        return {
            center: Vec3.clone(box.center),
            size: Vec3.clone(box.size),
            rotation: Quat.clone(box.rotation),
            matrix: Mat4.clone(box.matrix)
        };
    }
}

// ---------- Box Rotation UI Helpers ----------

const BoxRotationEulerOrder: Euler.Order = 'XYZ';
const RadToDeg = 180 / Math.PI;
const DegToRad = Math.PI / 180;

export function boxEulerDegreesToQuat(eulerDegrees: Vec3): Quat {
    const euler = Euler.create(
        eulerDegrees[0] * DegToRad,
        eulerDegrees[1] * DegToRad,
        eulerDegrees[2] * DegToRad
    );
    const rotation = Quat.fromEuler(Quat.identity(), euler, BoxRotationEulerOrder);
    Quat.normalize(rotation, rotation);
    return rotation;
}

export function boxQuatToEulerDegrees(rotation: Quat): Vec3 {
    const euler = Euler.fromQuat(Euler.zero(), rotation, BoxRotationEulerOrder);
    return Vec3.create(euler[0] * RadToDeg, euler[1] * RadToDeg, euler[2] * RadToDeg);
}

// ---------- Drag Math ----------

const tmpVec3a = Vec3.zero();
const tmpVec3b = Vec3.zero();
const tmpVec3c = Vec3.zero();
const tmpVec4a = Vec4.zero();
const tmpVec4b = Vec4.zero();
const tmpQuat = Quat.identity();

/**
 * Project a screen-space pointer delta onto a world-space axis.
 * Returns signed delta along the axis direction.
 */
export function axisDragDelta(
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    objectCenter: Vec3,
    axisWorldDir: Vec3,
    pointerStartX: number,
    pointerStartY: number,
    pointerEndX: number,
    pointerEndY: number
): number {
    const axis = Vec3.normalize(tmpVec3a, axisWorldDir);
    const referenceWorldDistance = Math.max(camera.getPixelSize(objectCenter) * 64, 1);
    const axisPoint = Vec3.scaleAndAdd(tmpVec3b, objectCenter, axis, referenceWorldDistance);

    camera.project(tmpVec4a, objectCenter);
    camera.project(tmpVec4b, axisPoint);

    const axisScreenX = tmpVec4b[0] - tmpVec4a[0];
    const axisScreenY = -(tmpVec4b[1] - tmpVec4a[1]);
    const axisScreenLength = Math.sqrt(axisScreenX * axisScreenX + axisScreenY * axisScreenY);
    if (axisScreenLength < 1e-4) return 0;

    const pointerDeltaX = pointerEndX - pointerStartX;
    const pointerDeltaY = pointerEndY - pointerStartY;
    const signedScreenDelta = (pointerDeltaX * axisScreenX + pointerDeltaY * axisScreenY) / axisScreenLength;
    return signedScreenDelta * referenceWorldDistance / axisScreenLength;
}

/**
 * Drag on the view plane (plane perpendicular to camera view dir through objectCenter).
 * Returns world-space delta on that plane.
 */
export function viewPlaneDragDelta(
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    objectCenter: Vec3,
    pointerStartX: number,
    pointerStartY: number,
    pointerEndX: number,
    pointerEndY: number
): Vec3 {
    const viewDir = Vec3.sub(tmpVec3a, camera.state.target, camera.state.position);
    Vec3.normalize(viewDir, viewDir);

    const rayStart = camera.getRay(Ray3D(), pointerStartX, viewportHeight - pointerStartY);
    const rayEnd = camera.getRay(Ray3D(), pointerEndX, viewportHeight - pointerEndY);

    const denomStart = Vec3.dot(rayStart.direction, viewDir);
    let hitStart = Vec3.clone(objectCenter);
    if (Math.abs(denomStart) > 1e-4) {
        const t = Vec3.dot(Vec3.sub(tmpVec3b, objectCenter, rayStart.origin), viewDir) / denomStart;
        Vec3.scaleAndAdd(hitStart, rayStart.origin, rayStart.direction, t);
    }

    const denomEnd = Vec3.dot(rayEnd.direction, viewDir);
    let hitEnd = Vec3.clone(objectCenter);
    if (Math.abs(denomEnd) > 1e-4) {
        const t = Vec3.dot(Vec3.sub(tmpVec3b, objectCenter, rayEnd.origin), viewDir) / denomEnd;
        Vec3.scaleAndAdd(hitEnd, rayEnd.origin, rayEnd.direction, t);
    }

    return Vec3.sub(tmpVec3c, hitEnd, hitStart);
}

/** Minimum box dimension. */
export const MIN_BOX_SIZE = 0.1;

/**
 * Stretch a box face. `faceSign` is +1 or -1 for the face along `faceAxisIndex` (0=x,1=y,2=z).
 * Returns new center and size.
 */
export function stretchBoxFace(
    box: OrientedBoxState,
    faceAxisIndex: number,
    faceSign: number,
    deltaWorld: number
): { center: Vec3; size: Vec3 } {
    const center = Vec3.clone(box.center);
    const size = Vec3.clone(box.size);

    const axisLocal = faceAxisIndex === 0 ? Vec3.unitX : faceAxisIndex === 1 ? Vec3.unitY : Vec3.unitZ;
    const axisWorld = Vec3.transformQuat(tmpVec3a, axisLocal, box.rotation);
    Vec3.normalize(axisWorld, axisWorld);

    const deltaLocal = deltaWorld * faceSign;

    const newDim = Math.max(size[faceAxisIndex] + deltaLocal, MIN_BOX_SIZE);
    const actualDelta = newDim - size[faceAxisIndex];

    size[faceAxisIndex] = newDim;

    const offsetWorld = Vec3.scale(tmpVec3b, axisWorld, actualDelta * 0.5 * faceSign);
    Vec3.add(center, center, offsetWorld);

    return { center, size };
}

/**
 * Rotate around an axis. `axisWorld` must be normalized.
 * Returns new quaternion.
 */
export function rotateAroundAxis(
    currentRotation: Quat,
    axisWorld: Vec3,
    angleDelta: number,
    pivotWorld: Vec3
): { rotation: Quat; position: Vec3 } {
    const rotQ = Quat.setAxisAngle(tmpQuat, axisWorld, angleDelta);
    const newRotation = Quat.multiply(Quat.identity(), rotQ, currentRotation);
    Quat.normalize(newRotation, newRotation);
    return { rotation: newRotation, position: Vec3.clone(pivotWorld) };
}

/**
 * Compute rotation angle delta from two pointer rays on a rotation ring.
 * Projects ray directions onto the plane perpendicular to axisWorld through pivotWorld.
 */
export function ringRotationDelta(
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    pivotWorld: Vec3,
    axisWorld: Vec3,
    pointerStartX: number,
    pointerStartY: number,
    pointerEndX: number,
    pointerEndY: number
): number {
    const rayStart = camera.getRay(Ray3D(), pointerStartX, viewportHeight - pointerStartY);
    const rayEnd = camera.getRay(Ray3D(), pointerEndX, viewportHeight - pointerEndY);

    const denomStart = Vec3.dot(rayStart.direction, axisWorld);
    let hitStart = Vec3.clone(pivotWorld);
    if (Math.abs(denomStart) > 1e-4) {
        const t = Vec3.dot(Vec3.sub(tmpVec3b, pivotWorld, rayStart.origin), axisWorld) / denomStart;
        Vec3.scaleAndAdd(hitStart, rayStart.origin, rayStart.direction, t);
    }

    const denomEnd = Vec3.dot(rayEnd.direction, axisWorld);
    let hitEnd = Vec3.clone(pivotWorld);
    if (Math.abs(denomEnd) > 1e-4) {
        const t = Vec3.dot(Vec3.sub(tmpVec3b, pivotWorld, rayEnd.origin), axisWorld) / denomEnd;
        Vec3.scaleAndAdd(hitEnd, rayEnd.origin, rayEnd.direction, t);
    }

    const v1 = Vec3.sub(tmpVec3a, hitStart, pivotWorld);
    const v2 = Vec3.sub(tmpVec3b, hitEnd, pivotWorld);

    Vec3.sub(v1, v1, Vec3.scale(tmpVec3c, axisWorld, Vec3.dot(v1, axisWorld)));
    Vec3.sub(v2, v2, Vec3.scale(tmpVec3c, axisWorld, Vec3.dot(v2, axisWorld)));

    const len1 = Vec3.magnitude(v1);
    const len2 = Vec3.magnitude(v2);
    if (len1 < 1e-4 || len2 < 1e-4) return 0;

    Vec3.scale(v1, v1, 1 / len1);
    Vec3.scale(v2, v2, 1 / len2);

    const cross = Vec3.cross(tmpVec3c, v1, v2);
    const sinA = Vec3.dot(cross, axisWorld);
    const cosA = Vec3.dot(v1, v2);
    return Math.atan2(sinA, cosA);
}
