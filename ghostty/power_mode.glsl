// Power Mode for Ghostty: sparks off the cursor and a short shake on each
// keystroke. It fires only on a typing-shaped move (less than one cell height
// along the same row), so output scrolling past does not set it off.
//
// Ghostty gives a shader the cursor's last change, not a history, so each key
// starts a fresh burst and the one before it ends.

const int   SPARKS = 14;
const float SPARK_DURATION = 0.45;   // seconds
const float SPARK_SPEED = 260.0;     // pixels per second
const float GRAVITY = 900.0;         // pixels per second squared
const float SPARK_SIZE = 1.6;        // pixel radius
const float SHAKE_DURATION = 0.09;   // seconds
const float SHAKE_PX = 2.0;          // 0.0 turns the shake off
const vec3  SPARK_HOT = vec3(1.0, 0.85, 0.35);
const vec3  SPARK_COOL = vec3(1.0, 0.35, 0.10);

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float t = iTime - iTimeCursorChange;
    float cellHeight = iCurrentCursor.w;
    vec2 delta = iCurrentCursor.xy - iPreviousCursor.xy;
    bool typed = abs(delta.y) < 0.5 && abs(delta.x) > 0.5 && abs(delta.x) < cellHeight;

    vec2 uv = fragCoord;
    if (typed && t < SHAKE_DURATION) {
        float seed = iTimeCursorChange * 37.0;
        uv += (vec2(hash(seed), hash(seed + 1.7)) - 0.5) * 2.0 * SHAKE_PX * (1.0 - t / SHAKE_DURATION);
    }
    fragColor = texture(iChannel0, uv / iResolution.xy);

    if (!typed || t >= SPARK_DURATION) {
        return;
    }

    // Cursor xy is its top-left corner with y pointing up: start at its middle.
    vec2 origin = iCurrentCursor.xy + vec2(0.0, -0.5 * cellHeight);
    vec3 light = vec3(0.0);

    for (int i = 0; i < SPARKS; i++) {
        float s = iTimeCursorChange * 13.1 + float(i) * 7.3;
        float life = SPARK_DURATION * mix(0.5, 1.0, hash(s + 5.9));
        if (t >= life) {
            continue;
        }
        float angle = mix(0.35, 2.8, hash(s));
        float speed = SPARK_SPEED * mix(0.4, 1.0, hash(s + 3.1));
        vec2 p = origin + vec2(cos(angle), sin(angle)) * speed * t - vec2(0.0, 0.5 * GRAVITY * t * t);
        float glow = smoothstep(SPARK_SIZE + 1.0, 0.0, length(fragCoord - p)) * (1.0 - t / life);
        light += mix(SPARK_HOT, SPARK_COOL, hash(s + 9.2)) * glow;
    }

    fragColor.rgb = min(fragColor.rgb + light, vec3(1.0));
}
