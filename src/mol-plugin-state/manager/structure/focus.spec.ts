import { Subject } from 'rxjs';
import { StructureFocusManager, FocusEntry } from './focus';
import { StructureElement } from '../../../mol-model/structure';

describe('StructureFocusManager refreshCurrent', () => {
    function createManager() {
        const plugin = {
            state: {
                data: {
                    events: {
                        object: {
                            removed: new Subject<any>(),
                            updated: new Subject<any>(),
                        }
                    }
                }
            },
            helpers: { substructureParent: { get: jest.fn() } },
            canvas3d: undefined,
            managers: { camera: { focusSphere: jest.fn() } },
        };
        return new StructureFocusManager(plugin as any);
    }

    beforeEach(() => {
        jest.spyOn(StructureElement.Loci, 'isEmpty').mockReturnValue(false);
        jest.spyOn(StructureElement.Loci, 'areEqual').mockReturnValue(false);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('re-emits the current focus without adding history', () => {
        const manager = createManager();
        const entry = { label: 'Ligand', loci: { structure: {} } } as FocusEntry;
        const remapped = { structure: {} } as any;
        const emitted: Array<FocusEntry | undefined> = [];
        manager.behaviors.current.subscribe(e => emitted.push(e));

        manager.set(entry);
        const historyLength = manager.history.length;
        manager.refreshCurrent(remapped);

        expect(emitted.slice(-2)).toEqual([entry, { ...entry, loci: remapped }]);
        expect(manager.current?.loci).toBe(remapped);
        expect(manager.history.length).toBe(historyLength);
    });

    it('does nothing when there is no current focus', () => {
        const manager = createManager();
        const emitted: Array<FocusEntry | undefined> = [];
        manager.behaviors.current.subscribe(e => emitted.push(e));

        manager.refreshCurrent();

        expect(emitted).toEqual([undefined]);
    });
});
