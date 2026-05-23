import { Viewport } from '../../mol-canvas3d/camera/util';
import { Camera } from '../../mol-canvas3d/camera';
import { Quat, Vec3 } from '../../mol-math/linear-algebra';
import { axisDragDelta, boxEulerDegreesToQuat, boxQuatToEulerDegrees, OrientedBoxState, stretchBoxFace } from './math';

function createTestCamera() {
    const camera = new Camera({
        position: Vec3.create(0, 0, 100),
        target: Vec3.create(0, 0, 0),
        up: Vec3.create(0, 1, 0),
        radius: 50,
        radiusMax: 200,
    }, Viewport.create(0, 0, 800, 600));
    camera.update();
    return camera;
}

describe('transform-gizmo drag math', () => {
    it('maps pointer movement onto a visible world axis', () => {
        const camera = createTestCamera();

        const delta = axisDragDelta(
            camera,
            800,
            600,
            Vec3.create(0, 0, 0),
            Vec3.create(1, 0, 0),
            400,
            300,
            440,
            300
        );

        expect(delta).toBeGreaterThan(0);
    });

    it('stretches a box face along the local face axis only', () => {
        const box = OrientedBoxState.create(
            Vec3.create(10, 20, 30),
            Vec3.create(2, 4, 6),
            Quat.identity()
        );

        const stretched = stretchBoxFace(box, 0, 1, 2);

        expect(Array.from(stretched.size)).toEqual([4, 4, 6]);
        expect(Array.from(stretched.center)).toEqual([11, 20, 30]);
    });
});

describe('transform-gizmo box rotation helpers', () => {
    it('converts Euler degrees to a quaternion and back for single-axis rotations', () => {
        const q = boxEulerDegreesToQuat(Vec3.create(90, 0, 0));
        const euler = boxQuatToEulerDegrees(q);

        expect(euler[0]).toBeCloseTo(90, 5);
        expect(euler[1]).toBeCloseTo(0, 5);
        expect(euler[2]).toBeCloseTo(0, 5);
    });

    it('round-trips common combined Euler angles in degrees', () => {
        const input = Vec3.create(30, -20, 45);
        const q = boxEulerDegreesToQuat(input);
        const euler = boxQuatToEulerDegrees(q);

        expect(euler[0]).toBeCloseTo(input[0], 5);
        expect(euler[1]).toBeCloseTo(input[1], 5);
        expect(euler[2]).toBeCloseTo(input[2], 5);
    });
});
