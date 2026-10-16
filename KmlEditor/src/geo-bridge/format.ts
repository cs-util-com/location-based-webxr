export function formatCoordinate(value: number, originalString?: string): string {
    if (!Number.isFinite(value)) {
        throw new RangeError('Coordinate value must be finite');
    }

    if (typeof originalString === 'string') {
        const parsed = Number(originalString);
        if (Number.isFinite(parsed) && Math.abs(parsed - value) < 1e-9) {
            return originalString;
        }
    }

    const normalized = Math.abs(value) < 1e-12 ? 0 : value;
    let text = normalized.toFixed(9);
    text = text.replace(/\.0+$/, '');
    text = text.replace(/(\.\d*?)0+$/, '$1');
    if (text.endsWith('.')) {
        text = text.slice(0, -1);
    }
    if (text === '-0') {
        return '0';
    }
    return text;
}