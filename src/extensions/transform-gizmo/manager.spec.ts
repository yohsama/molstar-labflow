import { ColorNames } from '../../mol-util/color/names';
import { Mat4, Vec3, Quat } from '../../mol-math/linear-algebra';
import { OrderedSet } from '../../mol-data/int';
import { Structure, StructureElement } from '../../mol-model/structure';
import { GizmoGroup } from './geometry';
import { OrientedBoxState, TransformState } from './math';
import { DefaultBoxStyle, getBoxFaceGroupColor, getGizmoGroupColor, TransformObjectManager } from './manager';
import { StructureFocusRepresentationTags } from '../../mol-plugin/behavior/dynamic/selection/structure-focus-representation';
import { StateTransforms } from '../../mol-plugin-state/transforms';
import { SplitRootStructure } from './split-root-structure';

describe('transform-gizmo manager styling', () => {
    it('uses a thicker default box edge size for easier border picking', () => {
        expect(DefaultBoxStyle.edgeSize).toBe(3);
    });

    it('colors box faces by their local axis', () => {
        expect(getBoxFaceGroupColor(DefaultBoxStyle, GizmoGroup.FacePosX)).toBe(ColorNames.red);
        expect(getBoxFaceGroupColor(DefaultBoxStyle, GizmoGroup.FaceNegX)).toBe(ColorNames.red);
        expect(getBoxFaceGroupColor(DefaultBoxStyle, GizmoGroup.FacePosY)).toBe(ColorNames.green);
        expect(getBoxFaceGroupColor(DefaultBoxStyle, GizmoGroup.FaceNegY)).toBe(ColorNames.green);
        expect(getBoxFaceGroupColor(DefaultBoxStyle, GizmoGroup.FacePosZ)).toBe(ColorNames.blue);
        expect(getBoxFaceGroupColor(DefaultBoxStyle, GizmoGroup.FaceNegZ)).toBe(ColorNames.blue);
    });

    it('colors the center translation handle grey', () => {
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.Center)).toBe(ColorNames.grey);
    });

    it('colors the axis pull handles bright yellow', () => {
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.FacePosX)).toBe(ColorNames.yellow);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.FaceNegX)).toBe(ColorNames.yellow);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.FacePosY)).toBe(ColorNames.yellow);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.FaceNegY)).toBe(ColorNames.yellow);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.FacePosZ)).toBe(ColorNames.yellow);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.FaceNegZ)).toBe(ColorNames.yellow);
    });

    it('colors arrowheads like their matching axis or ring', () => {
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.AxisArrowX)).toBe(DefaultBoxStyle.gizmoColorX);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.RingArrowX)).toBe(DefaultBoxStyle.gizmoColorX);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.AxisArrowY)).toBe(DefaultBoxStyle.gizmoColorY);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.RingArrowY)).toBe(DefaultBoxStyle.gizmoColorY);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.AxisArrowZ)).toBe(DefaultBoxStyle.gizmoColorZ);
        expect(getGizmoGroupColor(DefaultBoxStyle, GizmoGroup.RingArrowZ)).toBe(DefaultBoxStyle.gizmoColorZ);
    });
});

describe('TransformObjectManager public box state API', () => {
    function createManager() {
        return new TransformObjectManager({ canvas3d: undefined } as any);
    }

    it('returns a cloned active box state snapshot', () => {
        const manager = createManager();
        const box = manager.addBox(Vec3.create(1, 2, 3), Vec3.create(4, 5, 6), Quat.identity());
        manager.setActiveObject(box.id);

        const snapshot = manager.getActiveBoxState();

        expect(snapshot?.id).toBe(box.id);
        expect(Array.from(snapshot!.center)).toEqual([1, 2, 3]);
        snapshot!.center[0] = 99;
        expect(manager.getActiveBoxState()!.center[0]).toBe(1);
    });

    it('updates active box state from a cloned submitted value', () => {
        const manager = createManager();
        const box = manager.addBox(Vec3.create(1, 2, 3), Vec3.create(4, 5, 6), Quat.identity());
        manager.setActiveObject(box.id);

        const nextState = OrientedBoxState.create(Vec3.create(7, 8, 9), Vec3.create(10, 11, 12), Quat.identity());
        manager.setActiveBoxState(box.id, nextState);
        nextState.center[0] = 99;

        const snapshot = manager.getActiveBoxState()!;
        expect(Array.from(snapshot.center)).toEqual([7, 8, 9]);
        expect(Array.from(snapshot.size)).toEqual([10, 11, 12]);
    });

    it('lists all box states as cloned snapshots with active flags', () => {
        const manager = createManager();
        const first = manager.addBox(Vec3.create(1, 2, 3), Vec3.create(4, 5, 6), Quat.identity());
        const second = manager.addBox(Vec3.create(7, 8, 9), Vec3.create(10, 11, 12), Quat.identity());
        manager.setActiveObject(second.id);

        const boxes = manager.listBoxStates();

        expect(boxes.map(b => b.id)).toEqual([first.id, second.id]);
        expect(boxes.map(b => b.isActive)).toEqual([false, true]);
        boxes[0].center[0] = 99;
        expect(manager.listBoxStates()[0].center[0]).toBe(1);
    });

    it('emits changed events for UI refresh points', () => {
        const manager = createManager();
        const reasons: string[] = [];
        manager.events.changed.subscribe(e => reasons.push(e.reason));

        const box = manager.addBox(Vec3.create(1, 2, 3), Vec3.create(4, 5, 6), Quat.identity());
        manager.setActiveObject(box.id);
        manager.setMode('transform');
        manager.setActiveBoxState(box.id, OrientedBoxState.create(Vec3.create(7, 8, 9), Vec3.create(10, 11, 12), Quat.identity()));
        manager.previewTransform(box.id, TransformState.fromPositionRotationScale(Vec3.create(2, 2, 2), Quat.identity(), Vec3.create(4, 4, 4)));
        manager.commitTransform(box.id, TransformState.fromPositionRotationScale(Vec3.create(3, 3, 3), Quat.identity(), Vec3.create(5, 5, 5)));
        manager.removeObject(box.id);

        expect(reasons).toEqual(expect.arrayContaining(['add', 'select', 'mode', 'update', 'preview', 'commit', 'remove']));
    });
});

describe('TransformObjectManager pose object API', () => {
    function createManager(plugin?: any) {
        return new TransformObjectManager(plugin ?? { canvas3d: undefined });
    }

    function createPoseTarget(sourceRef = 'component-ligand') {
        return {
            sourceKind: 'component' as const,
            label: 'Ligand',
            sourceRef,
            center: Vec3.create(10, 20, 30),
            radius: 15,
            representations: [],
        };
    }

    function createTestStructure(name: string, elements: number[]) {
        const unit = { id: 1, elements } as any;
        return {
            name,
            unitMap: new Map([[unit.id, unit]]),
            boundary: { sphere: { center: Vec3.create(0, 0, 0), radius: 1 } },
        } as any;
    }

    function createTestLoci(structure: any, unitElements: number[], index = 0) {
        const unit = { id: 1, elements: unitElements } as any;
        return StructureElement.Loci(structure, [{ unit, indices: OrderedSet.ofSingleton(index as any) }]);
    }

    function getLastTransform(repr: { setState: jest.Mock }) {
        return repr.setState.mock.calls[repr.setState.mock.calls.length - 1]?.[0]?.transform as Mat4;
    }

    function createStatefulRepr(visible = true) {
        return {
            state: { visible },
            setState: jest.fn(function (this: any, state: any) {
                Object.assign(this.state, state);
            }),
        };
    }

    function createRootStructureRef(ref = 'root-structure', label = 'Input Structure', repr?: any) {
        const structure = {
            label,
            boundary: { sphere: { center: Vec3.create(5, 6, 7), radius: 12 } },
        };
        return {
            cell: {
                transform: { ref, version: '0' },
                obj: { label, data: structure }
            },
            components: repr ? [{
                representations: [{ cell: { obj: { data: { repr } } } }],
                genericRepresentations: [],
            }] : [],
            genericRepresentations: [],
        } as any;
    }

    function createFocusSelectQ(cellsByTag: Record<string, any[]>) {
        return jest.fn((selector: (q: any) => any) => {
            let tag: string | undefined;
            const q = {
                byRef: jest.fn(() => q),
                subtree: jest.fn(() => q),
                withTag: jest.fn((nextTag: string) => {
                    tag = nextTag;
                    return q;
                }),
                ofType: jest.fn(() => q),
                children: jest.fn(() => q),
                withTransformer: jest.fn(() => q),
            };
            selector(q);
            return tag ? cellsByTag[tag] ?? [] : [];
        });
    }

    it('lists only explicitly created pose objects as cloned snapshots', () => {
        const manager = createManager();
        const box = manager.addBox(Vec3.create(1, 2, 3), Vec3.create(4, 5, 6), Quat.identity());

        expect(manager.listPoseObjectStates()).toEqual([]);

        const poseId = manager.createPoseObject(createPoseTarget());
        manager.setActiveObject(poseId);

        const objects = manager.listObjectStates();

        expect(objects.map(o => [o.id, o.kind, o.label, o.isActive])).toEqual([
            [box.id, 'box', 'Box 1', false],
            [poseId, 'pose-object', 'Ligand', true],
        ]);
        objects[1].position[0] = 99;
        expect(manager.listObjectStates()[1].position[0]).toBe(10);
    });

    it('syncs root structures as explicit transform targets without making them active', () => {
        const manager = createManager();
        const root = createRootStructureRef('root-a', 'Protein A');

        manager.syncRootStructures([root]);

        const roots = manager.listRootStructureStates();
        expect(roots.map(r => [r.id, r.kind, r.label, r.isActive, Array.from(r.position)])).toEqual([
            ['root:root-a', 'root-structure', 'Protein A', false, [5, 6, 7]]
        ]);
        roots[0].position[0] = 99;
        expect(manager.listRootStructureStates()[0].position[0]).toBe(5);
    });

    it('keeps boxes inactive for dragging until transform mode is explicitly enabled', () => {
        const manager = createManager();
        const box = manager.addBox(Vec3.create(1, 2, 3), Vec3.create(4, 5, 6), Quat.identity());

        manager.setActiveObject(box.id);

        expect(manager.getMode()).toBe('view');
        expect(manager.canUsePickTarget({ kind: 'center', objectId: box.id })).toBe(false);
    });

    it('creates inactive box and root gizmos as hidden representations', () => {
        const manager = createManager();
        const box = manager.addBox(Vec3.create(1, 2, 3), Vec3.create(4, 5, 6), Quat.identity());
        manager.syncRootStructures([createRootStructureRef('root-a')]);
        const rootId = manager.listRootStructureStates()[0].id;

        expect((manager.getObject(box.id) as any).gizmoRepr.state.visible).toBe(false);
        expect((manager.getObject(rootId) as any).gizmoRepr.state.visible).toBe(false);
    });

    it('only exposes root gizmo handles in transform mode for the active root target', () => {
        const manager = createManager();
        manager.syncRootStructures([createRootStructureRef('root-a')]);
        const rootId = manager.listRootStructureStates()[0].id;

        expect(manager.canUsePickTarget({ kind: 'center', objectId: rootId })).toBe(false);

        manager.setActiveObject(rootId);
        manager.setMode('transform');

        expect(manager.canUsePickTarget({ kind: 'center', objectId: rootId })).toBe(true);
        expect(manager.canUsePickTarget({ kind: 'axis', objectId: rootId })).toBe(true);
        expect(manager.canUsePickTarget({ kind: 'ring', objectId: rootId })).toBe(true);
        expect(manager.canUsePickTarget({ kind: 'face', objectId: rootId })).toBe(false);
    });

    it('can lock a root structure pose to disable gizmo dragging and numeric edits', () => {
        const manager = createManager();
        manager.syncRootStructures([createRootStructureRef('root-a')]);
        const rootId = manager.listRootStructureStates()[0].id;

        manager.setActiveObject(rootId);
        manager.setMode('transform');
        manager.setRootStructureLocked(rootId, true);

        expect(manager.listRootStructureStates()[0].isLocked).toBe(true);
        expect(manager.canUsePickTarget({ kind: 'center', objectId: rootId })).toBe(false);

        manager.setRootStructureTransform(rootId, { position: Vec3.create(20, 30, 40), rotation: Quat.identity() });

        expect(Array.from(manager.listRootStructureStates()[0].position)).toEqual([5, 6, 7]);
    });

    it('selects a root structure target from ordinary molecule loci in transform mode', () => {
        const root = createRootStructureRef('root-a');
        const structure = createTestStructure('picked', [1]);
        const plugin = {
            canvas3d: undefined,
            managers: {
                structure: {
                    hierarchy: {
                        findStructure: jest.fn(() => root),
                    }
                }
            }
        };
        const manager = createManager(plugin);
        manager.setMode('transform');

        const selected = manager.selectRootStructureFromLoci(createTestLoci(structure, [1]));

        expect(selected).toBe('root:root-a');
        expect(manager.activeId).toBe('root:root-a');
        expect(plugin.managers.structure.hierarchy.findStructure).toHaveBeenCalled();
    });

    it('falls back to current root structures when hierarchy selection does not already contain the clicked structure', () => {
        const root = createRootStructureRef('root-a');
        const structure = createTestStructure('picked', [1]);
        const plugin = {
            canvas3d: undefined,
            helpers: {
                substructureParent: {
                    get: jest.fn(() => ({ transform: { ref: 'root-a' } })),
                }
            },
            managers: {
                structure: {
                    hierarchy: {
                        current: { structures: [root] },
                        findStructure: jest.fn(() => undefined),
                    }
                }
            }
        };
        const manager = createManager(plugin);
        manager.setMode('transform');

        const selected = manager.selectRootStructureFromLoci(createTestLoci(structure, [1]));

        expect(selected).toBe('root:root-a');
        expect(manager.activeId).toBe('root:root-a');
    });

    it('previews root structure transforms on all root representations without committing the state tree', () => {
        const repr = { setState: jest.fn() };
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn() },
            state: { data: { build: jest.fn(), selectQ: jest.fn() } },
            runTask: jest.fn(),
        };
        const manager = createManager(plugin);
        manager.syncRootStructures([createRootStructureRef('root-a', 'Protein A', repr)]);
        const rootId = manager.listRootStructureStates()[0].id;

        manager.previewTransform(rootId, TransformState.fromPositionRotationScale(Vec3.create(7, 8, 9), Quat.identity(), Vec3.create(1, 1, 1)));

        expect(repr.setState).toHaveBeenCalledWith({ transform: expect.any(Array) });
        expect(plugin.canvas3d.update).toHaveBeenCalledWith(repr, false);
        expect(plugin.runTask).not.toHaveBeenCalled();
    });

    it('commits root transforms by inserting a TransformStructureConformation below the root ref', async () => {
        const inserted = { kind: 'inserted-builder' };
        const to = { insert: jest.fn(() => inserted), update: jest.fn() };
        const root = { to: jest.fn(() => to) };
        const state = {
            build: jest.fn(() => root),
            selectQ: jest.fn(() => []),
            updateTree: jest.fn(builder => ({ builder })),
        };
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn() },
            state: { data: state },
            managers: { structure: { focus: { refreshCurrent: jest.fn() } } },
            runTask: jest.fn(async () => undefined),
        };
        const manager = createManager(plugin);
        manager.syncRootStructures([createRootStructureRef('root-a')]);
        const rootId = manager.listRootStructureStates()[0].id;

        await manager.commitTransform(rootId, TransformState.fromPositionRotationScale(Vec3.create(7, 8, 9), Quat.identity(), Vec3.create(1, 1, 1)));

        expect(root.to).toHaveBeenCalledWith('root-a');
        expect(to.insert).toHaveBeenCalled();
        expect(state.updateTree).toHaveBeenCalledWith(inserted);
        expect(plugin.runTask).toHaveBeenCalledWith({ builder: inserted });
        expect(plugin.managers.structure.focus.refreshCurrent).toHaveBeenCalledTimes(1);
    });

    it('splits assembly roots into water polymer and ligand sibling structures and removes the source root', async () => {
        const root = createRootStructureRef('root-a', 'Assembly 1');
        (root as any).model = { cell: { transform: { ref: 'model-a' } } };
        (root as any).cell.transform.params = { type: { name: 'assembly', params: { id: '1' } } };
        const splitWater = { ref: 'split-water' };
        const splitPolymer = { ref: 'split-polymer' };
        const splitLigand = { ref: 'split-ligand' };
        const modelTo = {
            apply: jest.fn()
                .mockReturnValueOnce(splitWater)
                .mockReturnValueOnce(splitPolymer)
                .mockReturnValueOnce(splitLigand)
        };
        const builder = { to: jest.fn(() => modelTo) };
        const state = {
            build: jest.fn(() => builder),
            updateTree: jest.fn(next => ({ builder: next })),
        };
        const remove = jest.fn(async () => undefined);
        const applyPreset = jest.fn(async () => undefined);
        const manager = createManager({
            canvas3d: { requestDraw: jest.fn(), update: jest.fn(), add: jest.fn(), remove: jest.fn() },
            state: { data: state },
            builders: { structure: { representation: { applyPreset } } },
            managers: { structure: { hierarchy: { current: { structures: [root] }, selection: { structures: [root] }, remove } } },
            runTask: jest.fn(async () => undefined),
        });
        manager.syncRootStructures([root]);

        const ids = await manager.splitCurrentSelectionToRootObject();

        expect(ids).toEqual(['root:split-water', 'root:split-polymer', 'root:split-ligand']);
        expect(modelTo.apply).toHaveBeenCalledWith(SplitRootStructure, expect.objectContaining({ componentType: 'water', label: 'Water' }));
        expect(modelTo.apply).toHaveBeenCalledWith(SplitRootStructure, expect.objectContaining({ componentType: 'polymer', label: 'Polymer' }));
        expect(modelTo.apply).toHaveBeenCalledWith(SplitRootStructure, expect.objectContaining({ componentType: 'ligand', label: 'Ligand' }));
        expect(applyPreset).toHaveBeenCalledTimes(3);
        expect(remove).toHaveBeenCalledWith([root], true);
        expect(manager.getMode()).toBe('view');
        expect(manager.activeId).toBeUndefined();
    });

    it('does not split structures that were produced by a previous split', async () => {
        const root = createRootStructureRef('root-a', 'Assembly 1');
        (root as any).model = { cell: { transform: { ref: 'model-a' } } };
        (root as any).cell.transform.params = { type: { name: 'assembly', params: { id: '1' } } };
        const splitWater = { ref: 'split-water' };
        const splitPolymer = { ref: 'split-polymer' };
        const splitLigand = { ref: 'split-ligand' };
        const modelTo = {
            apply: jest.fn()
                .mockReturnValueOnce(splitWater)
                .mockReturnValueOnce(splitPolymer)
                .mockReturnValueOnce(splitLigand)
        };
        const builder = { to: jest.fn(() => modelTo) };
        const state = {
            build: jest.fn(() => builder),
            updateTree: jest.fn(next => ({ builder: next })),
            cells: { get: jest.fn(() => ({ obj: { data: {} } })) },
        };
        const remove = jest.fn(async () => undefined);
        const applyPreset = jest.fn(async () => undefined);
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn(), add: jest.fn(), remove: jest.fn() },
            state: { data: state },
            builders: { structure: { representation: { applyPreset } } },
            managers: { structure: { hierarchy: { current: { structures: [root] }, selection: { structures: [root] }, remove } } },
            runTask: jest.fn(async () => undefined),
            log: { warn: jest.fn() },
        };
        const manager = createManager(plugin);
        manager.syncRootStructures([root]);

        // First split succeeds
        const firstIds = await manager.splitCurrentSelectionToRootObject();
        expect(firstIds).toEqual(['root:split-water', 'root:split-polymer', 'root:split-ligand']);

        // Now hierarchy contains only split-produced structures
        const splitStructure = {
            cell: {
                transform: { ref: 'split-water', version: '0' },
                obj: { label: 'Water', data: { boundary: { sphere: { center: Vec3.create(0, 0, 0), radius: 1 } } } }
            },
            components: [],
            genericRepresentations: [],
        };
        (plugin.managers.structure.hierarchy.current as any).structures = [splitStructure];
        (plugin.managers.structure.hierarchy.selection as any).structures = [splitStructure];

        // Second split should be a no-op because the structure was produced by split
        const secondIds = await manager.splitCurrentSelectionToRootObject();
        expect(secondIds).toBeUndefined();
        expect(plugin.log.warn).toHaveBeenCalledWith(expect.stringContaining('No splittable root structures found in selection.'));
    });

    it('selects split-produced structures by loci fallback', () => {
        const splitRoot = createRootStructureRef('split-water', 'Water');
        const structure = createTestStructure('picked', [1]);
        const plugin = {
            canvas3d: undefined,
            helpers: {
                substructureParent: {
                    get: jest.fn(() => ({ transform: { ref: 'split-water' } })),
                }
            },
            managers: {
                structure: {
                    hierarchy: {
                        current: { structures: [splitRoot] },
                        findStructure: jest.fn(() => undefined),
                    }
                }
            }
        };
        const manager = createManager(plugin);
        manager.syncRootStructures([splitRoot]);
        manager.setMode('transform');

        const selected = manager.selectRootStructureFromLoci(createTestLoci(structure, [1]));

        expect(selected).toBe('root:split-water');
        expect(manager.activeId).toBe('root:split-water');
    });

    it('creates a pose object from an existing component ref', () => {
        const repr = { setState: jest.fn() };
        const manager = createManager();
        const id = manager.createPoseObjectFromComponent({
            cell: {
                transform: { ref: 'component-ligand' },
                obj: {
                    label: 'Ligand Component',
                    data: { boundary: { sphere: { center: Vec3.create(1, 2, 3), radius: 4 } } }
                }
            },
            representations: [
                { cell: { obj: { data: { repr } } } }
            ],
        } as any);

        expect(id).toBe('pose:component:component-ligand');
        expect(manager.listPoseObjectStates().map(o => [o.id, o.label, o.sourceKind, Array.from(o.position)]))
            .toEqual([['pose:component:component-ligand', 'Ligand Component', 'component', [1, 2, 3]]]);
    });

    it('reuses an existing pose object for the same source ref instead of duplicating transform targets', () => {
        const manager = createManager();

        const first = manager.createPoseObject(createPoseTarget('component-ligand'));
        const second = manager.createPoseObject({ ...createPoseTarget('component-ligand'), label: 'Ligand renamed' });

        expect(second).toBe(first);
        expect(manager.listPoseObjectStates()).toHaveLength(1);
        expect(manager.listPoseObjectStates()[0].label).toBe('Ligand renamed');
    });

    it('does not expose pose gizmo handles in view mode and only allows translate/rotate handles in edit mode', () => {
        const manager = createManager();
        const id = manager.createPoseObject(createPoseTarget());

        expect(manager.getMode()).toBe('view');
        expect(manager.canUsePickTarget({ kind: 'center', objectId: id })).toBe(false);

        manager.enterPoseEditMode(id);

        expect(manager.activeId).toBe(id);
        expect(manager.getMode()).toBe('transform');
        expect(manager.canUsePickTarget({ kind: 'center', objectId: id })).toBe(true);
        expect(manager.canUsePickTarget({ kind: 'axis', objectId: id })).toBe(true);
        expect(manager.canUsePickTarget({ kind: 'ring', objectId: id })).toBe(true);
        expect(manager.canUsePickTarget({ kind: 'face', objectId: id })).toBe(false);

        manager.exitPoseEditMode();

        expect(manager.getMode()).toBe('view');
        expect(manager.canUsePickTarget({ kind: 'center', objectId: id })).toBe(false);
    });

    it('returns undefined when creating from selection cannot resolve exactly one existing component', () => {
        const manager = createManager({
            canvas3d: undefined,
            managers: {
                structure: {
                    selection: { entries: new Map() },
                    hierarchy: { currentComponentGroups: [] },
                },
            },
        });

        expect(manager.createPoseObjectFromSelection()).toBeUndefined();
        expect(manager.listPoseObjectStates()).toEqual([]);
    });

    it('previews pose object transforms on representations without committing the state tree', () => {
        const repr = { setState: jest.fn() };
        const plugin = {
            canvas3d: { requestDraw: jest.fn() },
            state: { data: { build: jest.fn(), selectQ: jest.fn() } },
            runTask: jest.fn(),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject({ ...createPoseTarget(), representations: [repr as any] });

        const transform = TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1));
        manager.previewTransform(id, transform);

        expect(repr.setState).toHaveBeenCalledWith({ transform: expect.any(Array) });
        expect(plugin.canvas3d.requestDraw).toHaveBeenCalled();
        expect(plugin.runTask).not.toHaveBeenCalled();
    });

    it('resolves current state tree representations for pose preview when the record has no cached reprs', () => {
        const repr = { setState: jest.fn() };
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn() },
            state: {
                data: {
                    selectQ: jest.fn(() => [
                        { obj: { data: { repr } } }
                    ]),
                    build: jest.fn(),
                }
            },
            runTask: jest.fn(),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject(createPoseTarget());

        const transform = TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1));
        manager.previewTransform(id, transform);

        expect(plugin.state.data.selectQ).toHaveBeenCalled();
        expect(repr.setState).toHaveBeenCalledWith({ transform: expect.any(Array) });
        expect(plugin.canvas3d.update).toHaveBeenCalledWith(repr, false);
        expect(plugin.runTask).not.toHaveBeenCalled();
    });

    it('previews pose object transforms incrementally from the current displayed coordinates', () => {
        const repr = { setState: jest.fn() };
        const plugin = {
            canvas3d: { requestDraw: jest.fn() },
            state: { data: { build: jest.fn(), selectQ: jest.fn() } },
            runTask: jest.fn(),
        };
        const manager = createManager(plugin);
        const committedTransform = Mat4.identity();
        Mat4.setTranslation(committedTransform, Vec3.create(10, 0, 0));
        const id = manager.createPoseObject({
            ...createPoseTarget(),
            center: Vec3.create(10, 0, 0),
            baseCenter: Vec3.create(0, 0, 0),
            transformRef: 'existing-transform',
            committedTransform,
            representations: [repr as any],
        });

        const transform = TransformState.fromPositionRotationScale(Vec3.create(12, 0, 0), Quat.identity(), Vec3.create(1, 1, 1));
        manager.previewTransform(id, transform);

        expect(Array.from(getLastTransform(repr).slice(12, 15))).toEqual([2, 0, 0]);
    });

    it('previews current focus target and hides stale focus surroundings/interactions during pose preview', () => {
        const bodyRepr = createStatefulRepr();
        const focusTargetRepr = createStatefulRepr();
        const focusSurrRepr = createStatefulRepr();
        const focusNciRepr = createStatefulRepr();
        const focusStructure = {};
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn() },
            helpers: {
                substructureParent: {
                    get: jest.fn(() => ({ transform: { ref: 'component-ligand' } })),
                }
            },
            managers: {
                structure: {
                    focus: {
                        current: { label: 'Ligand focus', loci: { structure: focusStructure } },
                        refreshCurrent: jest.fn(),
                    }
                }
            },
            state: {
                data: {
                    build: jest.fn(),
                    selectQ: createFocusSelectQ({
                        [StructureFocusRepresentationTags.TargetRepr]: [{ obj: { data: { repr: focusTargetRepr } } }],
                        [StructureFocusRepresentationTags.SurrRepr]: [{ obj: { data: { repr: focusSurrRepr } } }],
                        [StructureFocusRepresentationTags.SurrNciRepr]: [{ obj: { data: { repr: focusNciRepr } } }],
                    }),
                }
            },
            runTask: jest.fn(),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject({ ...createPoseTarget(), representations: [bodyRepr as any] });

        const transform = TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1));
        manager.previewTransform(id, transform);

        expect(bodyRepr.setState).toHaveBeenCalledWith({ transform: expect.any(Array) });
        expect(focusTargetRepr.setState).toHaveBeenCalledWith({ transform: expect.any(Array) });
        expect(focusSurrRepr.setState).toHaveBeenCalledWith({ visible: false });
        expect(focusNciRepr.setState).toHaveBeenCalledWith({ visible: false });
        expect(plugin.managers.structure.focus.refreshCurrent).not.toHaveBeenCalled();
        expect(plugin.runTask).not.toHaveBeenCalled();
    });

    it('matches focus from a parent structure to the pose source structure for lightweight preview', () => {
        const bodyRepr = createStatefulRepr();
        const focusTargetRepr = createStatefulRepr();
        const focusSurrRepr = createStatefulRepr();
        const fullStructure = createTestStructure('full', [1, 2]);
        const sourceStructure = createTestStructure('source', [1]);
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn() },
            helpers: {
                substructureParent: {
                    get: jest.fn(() => ({ transform: { ref: 'full-root' } })),
                }
            },
            managers: {
                structure: {
                    focus: {
                        current: { label: 'Ligand focus', loci: createTestLoci(fullStructure, [1, 2]) },
                        refreshCurrent: jest.fn(),
                    }
                }
            },
            state: {
                data: {
                    build: jest.fn(),
                    selectQ: createFocusSelectQ({
                        [StructureFocusRepresentationTags.TargetRepr]: [{ obj: { data: { repr: focusTargetRepr } } }],
                        [StructureFocusRepresentationTags.SurrRepr]: [{ obj: { data: { repr: focusSurrRepr } } }],
                    }),
                }
            },
            runTask: jest.fn(),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject({ ...createPoseTarget(), sourceStructure, representations: [bodyRepr as any] } as any);

        manager.previewTransform(id, TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1)));

        expect(focusTargetRepr.setState).toHaveBeenCalledWith({ transform: expect.any(Array) });
        expect(focusSurrRepr.setState).toHaveBeenCalledWith({ visible: false });
    });

    it('does not preview focus target when current focus belongs to another source', () => {
        const bodyRepr = createStatefulRepr();
        const focusTargetRepr = createStatefulRepr();
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn() },
            helpers: {
                substructureParent: {
                    get: jest.fn(() => ({ transform: { ref: 'component-other' } })),
                }
            },
            managers: {
                structure: {
                    focus: {
                        current: { label: 'Other focus', loci: { structure: {} } },
                        refreshCurrent: jest.fn(),
                    }
                }
            },
            state: {
                data: {
                    build: jest.fn(),
                    selectQ: createFocusSelectQ({
                        [StructureFocusRepresentationTags.TargetRepr]: [{ obj: { data: { repr: focusTargetRepr } } }],
                    }),
                }
            },
            runTask: jest.fn(),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject({ ...createPoseTarget(), representations: [bodyRepr as any] });

        manager.previewTransform(id, TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1)));

        expect(bodyRepr.setState).toHaveBeenCalledWith({ transform: expect.any(Array) });
        expect(focusTargetRepr.setState).not.toHaveBeenCalled();
    });

    it('commits pose object transforms via TransformStructureConformation and clears preview transforms', async () => {
        const repr = { setState: jest.fn() };
        const inserted = { kind: 'inserted-builder' };
        const to = { insert: jest.fn(() => inserted), update: jest.fn() };
        const root = { to: jest.fn(() => to) };
        const state = {
            build: jest.fn(() => root),
            selectQ: jest.fn(() => []),
            updateTree: jest.fn(builder => ({ builder })),
        };
        const plugin = {
            canvas3d: { requestDraw: jest.fn() },
            state: { data: state },
            runTask: jest.fn(async () => undefined),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject({ ...createPoseTarget(), representations: [repr as any] });

        const transform = TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1));
        await manager.commitTransform(id, transform);

        expect(root.to).toHaveBeenCalledWith('component-ligand');
        expect(to.insert).toHaveBeenCalled();
        expect(state.updateTree).toHaveBeenCalledWith(inserted);
        expect(plugin.runTask).toHaveBeenCalledWith({ builder: inserted });
        const lastPreview = repr.setState.mock.calls[repr.setState.mock.calls.length - 1]?.[0]?.transform;
        expect(Array.from(lastPreview)).toEqual(Array.from(Mat4.identity()));
    });

    it('restores focus preview state and refreshes current focus after pose commit', async () => {
        const bodyRepr = createStatefulRepr();
        const focusTargetRepr = createStatefulRepr();
        const focusSurrRepr = createStatefulRepr();
        const focusNciRepr = createStatefulRepr();
        const inserted = { kind: 'inserted-builder' };
        const to = { insert: jest.fn(() => inserted), update: jest.fn() };
        const root = { to: jest.fn(() => to) };
        const state = {
            build: jest.fn(() => root),
            selectQ: createFocusSelectQ({
                [StructureFocusRepresentationTags.TargetRepr]: [{ obj: { data: { repr: focusTargetRepr } } }],
                [StructureFocusRepresentationTags.SurrRepr]: [{ obj: { data: { repr: focusSurrRepr } } }],
                [StructureFocusRepresentationTags.SurrNciRepr]: [{ obj: { data: { repr: focusNciRepr } } }],
            }),
            updateTree: jest.fn(builder => ({ builder })),
        };
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn() },
            helpers: {
                substructureParent: {
                    get: jest.fn(() => ({ transform: { ref: 'component-ligand' } })),
                }
            },
            managers: {
                structure: {
                    focus: {
                        current: { label: 'Ligand focus', loci: { structure: {} } },
                        refreshCurrent: jest.fn(),
                    }
                }
            },
            state: { data: state },
            runTask: jest.fn(async () => undefined),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject({ ...createPoseTarget(), representations: [bodyRepr as any] });
        const transform = TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1));

        manager.previewTransform(id, transform);
        await manager.commitTransform(id, transform);

        expect(focusTargetRepr.setState).toHaveBeenLastCalledWith({ transform: Mat4.identity() });
        expect(focusSurrRepr.setState).toHaveBeenLastCalledWith({ visible: true });
        expect(focusNciRepr.setState).toHaveBeenLastCalledWith({ visible: true });
        expect(plugin.managers.structure.focus.refreshCurrent).toHaveBeenCalledTimes(1);
    });

    it('remaps a parent-structure focus to the transformed pose structure before refreshing', async () => {
        const sourceStructure = createTestStructure('source', [1]);
        const transformedStructure = createTestStructure('transformed', [1]);
        const fullStructure = createTestStructure('full', [1, 2]);
        const focusLoci = createTestLoci(fullStructure, [1, 2]);
        const updated = { kind: 'updated-builder' };
        const to = { insert: jest.fn(), update: jest.fn(() => updated) };
        const root = { to: jest.fn(() => to) };
        const state = {
            build: jest.fn(() => root),
            selectQ: jest.fn(() => []),
            updateTree: jest.fn(builder => ({ builder })),
            cells: {
                get: jest.fn((ref: string) => ref === 'existing-transform' ? { obj: { data: transformedStructure } } : undefined),
            },
        };
        const refreshCurrent = jest.fn();
        const plugin = {
            canvas3d: { requestDraw: jest.fn(), update: jest.fn() },
            helpers: {
                substructureParent: {
                    get: jest.fn(() => ({ transform: { ref: 'full-root' } })),
                }
            },
            managers: {
                structure: {
                    focus: {
                        current: { label: 'Ligand focus', loci: focusLoci },
                        refreshCurrent,
                    }
                }
            },
            state: { data: state },
            runTask: jest.fn(async () => undefined),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject({
            ...createPoseTarget(),
            sourceStructure,
            transformRef: 'existing-transform',
        } as any);

        await manager.commitTransform(id, TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1)));

        expect(refreshCurrent).toHaveBeenCalledTimes(1);
        const remapped = refreshCurrent.mock.calls[0][0] as StructureElement.Loci;
        expect(remapped.structure).toBe(transformedStructure);
        expect(StructureElement.Loci.isEmpty(remapped)).toBe(false);
    });

    it('does not refresh focus for box commits', async () => {
        const refreshCurrent = jest.fn();
        const manager = createManager({
            canvas3d: undefined,
            managers: { structure: { focus: { current: { label: 'Focus', loci: { structure: {} } }, refreshCurrent } } },
        });
        const box = manager.addBox(Vec3.create(1, 2, 3), Vec3.create(4, 5, 6), Quat.identity());

        await manager.commitTransform(box.id, TransformState.fromPositionRotationScale(Vec3.create(3, 3, 3), Quat.identity(), Vec3.create(5, 5, 5)));

        expect(refreshCurrent).not.toHaveBeenCalled();
    });

    it('updates an existing pose transform decorator when a transform ref is known', async () => {
        const updated = { kind: 'updated-builder' };
        const to = { insert: jest.fn(), update: jest.fn(() => updated) };
        const root = { to: jest.fn(() => to) };
        const state = {
            build: jest.fn(() => root),
            selectQ: jest.fn(() => []),
            updateTree: jest.fn(builder => ({ builder })),
        };
        const plugin = {
            canvas3d: { requestDraw: jest.fn() },
            state: { data: state },
            runTask: jest.fn(async () => undefined),
        };
        const manager = createManager(plugin);
        const id = manager.createPoseObject({ ...createPoseTarget(), transformRef: 'existing-transform' });

        const transform = TransformState.fromPositionRotationScale(Vec3.create(11, 22, 33), Quat.identity(), Vec3.create(1, 1, 1));
        await manager.commitTransform(id, transform);

        expect(root.to).toHaveBeenCalledWith('existing-transform');
        expect(to.update).toHaveBeenCalled();
        expect(to.insert).not.toHaveBeenCalled();
    });

    it('commits pose transforms by composing preview delta with the existing decorator matrix', async () => {
        const updated = { kind: 'updated-builder' };
        const to = { insert: jest.fn(), update: jest.fn(() => updated) };
        const root = { to: jest.fn(() => to) };
        const state = {
            build: jest.fn(() => root),
            selectQ: jest.fn(() => []),
            updateTree: jest.fn(builder => ({ builder })),
        };
        const plugin = {
            canvas3d: { requestDraw: jest.fn() },
            state: { data: state },
            runTask: jest.fn(async () => undefined),
        };
        const manager = createManager(plugin);
        const committedTransform = Mat4.identity();
        Mat4.setTranslation(committedTransform, Vec3.create(10, 0, 0));
        const id = manager.createPoseObject({
            ...createPoseTarget(),
            center: Vec3.create(10, 0, 0),
            baseCenter: Vec3.create(0, 0, 0),
            transformRef: 'existing-transform',
            committedTransform,
        });

        const transform = TransformState.fromPositionRotationScale(Vec3.create(12, 0, 0), Quat.identity(), Vec3.create(1, 1, 1));
        await manager.commitTransform(id, transform);

        const params = to.update.mock.calls[0][0];
        expect(Array.from(params.transform.params.data.slice(12, 15))).toEqual([12, 0, 0]);
    });
});
