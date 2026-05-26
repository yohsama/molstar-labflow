/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

/*
 * This code has been modified from https://github.com/mattdesl/mouse-event-offset,
 * copyright (c) 2014 Matt DesLauriers. MIT License
 */

import { Vec2 } from '../../mol-math/linear-algebra/3d/vec2';

const rootPosition = { left: 0, top: 0 };

export function eventOffset(out: Vec2, ev: MouseEvent | Touch | { clientX: number, clientY: number }, target: Element) {
    const cx = ev.clientX || 0;
    const cy = ev.clientY || 0;

    if (isRootTarget(target)) {
        out[0] = cx;
        out[1] = cy;
        return out;
    }

    const rect = getBoundingClientOffset(target);
    const scaleX = getClientScale(rect.width, target.clientWidth);
    const scaleY = getClientScale(rect.height, target.clientHeight);

    out[0] = (cx - rect.left) / scaleX;
    out[1] = (cy - rect.top) / scaleY;
    return out;
}

function getBoundingClientOffset(element: Element) {
    return element.getBoundingClientRect();
}

function isRootTarget(target: Element) {
    const hasWindow = typeof Window !== 'undefined';
    const hasDocument = typeof Document !== 'undefined';
    const body = typeof document !== 'undefined' ? document.body : undefined;
    return (hasWindow && target instanceof Window)
        || (hasDocument && target instanceof Document)
        || target === body;
}

function getClientScale(rectSize: number, clientSize: number) {
    if (clientSize <= 0) return 1;
    const scale = rectSize / clientSize;
    return scale > 0 ? scale : 1;
}