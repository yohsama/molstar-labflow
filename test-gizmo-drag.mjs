import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
    headless: false,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-webgl',
        '--use-gl=swiftshader',
        '--disable-gpu-sandbox',
        '--disable-gpu',
        '--disable-software-rasterizer',
    ]
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

page.on('console', msg => console.log('PAGE LOG:', msg.text()));
page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

console.log('Navigating to test page...');
await page.goto('http://localhost:1338/build/viewer/box-test.html', { waitUntil: 'domcontentloaded', timeout: 60000 });

// Wait for Mol* to load
console.log('Waiting for Mol* viewer...');
await page.waitForFunction(() => typeof window.viewer !== 'undefined', { timeout: 60000 });

// Wait for structure to load
await new Promise(r => setTimeout(r, 5000));

// Inject helper to access box state
await page.evaluate(() => {
    window.getBoxState = () => {
        const mgr = window.boxManager;
        if (!mgr) return null;
        const objects = Array.from(mgr['objects']?.values() || []);
        if (objects.length === 0) return null;
        const obj = objects[0];
        const s = obj.state;
        return {
            id: obj.id,
            center: [s.center[0], s.center[1], s.center[2]],
            size: [s.size[0], s.size[1], s.size[2]]
        };
    };
});

// Click "Add Box"
console.log('Clicking Add Box...');
await page.click('#btn-add');
await new Promise(r => setTimeout(r, 1000));

// Get initial box state
const initialState = await page.evaluate(() => window.getBoxState());
console.log('Initial state:', initialState);

if (!initialState) {
    console.log('Box not created!');
    await browser.close();
    process.exit(1);
}

// Get canvas position
const canvasBox = await page.evaluate(() => {
    const canvas = document.querySelector('#app canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});
console.log('Canvas box:', canvasBox);

if (!canvasBox) {
    console.log('Canvas not found!');
    await browser.close();
    process.exit(1);
}

// Move mouse to center of canvas (where gizmo should be)
const centerX = canvasBox.x + canvasBox.width / 2;
const centerY = canvasBox.y + canvasBox.height / 2;

console.log(`Moving mouse to canvas center: (${centerX}, ${centerY})`);
await page.mouse.move(centerX, centerY);
await new Promise(r => setTimeout(r, 500));

// Drag from center to right
console.log('Dragging from center to right...');
await page.mouse.down();
await new Promise(r => setTimeout(r, 200));
await page.mouse.move(centerX + 100, centerY, { steps: 10 });
await new Promise(r => setTimeout(r, 200));
await page.mouse.up();
await new Promise(r => setTimeout(r, 500));

// Get final box state
const finalState = await page.evaluate(() => window.getBoxState());
console.log('Final state:', finalState);

const dx = finalState.center[0] - initialState.center[0];
const dy = finalState.center[1] - initialState.center[1];
const dz = finalState.center[2] - initialState.center[2];
console.log(`Delta: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}, dz=${dz.toFixed(2)}`);

if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1 || Math.abs(dz) > 0.1) {
    console.log('SUCCESS: Box moved during drag!');
} else {
    console.log('FAILURE: Box did not move during drag.');
}

await browser.close();
