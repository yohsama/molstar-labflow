/**
 * Copyright (c) 2025 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * LabFlow object transform controls for the Transform Gizmo extension.
 */

import * as React from 'react';
import { Quat, Vec3 } from '../../mol-math/linear-algebra';
import { getTransformObjectManager } from '../../extensions/transform-gizmo';
import { BoxStateSnapshot, PoseComplexStateSnapshot, RootStructureStateSnapshot, TransformObjectManager } from '../../extensions/transform-gizmo/manager';
import { boxEulerDegreesToQuat, boxQuatToEulerDegrees, MIN_BOX_SIZE, OrientedBoxState } from '../../extensions/transform-gizmo/math';
import { CollapsableControls, PurePluginUIComponent } from '../base';
import { Button, ControlRow, IconButton } from '../controls/common';
import { AddSvg, AutorenewSvg, CubeScanSvg, DeleteOutlinedSvg, HelpOutlineSvg, Icon } from '../controls/icons';

export class StructureObjectTransformControls extends CollapsableControls {
    defaultState() {
        return {
            isCollapsed: false,
            header: 'Object Transform',
            brand: { accent: 'gray' as const, svg: CubeScanSvg }
        };
    }

    renderControls() {
        return <ObjectTransformControls />;
    }
}

export { StructureObjectTransformControls as StructureBoxTransformControls };

interface NumberInputProps {
    value: number;
    title: string;
    disabled?: boolean;
    isValid?: (value: number) => boolean;
    onCommit: (value: number) => void;
}

interface NumberInputState {
    isEditing: boolean;
    value: string;
}

class BoxNumberInput extends React.PureComponent<NumberInputProps, NumberInputState> {
    state: NumberInputState = {
        isEditing: false,
        value: formatNumber(this.props.value),
    };

    componentDidUpdate(prevProps: NumberInputProps) {
        if (!this.state.isEditing && prevProps.value !== this.props.value) {
            this.setState({ value: formatNumber(this.props.value) });
        }
    }

    private resetValue() {
        this.setState({ isEditing: false, value: formatNumber(this.props.value) });
    }

    private commit() {
        const value = Number(this.state.value);
        const isValid = Number.isFinite(value) && (!this.props.isValid || this.props.isValid(value));
        if (!isValid) {
            this.resetValue();
            return;
        }

        this.props.onCommit(value);
        this.setState({ isEditing: false, value: formatNumber(value) });
    }

    private onFocus = () => {
        this.setState({ isEditing: true });
    };

    private onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ value: e.target.value });
    };

    private onBlur = () => {
        if (this.state.isEditing) this.commit();
    };

    private onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            this.commit();
            e.preventDefault();
        } else if (e.key === 'Escape') {
            this.resetValue();
            e.currentTarget.blur();
        }
        e.stopPropagation();
    };

    render() {
        return <input
            className='msp-form-control'
            style={{ flex: '1 1 0', minWidth: 0, textAlign: 'right' }}
            type='text'
            value={this.state.value}
            title={this.props.title}
            disabled={this.props.disabled}
            onFocus={this.onFocus}
            onChange={this.onChange}
            onBlur={this.onBlur}
            onKeyDown={this.onKeyDown}
        />;
    }
}

interface ObjectTransformControlsState {
    message?: string;
}

class ObjectTransformControls extends PurePluginUIComponent<{}, ObjectTransformControlsState> {
    private manager: TransformObjectManager | undefined;
    state: ObjectTransformControlsState = {};

    componentDidMount() {
        this.bindManager();
        this.subscribe(this.plugin.managers.structure.hierarchy.behaviors.selection, () => {
            this.manager?.syncRootStructures(this.plugin.managers.structure.hierarchy.current.structures);
            this.forceUpdate();
        });
        this.plugin.canvas3dInitialized.then(() => {
            this.bindManager();
            this.forceUpdate();
        });
    }

    private bindManager() {
        const manager = getTransformObjectManager(this.plugin);
        if (!manager || manager === this.manager) return;

        this.manager = manager;
        manager.syncRootStructures(this.plugin.managers.structure.hierarchy.current.structures);
        this.subscribe(manager.events.changed, () => this.forceUpdate());
    }

    private addBox = () => {
        const manager = this.manager;
        if (!manager) return;

        const box = manager.addBox(
            Vec3.create(0, 0, 0),
            Vec3.create(20, 20, 20),
            Quat.identity()
        );
        manager.setActiveObject(box.id);
        this.forceUpdate();
    };

    private selectBox = (snapshot: BoxStateSnapshot) => {
        const manager = this.manager;
        if (!manager) return;
        manager.setActiveObject(snapshot.id);
    };

    private selectRootStructure = (snapshot: RootStructureStateSnapshot) => {
        const manager = this.manager;
        if (!manager) return;
        manager.setActiveObject(snapshot.id);
    };

    private removeBox = (snapshot: BoxStateSnapshot) => {
        const manager = this.manager;
        if (!manager) return;
        manager.removeObject(snapshot.id);
    };

    private setCenter = (snapshot: BoxStateSnapshot, axis: number, value: number) => {
        const center = Vec3.clone(snapshot.center);
        center[axis] = value;
        this.commitBoxState(snapshot, center, snapshot.size, snapshot.rotation);
    };

    private setSize = (snapshot: BoxStateSnapshot, axis: number, value: number) => {
        const size = Vec3.clone(snapshot.size);
        size[axis] = value;
        this.commitBoxState(snapshot, snapshot.center, size, snapshot.rotation);
    };

    private setRotation = (snapshot: BoxStateSnapshot, axis: number, value: number) => {
        const euler = boxQuatToEulerDegrees(snapshot.rotation);
        euler[axis] = value;
        this.commitBoxState(snapshot, snapshot.center, snapshot.size, boxEulerDegreesToQuat(euler));
    };

    private setRootPosition = (snapshot: RootStructureStateSnapshot, axis: number, value: number) => {
        const position = Vec3.clone(snapshot.position);
        position[axis] = value;
        this.commitRootState(snapshot, position, snapshot.rotation);
    };

    private setRootRotation = (snapshot: RootStructureStateSnapshot, axis: number, value: number) => {
        const euler = boxQuatToEulerDegrees(snapshot.rotation);
        euler[axis] = value;
        this.commitRootState(snapshot, snapshot.position, boxEulerDegreesToQuat(euler));
    };

    private setRootLocked = (snapshot: RootStructureStateSnapshot, locked: boolean) => {
        const manager = this.manager;
        if (!manager) return;
        manager.setRootStructureLocked(snapshot.id, locked);
    };

    private commitBoxState(snapshot: BoxStateSnapshot, center: Vec3, size: Vec3, rotation: Quat) {
        const manager = this.manager;
        if (!manager) return;
        manager.setBoxState(snapshot.id, OrientedBoxState.create(center, size, rotation));
    }

    private commitRootState(snapshot: RootStructureStateSnapshot, position: Vec3, rotation: Quat) {
        const manager = this.manager;
        if (!manager) return;
        manager.setRootStructureTransform(snapshot.id, { position, rotation });
    }

    private resetRootStructure = (snapshot: RootStructureStateSnapshot) => {
        const manager = this.manager;
        if (!manager) return;
        manager.resetRootStructureTransform(snapshot.id);
    }

    private renderVectorRow(label: string, values: Vec3, onCommit: (axis: number, value: number) => void, isValid?: (value: number) => boolean, disabled = false) {
        return <ControlRow label={label} control={<div className='msp-flex-row' style={{ gap: '4px' }}>
            <BoxNumberInput value={values[0]} title={`${label} X`} onCommit={v => onCommit(0, v)} isValid={isValid} disabled={!this.manager || disabled} />
            <BoxNumberInput value={values[1]} title={`${label} Y`} onCommit={v => onCommit(1, v)} isValid={isValid} disabled={!this.manager || disabled} />
            <BoxNumberInput value={values[2]} title={`${label} Z`} onCommit={v => onCommit(2, v)} isValid={isValid} disabled={!this.manager || disabled} />
        </div>} />;
    }

    private renderBoxEntry(snapshot: BoxStateSnapshot, index: number) {
        const rotation = boxQuatToEulerDegrees(snapshot.rotation);
        const label = `Box ${index + 1}`;

        return <div key={snapshot.id} style={{ marginBottom: '6px' }}>
            <div className='msp-flex-row'>
                <Button noOverflow className='msp-control-button-label' title={`${label}. Click to make active.`} onClick={() => this.selectBox(snapshot)} style={{ textAlign: 'left' }}>
                    {label}
                    <small className='msp-25-lower-contrast-text' style={{ float: 'right' }}>{snapshot.isActive ? 'Active' : ''}</small>
                </Button>
                <IconButton svg={DeleteOutlinedSvg} toggleState={false} onClick={() => this.removeBox(snapshot)} title={`Remove ${label}`} small className='msp-form-control' flex />
            </div>
            <div className='msp-accent-offset' style={{ marginBottom: '6px' }}>
                {this.renderVectorRow('Position', snapshot.center, (axis, value) => this.setCenter(snapshot, axis, value))}
                {this.renderVectorRow('Size', snapshot.size, (axis, value) => this.setSize(snapshot, axis, value), value => value >= MIN_BOX_SIZE)}
                {this.renderVectorRow('Rotation', rotation, (axis, value) => this.setRotation(snapshot, axis, value))}
            </div>
        </div>;
    }

    private renderRootEntry(snapshot: RootStructureStateSnapshot, index: number) {
        const rotation = boxQuatToEulerDegrees(snapshot.rotation);
        const label = snapshot.label || `Root ${index + 1}`;

        return <div key={snapshot.id} style={{ marginBottom: '6px' }}>
            <div className='msp-flex-row'>
                <Button noOverflow className='msp-control-button-label' title={`${label}. Click to make active in Transform mode.`} onClick={() => this.selectRootStructure(snapshot)} style={{ textAlign: 'left' }}>
                    {label}
                    <small className='msp-25-lower-contrast-text' style={{ float: 'right' }}>{snapshot.isLocked ? 'Locked' : snapshot.isActive ? 'Active' : 'Root'}</small>
                </Button>
                <Button onClick={() => this.setRootLocked(snapshot, !snapshot.isLocked)} title={`${snapshot.isLocked ? 'Unlock' : 'Lock'} ${label} pose`} disabled={!this.manager}>
                    {snapshot.isLocked ? 'Unlock' : 'Lock'}
                </Button>
                <IconButton svg={AutorenewSvg} toggleState={false} onClick={() => this.resetRootStructure(snapshot)} title={`Reset transform for ${label}`} small className='msp-form-control' flex disabled={snapshot.isLocked} />
            </div>
            <div className='msp-accent-offset' style={{ marginBottom: '6px' }}>
                {this.renderVectorRow('Position', snapshot.position, (axis, value) => this.setRootPosition(snapshot, axis, value), undefined, snapshot.isLocked)}
                {this.renderVectorRow('Rotation', rotation, (axis, value) => this.setRootRotation(snapshot, axis, value), undefined, snapshot.isLocked)}
                <ControlRow label='Matrix' control={<span className='msp-25-lower-contrast-text' title={Array.from(snapshot.matrix).map(formatNumber).join(', ')}>
                    {formatMatrixSummary(snapshot.matrix)}
                </span>} />
            </div>
        </div>;
    }

    private renderPoseComplexEntry(snapshot: PoseComplexStateSnapshot, index: number) {
        const label = snapshot.label || `Pose Complex ${index + 1}`;
        return <div key={snapshot.id} style={{ marginBottom: '6px' }}>
            <ControlRow label={label} control={<span className='msp-25-lower-contrast-text'>
                {snapshot.rootIds.length} roots
            </span>} />
        </div>;
    }

    render() {
        const manager = this.manager;
        const boxes = manager?.listBoxStates() ?? [];
        const roots = manager?.listRootStructureStates() ?? [];
        const complexes = manager?.listPoseComplexStates() ?? [];
        const disabled = !manager;
        const objectCount = boxes.length + roots.length + complexes.length;

        return <>
            <div className='msp-flex-row'>
                <Button icon={AddSvg} title='Add box' onClick={this.addBox} disabled={disabled}>Add Box</Button>
            </div>
            {!manager && <div className='msp-control-offset msp-help-text'>
                <div className='msp-help-description'><Icon svg={HelpOutlineSvg} inline />Transform Gizmo extension is not loaded.</div>
            </div>}
            {manager && objectCount === 0 && <div className='msp-control-offset msp-help-text'>
                <div className='msp-help-description'><Icon svg={HelpOutlineSvg} inline />No transformable objects.</div>
            </div>}
            {this.state.message && <div className='msp-control-offset msp-help-text'>
                <div className='msp-help-description'><Icon svg={HelpOutlineSvg} inline />{this.state.message}</div>
            </div>}
            {roots.length > 0 && <div style={{ marginTop: '6px' }}>
                <ControlRow label='Root Structures' control={<span className='msp-25-lower-contrast-text'>{roots.length}</span>} />
                {roots.map((root, index) => this.renderRootEntry(root, index))}
            </div>}
            {boxes.length > 0 && <div style={{ marginTop: '6px' }}>
                <ControlRow label='Boxes' control={<span className='msp-25-lower-contrast-text'>{boxes.length}</span>} />
                {boxes.map((box, index) => this.renderBoxEntry(box, index))}
            </div>}
            {complexes.length > 0 && <div style={{ marginTop: '6px' }}>
                <ControlRow label='Pose Complexes' control={<span className='msp-25-lower-contrast-text'>{complexes.length}</span>} />
                {complexes.map((complex, index) => this.renderPoseComplexEntry(complex, index))}
            </div>}
        </>;
    }
}

function formatNumber(value: number): string {
    const v = Math.abs(value) < 1e-9 ? 0 : value;
    return Number(v.toFixed(3)).toString();
}

function formatMatrixSummary(matrix: ReadonlyArray<number>): string {
    return `${formatNumber(matrix[12])}, ${formatNumber(matrix[13])}, ${formatNumber(matrix[14])}`;
}
