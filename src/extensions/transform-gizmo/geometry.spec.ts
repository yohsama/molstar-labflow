import { createGizmoMesh, GizmoGroup } from './geometry';

function groupStats(mesh: ReturnType<typeof createGizmoMesh>, groupId: number) {
    const vertices = mesh.vertexBuffer.ref.value;
    const groups = mesh.groupBuffer.ref.value;
    const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const center = [0, 0, 0];
    let count = 0;

    for (let i = 0; i < mesh.vertexCount; i++) {
        if (groups[i] !== groupId) continue;
        const x = vertices[i * 3];
        const y = vertices[i * 3 + 1];
        const z = vertices[i * 3 + 2];
        min[0] = Math.min(min[0], x);
        min[1] = Math.min(min[1], y);
        min[2] = Math.min(min[2], z);
        max[0] = Math.max(max[0], x);
        max[1] = Math.max(max[1], y);
        max[2] = Math.max(max[2], z);
        center[0] += x;
        center[1] += y;
        center[2] += z;
        count++;
    }

    if (count === 0) throw new Error(`group ${groupId} has no vertices`);
    center[0] /= count;
    center[1] /= count;
    center[2] /= count;

    return { min, max, center, count };
}

function maxTransverseRadiusNearX(mesh: ReturnType<typeof createGizmoMesh>, groupId: number, near: 'min' | 'max') {
    const vertices = mesh.vertexBuffer.ref.value;
    const groups = mesh.groupBuffer.ref.value;
    const stats = groupStats(mesh, groupId);
    const span = stats.max[0] - stats.min[0];
    const threshold = near === 'max'
        ? stats.max[0] - span * 0.25
        : stats.min[0] + span * 0.25;
    let maxRadius = 0;

    for (let i = 0; i < mesh.vertexCount; i++) {
        if (groups[i] !== groupId) continue;
        const x = vertices[i * 3];
        if (near === 'max' ? x < threshold : x > threshold) continue;
        const y = vertices[i * 3 + 1];
        const z = vertices[i * 3 + 2];
        maxRadius = Math.max(maxRadius, Math.sqrt(y * y + z * z));
    }

    return maxRadius;
}

describe('transform-gizmo geometry', () => {
    it('places face pull handles near the middle of each axis at default scene scale', () => {
        const mesh = createGizmoMesh(2);

        const axisX = groupStats(mesh, GizmoGroup.AxisX);
        const axisY = groupStats(mesh, GizmoGroup.AxisY);
        const axisZ = groupStats(mesh, GizmoGroup.AxisZ);
        const faceX = groupStats(mesh, GizmoGroup.FacePosX);
        const faceY = groupStats(mesh, GizmoGroup.FacePosY);
        const faceZ = groupStats(mesh, GizmoGroup.FacePosZ);

        expect(faceX.center[0] / axisX.max[0]).toBeGreaterThan(0.45);
        expect(faceX.center[0] / axisX.max[0]).toBeLessThan(0.70);
        expect(faceY.center[1] / axisY.max[1]).toBeGreaterThan(0.45);
        expect(faceY.center[1] / axisY.max[1]).toBeLessThan(0.70);
        expect(faceZ.center[2] / axisZ.max[2]).toBeGreaterThan(0.45);
        expect(faceZ.center[2] / axisZ.max[2]).toBeLessThan(0.70);
    });

    it('uses larger handles and a larger gizmo footprint for easier picking', () => {
        const mesh = createGizmoMesh(2);
        const axisX = groupStats(mesh, GizmoGroup.AxisX);
        const axisArrowX = groupStats(mesh, GizmoGroup.AxisArrowX);
        const faceX = groupStats(mesh, GizmoGroup.FacePosX);
        const center = groupStats(mesh, GizmoGroup.Center);

        expect(Math.max(axisX.max[0], axisArrowX.max[0])).toBeGreaterThan(3.0);
        expect(faceX.max[0] - faceX.min[0]).toBeGreaterThan(0.75);
        expect(faceX.max[1] - faceX.min[1]).toBeGreaterThan(0.25);
        expect(center.max[0] - center.min[0]).toBeGreaterThan(0.45);
    });

    it('adds explicit arrowhead groups for translation axes and rotation rings', () => {
        const mesh = createGizmoMesh(2);

        const axisArrowX = groupStats(mesh, GizmoGroup.AxisArrowX);
        const axisArrowY = groupStats(mesh, GizmoGroup.AxisArrowY);
        const axisArrowZ = groupStats(mesh, GizmoGroup.AxisArrowZ);
        const ringArrowX = groupStats(mesh, GizmoGroup.RingArrowX);
        const ringArrowY = groupStats(mesh, GizmoGroup.RingArrowY);
        const ringArrowZ = groupStats(mesh, GizmoGroup.RingArrowZ);

        expect(axisArrowX.center[0]).toBeGreaterThan(2.8);
        expect(axisArrowY.center[1]).toBeGreaterThan(2.8);
        expect(axisArrowZ.center[2]).toBeGreaterThan(2.8);

        expect(ringArrowX.count).toBeGreaterThan(0);
        expect(ringArrowY.count).toBeGreaterThan(0);
        expect(ringArrowZ.count).toBeGreaterThan(0);
    });

    it('uses elongated cuboids for the axis pull handles', () => {
        const mesh = createGizmoMesh(2);
        const faceX = groupStats(mesh, GizmoGroup.FacePosX);
        const faceY = groupStats(mesh, GizmoGroup.FacePosY);
        const faceZ = groupStats(mesh, GizmoGroup.FacePosZ);

        expect(faceX.max[0] - faceX.min[0]).toBeGreaterThan((faceX.max[1] - faceX.min[1]) * 1.6);
        expect(faceY.max[1] - faceY.min[1]).toBeGreaterThan((faceY.max[0] - faceY.min[0]) * 1.6);
        expect(faceZ.max[2] - faceZ.min[2]).toBeGreaterThan((faceZ.max[0] - faceZ.min[0]) * 1.6);
    });

    it('orients translation axis arrows with the point outward', () => {
        const mesh = createGizmoMesh(2);
        expect(maxTransverseRadiusNearX(mesh, GizmoGroup.AxisArrowX, 'max')).toBeLessThan(
            maxTransverseRadiusNearX(mesh, GizmoGroup.AxisArrowX, 'min')
        );
    });
});
