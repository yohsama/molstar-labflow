/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Transform gizmo geometry builders.
 */

import { Vec3, Mat4 } from '../../mol-math/linear-algebra';
import { MeshBuilder } from '../../mol-geo/geometry/mesh/mesh-builder';
import { Mesh } from '../../mol-geo/geometry/mesh/mesh';
import { LinesBuilder } from '../../mol-geo/geometry/lines/lines-builder';
import { Lines } from '../../mol-geo/geometry/lines/lines';
import { addSphere } from '../../mol-geo/geometry/mesh/builder/sphere';
import { addCylinder } from '../../mol-geo/geometry/mesh/builder/cylinder';
import { Torus } from '../../mol-geo/primitive/torus';
import { Box } from '../../mol-geo/primitive/box';
// import { Sphere3D } from '../../mol-math/geometry';

// ---------- Pick Target Groups ----------

export const GizmoGroup = {
    None: 0,
    Body: 1,
    Center: 2,
    AxisX: 3,
    AxisY: 4,
    AxisZ: 5,
    RingX: 6,
    RingY: 7,
    RingZ: 8,
    FacePosX: 9,
    FaceNegX: 10,
    FacePosY: 11,
    FaceNegY: 12,
    FacePosZ: 13,
    FaceNegZ: 14,
    AxisArrowX: 15,
    AxisArrowY: 16,
    AxisArrowZ: 17,
    RingArrowX: 18,
    RingArrowY: 19,
    RingArrowZ: 20,
} as const;

export type GizmoGroupId = typeof GizmoGroup[keyof typeof GizmoGroup];

// ---------- Box Geometry ----------

const tmpBoxMat = Mat4.identity();
const tmpVecA = Vec3();
const tmpVecB = Vec3();

/** Build a unit cube mesh (faces only) with per-face groups for picking. */
export function createBoxFaceMesh(): Mesh {
    const state = MeshBuilder.createState(256, 128);

    const c = [
        Vec3.create(-0.5, -0.5, -0.5),
        Vec3.create( 0.5, -0.5, -0.5),
        Vec3.create( 0.5,  0.5, -0.5),
        Vec3.create(-0.5,  0.5, -0.5),
        Vec3.create(-0.5, -0.5,  0.5),
        Vec3.create( 0.5, -0.5,  0.5),
        Vec3.create( 0.5,  0.5,  0.5),
        Vec3.create(-0.5,  0.5,  0.5),
    ];

    const nx = Vec3.create(1, 0, 0);
    const nxn = Vec3.create(-1, 0, 0);
    const ny = Vec3.create(0, 1, 0);
    const nyn = Vec3.create(0, -1, 0);
    const nz = Vec3.create(0, 0, 1);
    const nzn = Vec3.create(0, 0, -1);

    state.currentGroup = GizmoGroup.FacePosX;
    MeshBuilder.addTriangleWithNormal(state, c[1], c[5], c[6], nx);
    MeshBuilder.addTriangleWithNormal(state, c[1], c[6], c[2], nx);

    state.currentGroup = GizmoGroup.FaceNegX;
    MeshBuilder.addTriangleWithNormal(state, c[0], c[3], c[7], nxn);
    MeshBuilder.addTriangleWithNormal(state, c[0], c[7], c[4], nxn);

    state.currentGroup = GizmoGroup.FacePosY;
    MeshBuilder.addTriangleWithNormal(state, c[3], c[2], c[6], ny);
    MeshBuilder.addTriangleWithNormal(state, c[3], c[6], c[7], ny);

    state.currentGroup = GizmoGroup.FaceNegY;
    MeshBuilder.addTriangleWithNormal(state, c[0], c[4], c[5], nyn);
    MeshBuilder.addTriangleWithNormal(state, c[0], c[5], c[1], nyn);

    state.currentGroup = GizmoGroup.FacePosZ;
    MeshBuilder.addTriangleWithNormal(state, c[4], c[7], c[6], nz);
    MeshBuilder.addTriangleWithNormal(state, c[4], c[6], c[5], nz);

    state.currentGroup = GizmoGroup.FaceNegZ;
    MeshBuilder.addTriangleWithNormal(state, c[0], c[1], c[2], nzn);
    MeshBuilder.addTriangleWithNormal(state, c[0], c[2], c[3], nzn);

    return MeshBuilder.getMesh(state);
}

/** Build box edge lines. All edges share group Body for picking edges as a whole. */
export function createBoxEdgeLines(): Lines {
    const builder = LinesBuilder.create(64, 32);
    const s = 0.5;
    const g = GizmoGroup.Body;

    const corners = [
        Vec3.create(-s, -s, -s), Vec3.create( s, -s, -s),
        Vec3.create( s,  s, -s), Vec3.create(-s,  s, -s),
        Vec3.create(-s, -s,  s), Vec3.create( s, -s,  s),
        Vec3.create( s,  s,  s), Vec3.create(-s,  s,  s),
    ];

    const edges = [
        [0,1],[1,2],[2,3],[3,0],
        [4,5],[5,6],[6,7],[7,4],
        [0,4],[1,5],[2,6],[3,7],
    ];

    for (const [a, b] of edges) {
        builder.addVec(corners[a], corners[b], g);
    }

    return builder.getLines();
}

// ---------- Gizmo Geometry ----------

/** Build gizmo mesh: center sphere, axis arrows, rotation rings, face handles.
 *  `scale` is applied to all gizmo dimensions so it matches the target object size.
 */
export function createGizmoMesh(scale: number = 1.0, options?: { includeFaceHandles?: boolean }): Mesh {
    const includeFaceHandles = options?.includeFaceHandles ?? true;
    const s = scale;
    const AXIS_LENGTH = 1.55 * s;
    const AXIS_RADIUS = 0.05 * s;
    const CONE_RADIUS = 0.12 * s;
    const CONE_LENGTH = 0.22 * s;
    const RING_RADIUS = 1.05 * s;
    const RING_TUBE = 0.04 * s;
    const RING_ARROW_RADIUS = 0.12 * s;
    const RING_ARROW_LENGTH = 0.24 * s;
    const CENTER_RADIUS = 0.13 * s;
    const FACE_HANDLE_LENGTH = 0.44 * s;
    const FACE_HANDLE_THICKNESS = 0.14 * s;
    const FACE_HANDLE_OFFSET = AXIS_LENGTH * 0.55;

    const state = MeshBuilder.createState(2048, 1024);

    const cylinderProps = { radiusTop: AXIS_RADIUS, radiusBottom: AXIS_RADIUS, radialSegments: 16 };
    const coneProps = { radiusTop: CONE_RADIUS, radiusBottom: 0, radialSegments: 24 };
    const ringArrowProps = { radiusTop: RING_ARROW_RADIUS, radiusBottom: 0, radialSegments: 24 };

    const addAxisArrow = (groupId: number, tip: Vec3) => {
        const base = Vec3.setMagnitude(Vec3.clone(tip), tip, AXIS_LENGTH - CONE_LENGTH);
        state.currentGroup = groupId;
        addCylinder(state, base, tip, 1, coneProps);
    };

    const addRingArrow = (groupId: number, transform: Mat4) => {
        const angle = Math.PI / 4;
        const tangent = Vec3.create(-Math.sin(angle), Math.cos(angle), 0);
        const tip = Vec3.create(Math.cos(angle) * RING_RADIUS, Math.sin(angle) * RING_RADIUS, 0);
        const base = Vec3.scaleAndAdd(tmpVecA, tip, tangent, -RING_ARROW_LENGTH);

        Vec3.transformMat4(tmpVecB, tip, transform);
        Vec3.transformMat4(tmpVecA, base, transform);

        state.currentGroup = groupId;
        addCylinder(state, tmpVecA, tmpVecB, 1, ringArrowProps);
    };

    const addAxisBoxHandle = (groupId: number, position: Vec3, scale: Vec3) => {
        Mat4.fromScaling(tmpBoxMat, scale);
        Mat4.setTranslation(tmpBoxMat, position);
        state.currentGroup = groupId;
        MeshBuilder.addPrimitive(state, tmpBoxMat, Box());
    };

    // Center sphere
    state.currentGroup = GizmoGroup.Center;
    addSphere(state, Vec3.origin, CENTER_RADIUS, 2);

    // Axis X
    const xTip = Vec3.create(AXIS_LENGTH, 0, 0);
    state.currentGroup = GizmoGroup.AxisX;
    addCylinder(state, Vec3.origin, Vec3.create(AXIS_LENGTH - CONE_LENGTH, 0, 0), 1, cylinderProps);
    addAxisArrow(GizmoGroup.AxisArrowX, xTip);

    // Axis Y
    const yTip = Vec3.create(0, AXIS_LENGTH, 0);
    state.currentGroup = GizmoGroup.AxisY;
    addCylinder(state, Vec3.origin, Vec3.create(0, AXIS_LENGTH - CONE_LENGTH, 0), 1, cylinderProps);
    addAxisArrow(GizmoGroup.AxisArrowY, yTip);

    // Axis Z
    const zTip = Vec3.create(0, 0, AXIS_LENGTH);
    state.currentGroup = GizmoGroup.AxisZ;
    addCylinder(state, Vec3.origin, Vec3.create(0, 0, AXIS_LENGTH - CONE_LENGTH), 1, cylinderProps);
    addAxisArrow(GizmoGroup.AxisArrowZ, zTip);

    // Rotation rings
    const torus = Torus({ radius: RING_RADIUS, tube: RING_TUBE, radialSegments: 8, tubularSegments: 32, arc: Math.PI * 2 });

    state.currentGroup = GizmoGroup.RingX;
    Mat4.fromRotation(tmpBoxMat, Math.PI / 2, Vec3.unitY);
    MeshBuilder.addPrimitive(state, tmpBoxMat, torus);
    addRingArrow(GizmoGroup.RingArrowX, tmpBoxMat);

    state.currentGroup = GizmoGroup.RingY;
    Mat4.fromRotation(tmpBoxMat, -Math.PI / 2, Vec3.unitX);
    MeshBuilder.addPrimitive(state, tmpBoxMat, torus);
    addRingArrow(GizmoGroup.RingArrowY, tmpBoxMat);

    state.currentGroup = GizmoGroup.RingZ;
    Mat4.setIdentity(tmpBoxMat);
    MeshBuilder.addPrimitive(state, tmpBoxMat, torus);
    addRingArrow(GizmoGroup.RingArrowZ, tmpBoxMat);

    // Axis pull handles are box-only scale/stretch handles.
    if (includeFaceHandles) {
        addAxisBoxHandle(GizmoGroup.FacePosX, Vec3.create( FACE_HANDLE_OFFSET, 0, 0), Vec3.create(FACE_HANDLE_LENGTH, FACE_HANDLE_THICKNESS, FACE_HANDLE_THICKNESS));
        addAxisBoxHandle(GizmoGroup.FaceNegX, Vec3.create(-FACE_HANDLE_OFFSET, 0, 0), Vec3.create(FACE_HANDLE_LENGTH, FACE_HANDLE_THICKNESS, FACE_HANDLE_THICKNESS));
        addAxisBoxHandle(GizmoGroup.FacePosY, Vec3.create(0,  FACE_HANDLE_OFFSET, 0), Vec3.create(FACE_HANDLE_THICKNESS, FACE_HANDLE_LENGTH, FACE_HANDLE_THICKNESS));
        addAxisBoxHandle(GizmoGroup.FaceNegY, Vec3.create(0, -FACE_HANDLE_OFFSET, 0), Vec3.create(FACE_HANDLE_THICKNESS, FACE_HANDLE_LENGTH, FACE_HANDLE_THICKNESS));
        addAxisBoxHandle(GizmoGroup.FacePosZ, Vec3.create(0, 0,  FACE_HANDLE_OFFSET), Vec3.create(FACE_HANDLE_THICKNESS, FACE_HANDLE_THICKNESS, FACE_HANDLE_LENGTH));
        addAxisBoxHandle(GizmoGroup.FaceNegZ, Vec3.create(0, 0, -FACE_HANDLE_OFFSET), Vec3.create(FACE_HANDLE_THICKNESS, FACE_HANDLE_THICKNESS, FACE_HANDLE_LENGTH));
    }

    return MeshBuilder.getMesh(state);
}
