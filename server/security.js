const ALLOWED_ACTIONS = [
    'PAN_LEFT', 'PAN_RIGHT',
    'TILT_UP', 'TILT_DOWN',
    'STOP',
    'ZOOM_IN', 'ZOOM_OUT',
    'PRESET_CALL'
];

function verifyCommand(cmd, localPass) {
    if (!cmd || !cmd.password) return false;
    return cmd.password === localPass;
}

function sanitizeCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') return null;

    // Strict Structure Check
    if (!cmd.action || typeof cmd.action !== 'string') return null;

    // Allowlist Check
    if (!ALLOWED_ACTIONS.includes(cmd.action.toUpperCase())) {
        console.warn(`Blocked invalid action: ${cmd.action}`);
        return null;
    }

    return {
        action: cmd.action.toUpperCase(),
        speed: typeof cmd.speed === 'number' ? Math.max(0, Math.min(100, cmd.speed)) : 50,
        target: typeof cmd.target === 'string' ? cmd.target : 'ALL'
    };
}

module.exports = { verifyCommand, sanitizeCommand };
