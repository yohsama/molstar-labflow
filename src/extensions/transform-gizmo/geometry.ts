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
import { Sphere3D } from '../../mol-math/geometry';

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
} as const;

export type GizmoGroupId = typeof GizmoGroup[keyof typeof GizmoGroup];

// ---------- Box Geometry ----------

const tmpBoxMat = Mat4.identity();

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

const GIZMO_SCALE = 1.0;
const AXIS_LENGTH = 1.2 * GIZMO_SCALE;
const AXIS_RADIUS = 0.03 * GIZMO_SCALE;
const CONE_RADIUS = 0.08 * GIZMO_SCALE;
const RING_RADIUS = 0.8 * GIZMO_SCALE;
const RING_TUBE = 0.025 * GIZMO_SCALE;
const CENTER_RADIUS = 0.08 * GIZMO_SCALE;
const FACE_HANDLE_SIZE = 0.08 * GIZMO_SCALE;

/** Build gizmo mesh: center sphere, axis arrows, rotation rings, face handles. */
export function createGizmoMesh(): Mesh {
    const state = MeshBuilder.createState(2048, 1024);

    const cylinderProps = { radiusTop: AXIS_RADIUS, radiusBottom: AXIS_RADIUS, radialSegments: 16 };

    // Center sphere
    state.currentGroup = GizmoGroup.Center;
    addSphere(state, Vec3.origin, CENTER_RADIUS, 2);

    // Axis X
    const xTip = Vec3.create(AXIS_LENGTH, 0, 0);
    state.currentGroup = GizmoGroup.AxisX;
    addCylinder(state, Vec3.origin, xTip, 1, cylinderProps);
    addSphere(state, xTip, CONE_RADIUS, 2);

    // Axis Y
    const yTip = Vec3.create(0, AXIS_LENGTH, 0);
    state.currentGroup = GizmoGroup.AxisY;
    addCylinder(state, Vec3.origin, yTip, 1, cylinderProps);
    addSphere(state, yTip, CONE_RADIUS, 2);

    // Axis Z
    const zTip = Vec3.create(0, 0, AXIS_LENGTH);
    state.currentGroup = GizmoGroup.AxisZ;
    addCylinder(state, Vec3.origin, zTip, 1, cylinderProps);
    addSphere(state, zTip, CONE_RADIUS, 2);

    // Rotation rings
    const torus = Torus({ radius: RING_RADIUS, tube: RING_TUBE, radialSegments: 8, tubularSegments: 32, arc: Math.PI * 2 });

    state.currentGroup = GizmoGroup.RingX;
    Mat4.fromRotation(tmpBoxMat, Math.PI / 2, Vec3.unitY);
    MeshBuilder.addPrimitive(state, tmpBoxMat, torus);

    state.currentGroup = GizmoGroup.RingY;
    Mat4.fromRotation(tmpBoxMat, -Math.PI / 2, Vec3.unitX);
    MeshBuilder.addPrimitive(state, tmpBoxMat, torus);

    state.currentGroup = GizmoGroup.RingZ;
    Mat4.setIdentity(tmpBoxMat);
    MeshBuilder.addPrimitive(state, tmpBoxMat, torus);

    // Face handles
    const hs = FACE_HANDLE_SIZE;
    const faceOffset = 0.5 + hs;

    const facePositions: { group: number; pos: Vec3 }[] = [
        { group: GizmoGroup.FacePosX, pos: Vec3.create( faceOffset, 0, 0) },
        { group: GizmoGroup.FaceNegX, pos: Vec3.create(-faceOffset, 0, 0) },
        { group: GizmoGroup.FacePosY, pos: Vec3.create(0,  faceOffset, 0) },
        { group: GizmoGroup.FaceNegY, pos: Vec3.create(0, -faceOffset, 0) },
        { group: GizmoGroup.FacePosZ, pos: Vec3.create(0, 0,  faceOffset) },
        { group: GizmoGroup.FaceNegZ, pos: Vec3.create(0, 0, -faceOffset) },
    ];

    for (const fp of facePositions) {
        state.currentGroup = fp.group;
        addSphere(state, fp.pos, hs, 1);
    }

    return MeshBuilder.getMesh(state);
}
