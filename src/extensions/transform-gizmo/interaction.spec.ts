import { Subject } from 'rxjs';
import { TransformInteractionHandler } from './interaction';
import { GizmoGroup } from './geometry';
import { OrientedBoxState, TransformState } from './math';
import { TransformGizmoLoci } from './representation';

describe('TransformInteractionHandler', () => {
    it('captures mouse down on gizmo handles before trackball drag starts', () => {
        const addedCanvasListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];
        const addedWindowListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];

        const previousWindow = (globalThis as any).window;
        (globalThis as any).window = {
            addEventListener: jest.fn((type, listener, options) => addedWindowListeners.push({ type, listener, options })),
            removeEventListener: jest.fn(),
        };

        try {
            const canvas = {
                getBoundingClientRect: () => ({ left: 10, top: 20 }),
                addEventListener: jest.fn((type, listener, options) => addedCanvasListeners.push({ type, listener, options })),
                removeEventListener: jest.fn(),
            };

            const c3d = {
                interaction: {
                    hover: new Subject<any>(),
                    click: new Subject<any>(),
                    drag: new Subject<any>(),
                },
                input: {
                    interactionEnd: new Subject<void>(),
                },
                props: {
                    trackball: { rotateSpeed: 5, panSpeed: 1, zoomSpeed: 7 },
                },
                setProps: jest.fn(),
                identify: jest.fn(() => ({ id: { objectId: 101, groupId: GizmoGroup.Center, instanceId: 0 } })),
                getLoci: jest.fn(() => ({
                    loci: TransformGizmoLoci({ objectId: 101, groupId: GizmoGroup.Center, instanceId: 0 }),
                    repr: undefined,
                })),
            };

            const manager = {
                isEnabled: true,
                objects: new Map([
                    ['box-1', {
                        faceRenderObject: { id: 201 },
                        edgeRenderObject: { id: 202 },
                        gizmoRenderObject: { id: 101 },
                        state: OrientedBoxState.create(),
                    }]
                ]),
                getObject: jest.fn(() => ({ state: OrientedBoxState.create() })),
            };

            const handler = new TransformInteractionHandler({
                canvas3d: c3d,
                canvas3dContext: { canvas },
            } as any, manager as any);

            handler.start();
            const mouseDown = addedCanvasListeners.find(e => e.type === 'mousedown');
            expect(mouseDown?.options).toBe(true);

            const event = {
                button: 0,
                clientX: 410,
                clientY: 320,
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            };
            (mouseDown!.listener as EventListener)(event as any);

            expect(event.preventDefault).toHaveBeenCalled();
            expect(event.stopPropagation).toHaveBeenCalled();
            expect(c3d.setProps).toHaveBeenCalledWith({ trackball: { rotateSpeed: 0, panSpeed: 0, zoomSpeed: 0 } }, true);
            expect(addedWindowListeners.map(e => e.type)).toEqual(expect.arrayContaining(['mousemove', 'mouseup']));
        } finally {
            (globalThis as any).window = previousWindow;
        }
    });

    it('normalizes native mouse coordinates for transformed canvases', () => {
        const addedCanvasListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];
        const canvas = {
            clientWidth: 474,
            clientHeight: 598,
            getBoundingClientRect: () => ({ left: 10, top: 20, width: 397.4588, height: 501.4353 }),
            addEventListener: jest.fn((type, listener, options) => addedCanvasListeners.push({ type, listener, options })),
            removeEventListener: jest.fn(),
        };

        const c3d = {
            interaction: {
                hover: new Subject<any>(),
                click: new Subject<any>(),
                drag: new Subject<any>(),
            },
            input: {
                interactionEnd: new Subject<void>(),
            },
            props: {
                trackball: { rotateSpeed: 5, panSpeed: 1, zoomSpeed: 7 },
            },
            setProps: jest.fn(),
            identify: jest.fn(() => ({ id: { objectId: 101, groupId: GizmoGroup.Center, instanceId: 0 } })),
            getLoci: jest.fn(() => ({
                loci: TransformGizmoLoci({ objectId: 101, groupId: GizmoGroup.Center, instanceId: 0 }),
                repr: undefined,
            })),
        };

        const manager = {
            isEnabled: true,
            objects: new Map([
                ['box-1', {
                    faceRenderObject: { id: 201 },
                    edgeRenderObject: { id: 202 },
                    gizmoRenderObject: { id: 101 },
                    state: OrientedBoxState.create(),
                }]
            ]),
            getObject: jest.fn(() => ({ state: OrientedBoxState.create() })),
        };

        const handler = new TransformInteractionHandler({
            canvas3d: c3d,
            canvas3dContext: { canvas },
        } as any, manager as any);

        handler.start();
        const mouseDown = addedCanvasListeners.find(e => e.type === 'mousedown');
        expect(mouseDown).toBeDefined();

        const event = {
            button: 0,
            clientX: 10 + 397.4588 / 2,
            clientY: 20 + 501.4353 / 2,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        };
        (mouseDown!.listener as EventListener)(event as any);

        const point = c3d.identify.mock.calls[0][0];
        expect(point[0]).toBeCloseTo(474 / 2, 4);
        expect(point[1]).toBeCloseTo(598 / 2, 4);
    });

    it('starts after the Mol* canvas is initialized', async () => {
        const addedCanvasListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];
        let resolveInitialized!: () => void;
        const initialized = new Promise<void>(resolve => {
            resolveInitialized = resolve;
        });

        const canvas = {
            addEventListener: jest.fn((type, listener, options) => addedCanvasListeners.push({ type, listener, options })),
            removeEventListener: jest.fn(),
        };

        const c3d = {
            interaction: {
                hover: new Subject<any>(),
                click: new Subject<any>(),
                drag: new Subject<any>(),
            },
            input: {
                interactionEnd: new Subject<void>(),
            },
        };

        const plugin = {
            canvas3d: undefined,
            canvas3dContext: undefined,
            canvas3dInitialized: initialized,
        } as any;
        const manager = { isEnabled: true } as any;
        const handler = new TransformInteractionHandler(plugin, manager);

        handler.start();
        expect(addedCanvasListeners).toEqual([]);

        plugin.canvas3d = c3d;
        plugin.canvas3dContext = { canvas };
        resolveInitialized();
        await initialized;
        await Promise.resolve();

        expect(addedCanvasListeners.some(e => e.type === 'mousedown' && e.options === true)).toBe(true);
    });

    it('does not start editing when a camera drag passes over a gizmo', () => {
        const c3d = {
            interaction: {
                hover: new Subject<any>(),
                click: new Subject<any>(),
                drag: new Subject<any>(),
            },
            input: {
                interactionEnd: new Subject<void>(),
            },
            props: {
                trackball: { rotateSpeed: 5, panSpeed: 1, zoomSpeed: 7 },
            },
            setProps: jest.fn(),
            identify: jest.fn(() => ({ id: { objectId: 101, groupId: GizmoGroup.Center, instanceId: 0 } })),
            getLoci: jest.fn(() => ({
                loci: TransformGizmoLoci({ objectId: 101, groupId: GizmoGroup.Center, instanceId: 0 }),
                repr: undefined,
            })),
        };

        const manager = {
            isEnabled: true,
            objects: new Map([
                ['box-1', {
                    faceRenderObject: { id: 201 },
                    edgeRenderObject: { id: 202 },
                    gizmoRenderObject: { id: 101 },
                    state: OrientedBoxState.create(),
                }]
            ]),
            getObject: jest.fn(() => ({ state: OrientedBoxState.create() })),
        };

        const handler = new TransformInteractionHandler({ canvas3d: c3d } as any, manager as any);

        handler.start();
        c3d.interaction.drag.next({
            current: {
                loci: TransformGizmoLoci({ objectId: 101, groupId: GizmoGroup.Center, instanceId: 0 }),
                repr: undefined,
            },
            pageStart: [20, 20],
            pageEnd: [60, 60],
        });

        expect(handler.currentState.mode).toBe('idle');
        expect(c3d.setProps).not.toHaveBeenCalled();
        expect(manager.getObject).not.toHaveBeenCalled();
    });

    it('captures transform-mode clicks on molecule loci to activate a root target without starting camera drag', () => {
        const addedCanvasListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];
        const canvas = {
            getBoundingClientRect: () => ({ left: 10, top: 20 }),
            addEventListener: jest.fn((type, listener, options) => addedCanvasListeners.push({ type, listener, options })),
            removeEventListener: jest.fn(),
        };
        const moleculeLoci = { kind: 'element-loci' };
        const c3d = {
            interaction: {
                hover: new Subject<any>(),
                click: new Subject<any>(),
                drag: new Subject<any>(),
            },
            input: {
                interactionEnd: new Subject<void>(),
            },
            props: {
                trackball: { rotateSpeed: 5, panSpeed: 1, zoomSpeed: 7 },
            },
            setProps: jest.fn(),
            identify: jest.fn(() => ({ id: { objectId: 301, groupId: 0, instanceId: 0 } })),
            getLoci: jest.fn(() => ({
                loci: moleculeLoci,
                repr: undefined,
            })),
        };
        const manager = {
            isEnabled: true,
            objects: new Map(),
            getMode: jest.fn(() => 'transform'),
            selectRootStructureFromLoci: jest.fn(() => 'root:input'),
        };
        const handler = new TransformInteractionHandler({
            canvas3d: c3d,
            canvas3dContext: { canvas },
        } as any, manager as any);

        handler.start();
        const mouseDown = addedCanvasListeners.find(e => e.type === 'mousedown');
        const event = {
            button: 0,
            clientX: 410,
            clientY: 320,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
            stopImmediatePropagation: jest.fn(),
        };
        (mouseDown!.listener as EventListener)(event as any);

        expect(manager.selectRootStructureFromLoci).toHaveBeenCalledWith(moleculeLoci);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
        expect(event.stopImmediatePropagation).toHaveBeenCalled();
        expect(c3d.setProps).not.toHaveBeenCalled();
    });

    it('does not capture mouse down on broad box faces', () => {
        const addedCanvasListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];
        const addedWindowListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];

        const previousWindow = (globalThis as any).window;
        (globalThis as any).window = {
            addEventListener: jest.fn((type, listener, options) => addedWindowListeners.push({ type, listener, options })),
            removeEventListener: jest.fn(),
        };

        try {
            const canvas = {
                getBoundingClientRect: () => ({ left: 10, top: 20 }),
                addEventListener: jest.fn((type, listener, options) => addedCanvasListeners.push({ type, listener, options })),
                removeEventListener: jest.fn(),
            };

            const c3d = {
                interaction: {
                    hover: new Subject<any>(),
                    click: new Subject<any>(),
                    drag: new Subject<any>(),
                },
                input: {
                    interactionEnd: new Subject<void>(),
                },
                props: {
                    trackball: { rotateSpeed: 5, panSpeed: 1, zoomSpeed: 7 },
                },
                setProps: jest.fn(),
                identify: jest.fn(() => ({ id: { objectId: 201, groupId: GizmoGroup.FacePosX, instanceId: 0 } })),
                getLoci: jest.fn(() => ({
                    loci: TransformGizmoLoci({ objectId: 201, groupId: GizmoGroup.FacePosX, instanceId: 0 }),
                    repr: undefined,
                })),
            };

            const manager = {
                isEnabled: true,
                objects: new Map([
                    ['box-1', {
                        faceRenderObject: { id: 201 },
                        edgeRenderObject: { id: 202 },
                        gizmoRenderObject: { id: 101 },
                        state: OrientedBoxState.create(),
                    }]
                ]),
                getObject: jest.fn(() => ({ state: OrientedBoxState.create() })),
            };

            const handler = new TransformInteractionHandler({
                canvas3d: c3d,
                canvas3dContext: { canvas },
            } as any, manager as any);

            handler.start();
            const mouseDown = addedCanvasListeners.find(e => e.type === 'mousedown');
            const event = {
                button: 0,
                clientX: 410,
                clientY: 320,
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
                stopImmediatePropagation: jest.fn(),
            };
            (mouseDown!.listener as EventListener)(event as any);

            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(event.stopPropagation).not.toHaveBeenCalled();
            expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
            expect(c3d.setProps).not.toHaveBeenCalled();
            expect(addedWindowListeners).toEqual([]);
        } finally {
            (globalThis as any).window = previousWindow;
        }
    });

    it('clears the active gizmo when clicking empty canvas space in transform mode', () => {
        const c3d = {
            interaction: {
                hover: new Subject<any>(),
                click: new Subject<any>(),
                drag: new Subject<any>(),
            },
            input: {
                interactionEnd: new Subject<void>(),
            },
        };

        const manager = {
            isEnabled: true,
            activeId: 'box-1',
            setActiveObject: jest.fn(),
            getMode: jest.fn(() => 'transform'),
            selectRootStructureFromLoci: jest.fn(() => undefined),
        };

        const handler = new TransformInteractionHandler({ canvas3d: c3d } as any, manager as any);

        handler.start();
        c3d.interaction.click.next({ current: { loci: undefined, repr: undefined } });

        expect(manager.setActiveObject).toHaveBeenCalledWith(undefined);
    });

    it('treats axis and ring arrowheads as editable gizmo handles', () => {
        for (const groupId of [GizmoGroup.AxisArrowX, GizmoGroup.RingArrowZ]) {
            const addedCanvasListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];
            const addedWindowListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];

            const previousWindow = (globalThis as any).window;
            (globalThis as any).window = {
                addEventListener: jest.fn((type, listener, options) => addedWindowListeners.push({ type, listener, options })),
                removeEventListener: jest.fn(),
            };

            try {
                const canvas = {
                    getBoundingClientRect: () => ({ left: 10, top: 20 }),
                    addEventListener: jest.fn((type, listener, options) => addedCanvasListeners.push({ type, listener, options })),
                    removeEventListener: jest.fn(),
                };

                const c3d = {
                    interaction: {
                        hover: new Subject<any>(),
                        click: new Subject<any>(),
                        drag: new Subject<any>(),
                    },
                    input: {
                        interactionEnd: new Subject<void>(),
                    },
                    props: {
                        trackball: { rotateSpeed: 5, panSpeed: 1, zoomSpeed: 7 },
                    },
                    setProps: jest.fn(),
                    identify: jest.fn(() => ({ id: { objectId: 101, groupId, instanceId: 0 } })),
                    getLoci: jest.fn(() => ({
                        loci: TransformGizmoLoci({ objectId: 101, groupId, instanceId: 0 }),
                        repr: undefined,
                    })),
                };

                const manager = {
                    isEnabled: true,
                    objects: new Map([
                        ['box-1', {
                            faceRenderObject: { id: 201 },
                            edgeRenderObject: { id: 202 },
                            gizmoRenderObject: { id: 101 },
                            state: OrientedBoxState.create(),
                        }]
                    ]),
                    getObject: jest.fn(() => ({ state: OrientedBoxState.create() })),
                };

                const handler = new TransformInteractionHandler({
                    canvas3d: c3d,
                    canvas3dContext: { canvas },
                } as any, manager as any);

                handler.start();
                const mouseDown = addedCanvasListeners.find(e => e.type === 'mousedown');
                const event = {
                    button: 0,
                    clientX: 410,
                    clientY: 320,
                    preventDefault: jest.fn(),
                    stopPropagation: jest.fn(),
                    stopImmediatePropagation: jest.fn(),
                };
                (mouseDown!.listener as EventListener)(event as any);

                expect(event.preventDefault).toHaveBeenCalled();
                expect(c3d.setProps).toHaveBeenCalledWith({ trackball: { rotateSpeed: 0, panSpeed: 0, zoomSpeed: 0 } }, true);
                expect(addedWindowListeners.map(e => e.type)).toEqual(expect.arrayContaining(['mousemove', 'mouseup']));
            } finally {
                (globalThis as any).window = previousWindow;
            }
        }
    });

    it('does not capture pose object face handles because molecules do not support scaling', () => {
        const addedCanvasListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];
        const addedWindowListeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];

        const previousWindow = (globalThis as any).window;
        (globalThis as any).window = {
            addEventListener: jest.fn((type, listener, options) => addedWindowListeners.push({ type, listener, options })),
            removeEventListener: jest.fn(),
        };

        try {
            const canvas = {
                getBoundingClientRect: () => ({ left: 10, top: 20 }),
                addEventListener: jest.fn((type, listener, options) => addedCanvasListeners.push({ type, listener, options })),
                removeEventListener: jest.fn(),
            };

            const c3d = {
                interaction: {
                    hover: new Subject<any>(),
                    click: new Subject<any>(),
                    drag: new Subject<any>(),
                },
                input: {
                    interactionEnd: new Subject<void>(),
                },
                props: {
                    trackball: { rotateSpeed: 5, panSpeed: 1, zoomSpeed: 7 },
                },
                setProps: jest.fn(),
                identify: jest.fn(() => ({ id: { objectId: 101, groupId: GizmoGroup.FacePosX, instanceId: 0 } })),
                getLoci: jest.fn(() => ({
                    loci: TransformGizmoLoci({ objectId: 101, groupId: GizmoGroup.FacePosX, instanceId: 0 }),
                    repr: undefined,
                })),
            };

            const manager = {
                isEnabled: true,
                objects: new Map([
                    ['structure:root', {
                        kind: 'pose-object',
                        gizmoRenderObject: { id: 101 },
                        state: TransformState.fromPositionRotationScale([0, 0, 0] as any, [0, 0, 0, 1] as any, [1, 1, 1] as any),
                    }]
                ]),
                getObject: jest.fn(() => ({
                    kind: 'pose-object',
                    state: TransformState.fromPositionRotationScale([0, 0, 0] as any, [0, 0, 0, 1] as any, [1, 1, 1] as any),
                })),
                canUsePickTarget: jest.fn(() => false),
            };

            const handler = new TransformInteractionHandler({
                canvas3d: c3d,
                canvas3dContext: { canvas },
            } as any, manager as any);

            handler.start();
            const mouseDown = addedCanvasListeners.find(e => e.type === 'mousedown');
            const event = {
                button: 0,
                clientX: 410,
                clientY: 320,
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
                stopImmediatePropagation: jest.fn(),
            };
            (mouseDown!.listener as EventListener)(event as any);

            expect(manager.canUsePickTarget).toHaveBeenCalledWith(expect.objectContaining({ kind: 'face', objectId: 'structure:root' }));
            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(c3d.setProps).not.toHaveBeenCalled();
            expect(addedWindowListeners).toEqual([]);
        } finally {
            (globalThis as any).window = previousWindow;
        }
    });
});
